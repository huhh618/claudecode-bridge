import { ConfigManager } from './config/ConfigManager.js';
import { StateMachine } from './core/StateMachine.js';
import { InputDetector } from './core/InputDetector.js';
import { PtyManager } from './core/PtyManager.js';
import { AdapterRegistry } from './channels/AdapterRegistry.js';
import { ChannelRouter } from './channels/ChannelRouter.js';
import { createLogger } from './utils/logger.js';
import stripAnsi from 'strip-ansi';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

export class CcBridgeApp {
  private logger = createLogger('cc-bridge');
  private configManager: ConfigManager;
  private stateMachine = new StateMachine();
  private ptyManager = new PtyManager();
  private inputDetector!: InputDetector;
  private adapterRegistry = new AdapterRegistry();
  private channelRouter!: ChannelRouter;
  private outputBuffer: string[] = [];
  private rawOutputBuffer: string[] = [];
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private onStdinData: ((data: Buffer) => void) | null = null;
  private cliOpts: CliOptions;
  private lastBroadcastBody: string | null = null;
  private localInputTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly localInputSuppressMs = 1000;
  private startupTime = 0;
  private readonly startupGracePeriodMs = 3000;

  constructor(configPath: string, opts?: CliOptions) {
    this.configManager = new ConfigManager(configPath);
    this.cliOpts = opts ?? { configPath, claudeArgs: [] };
  }

  async start(): Promise<void> {
    const config = await this.configManager.load();
    this.logger.info('Config loaded');

    this.inputDetector = new InputDetector(config.detector);

    await this.adapterRegistry.initializeAll(config.channels);
    const adapters = this.adapterRegistry.getAllEnabled();
    this.channelRouter = new ChannelRouter(adapters);
    this.channelRouter.listen((text, channelName) => {
      this.logger.info({ channel: channelName, input: text }, 'Input received');
      this.ptyManager.write(text + '\r');
      this.stateMachine.transition('PROCESSING_INPUT');
    });

    this.ptyManager.on('data', (raw: string) => this.handlePtyData(raw));
    this.ptyManager.on('exit', (code: number) => {
      this.logger.info({ exitCode: code }, 'Claude exited');
      this.stateMachine.transition('IDLE');
      this.restoreStdin();
    });

    // Forward terminal keystrokes to PTY
    this.onStdinData = (data: Buffer) => {
      const str = data.toString();
      if (str === '\x03') {
        // Ctrl+C -> forward SIGINT handling
        process.emit('SIGINT', 'SIGINT');
        return;
      }
      this.ptyManager.write(str);

      // Suppress detector analysis while user is typing locally
      // to avoid PTY echo being misidentified as a prompt.
      if (this.localInputTimer) clearTimeout(this.localInputTimer);
      this.localInputTimer = setTimeout(() => {
        this.localInputTimer = null;
      }, this.localInputSuppressMs);
    };

    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(true);
      } catch { /* ignore if not supported */ }
    }
    process.stdin.resume();
    process.stdin.on('data', this.onStdinData);

    const cwd = this.cliOpts.cwd || config.claude.cwd || undefined;
    const args = [...config.claude.args, ...this.cliOpts.claudeArgs];
    this.ptyManager.start(config.claude.command, args, config.claude.env, cwd);
    this.stateMachine.transition('BUSY');
    this.startupTime = Date.now();
    this.logger.info('Claude started');
  }

  async stop(): Promise<void> {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    if (this.localInputTimer) clearTimeout(this.localInputTimer);
    this.ptyManager.kill();
    await this.adapterRegistry.closeAll();
    this.restoreStdin();
    this.logger.info('Stopped');
  }

  private restoreStdin(): void {
    if (this.onStdinData) {
      process.stdin.off('data', this.onStdinData);
      this.onStdinData = null;
    }
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch { /* ignore if not supported */ }
    }
    process.stdin.pause();
  }

  private handlePtyData(raw: string): void {
    // Mirror PTY output to current terminal so user can see Claude's interface
    process.stdout.write(raw);

    const stripped = stripAnsi(raw);
    this.outputBuffer.push(stripped);
    this.rawOutputBuffer.push(raw);

    // Keep last 200 lines for analysis window (diffs/reviews can be long)
    if (this.outputBuffer.length > 200) {
      this.outputBuffer = this.outputBuffer.slice(-200);
    }
    if (this.rawOutputBuffer.length > 200) {
      this.rawOutputBuffer = this.rawOutputBuffer.slice(-200);
    }

    const state = this.stateMachine.getState();

    if (state === 'PROCESSING_INPUT') {
      // Wait for output to resume before leaving lock
      this.stateMachine.transition('BUSY');
      this.channelRouter.reset();
      this.lastBroadcastBody = null;
    }

    if (state === 'BUSY' || state === 'IDLE' || state === 'AWAITING_INPUT') {
      if (this.pauseTimer) clearTimeout(this.pauseTimer);
      this.pauseTimer = setTimeout(() => {
        this.analyzeBuffer();
      }, 800);
    }
  }

  private analyzeBuffer(): void {
    if (this.localInputTimer) {
      // User recently typed locally; skip analysis to avoid PTY echo false positives.
      return;
    }
    // Skip prompt detection during startup grace period to avoid splash-screen false positives
    if (Date.now() - this.startupTime < this.startupGracePeriodMs) {
      return;
    }
    const raw = this.rawOutputBuffer.join('');
    // outputBuffer holds PTY chunks (not lines); split into actual lines before analysis
    const allLines = this.outputBuffer.join('').split(/\r?\n/);
    const result = this.inputDetector.analyze(allLines, raw);
    if (result.awaitingInput && result.message) {
      const body = result.message.body;
      // Avoid broadcasting identical content repeatedly while already awaiting input
      if (this.stateMachine.getState() === 'AWAITING_INPUT' && this.lastBroadcastBody === body) {
        return;
      }
      this.lastBroadcastBody = body;
      this.logger.info({ promptId: result.message.promptId }, 'Awaiting input detected');
      this.stateMachine.transition('AWAITING_INPUT');
      this.channelRouter.broadcast(result.message).catch((err) => {
        this.logger.error(err, 'Broadcast failed');
      });
    }
  }
}

export interface CliOptions {
  configPath: string;
  cwd?: string;
  claudeArgs: string[];
}

export function parseCliArgs(argv: string[]): CliOptions {
  const result: CliOptions = {
    configPath: './cc-bridge.config.json',
    claudeArgs: [],
  };

  let i = 0;
  // First positional arg (if not starting with '-') is config path
  if (argv[i] && !argv[i].startsWith('-')) {
    result.configPath = argv[i];
    i++;
  }

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--dir') {
      i++;
      if (i >= argv.length) {
        console.error(`Error: --dir requires a directory argument`);
        process.exit(1);
      }
      result.cwd = argv[i];
      i++;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      console.log(`Usage: cc-bridge [config-path] [options] [-- <claude-args>]

cc-bridge options:
  --dir <dir>       Working directory for Claude Code (overrides config)
  -h, --help        Show this help

All other flags are forwarded to Claude Code. Examples:
  cc-bridge                              # default
  cc-bridge --dir D:\\projects\\my-app    # run in specific directory
  cc-bridge -w my-worktree               # pass -w to Claude (worktree)
  cc-bridge --dir D:\\projects\\my-app -w my-worktree
  cc-bridge -p "fix bug"                 # pass -p to Claude
  cc-bridge --dir D:\\projects\\my-app -- -p "fix bug" --verbose`);
      process.exit(0);
    }

    if (arg === '--') {
      i++;
      result.claudeArgs.push(...argv.slice(i));
      break;
    }

    // Everything else is forwarded to Claude Code (including -w, -p, --verbose, etc.)
    if (arg.startsWith('-')) {
      const next = argv[i + 1];
      if (next && !next.startsWith('-') && next !== '--') {
        result.claudeArgs.push(arg, next);
        i += 2;
      } else {
        result.claudeArgs.push(arg);
        i++;
      }
      continue;
    }

    i++;
  }

  return result;
}

// CLI entry point
async function main() {
  const opts = parseCliArgs(process.argv.slice(2));

  if (!existsSync(opts.configPath)) {
    console.error(`Config file not found: ${opts.configPath}`);
    console.error('Run: cp cc-bridge.config.example.json cc-bridge.config.json');
    console.error('Then edit cc-bridge.config.json with your settings.');
    process.exit(1);
  }

  const app = new CcBridgeApp(opts.configPath, opts);

  process.on('SIGINT', async () => {
    await app.stop();
    process.exit(0);
  });

  await app.start();
}

const isMain = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Fatal error:', message);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  });
}
