import { ConfigManager } from './config/ConfigManager.js';
import { StateMachine } from './core/StateMachine.js';
import { InputDetector } from './core/InputDetector.js';
import { PtyManager } from './core/PtyManager.js';
import { AdapterRegistry } from './channels/AdapterRegistry.js';
import { ChannelRouter } from './channels/ChannelRouter.js';
import { createLogger } from './utils/logger.js';
import type { PtyOutputChunk } from './types/index.js';
import stripAnsi from 'strip-ansi';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

export class CcbridgeApp {
  private logger = createLogger('ccbridge');
  private configManager: ConfigManager;
  private stateMachine = new StateMachine();
  private ptyManager = new PtyManager();
  private inputDetector: InputDetector;
  private adapterRegistry = new AdapterRegistry();
  private channelRouter: ChannelRouter;
  private outputBuffer: string[] = [];
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(configPath: string) {
    this.configManager = new ConfigManager(configPath);
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
      process.stdin.pause();
    });

    // Forward terminal keystrokes to PTY
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(true);
      } catch { /* ignore if not supported */ }
    }
    process.stdin.resume();
    process.stdin.on('data', (data: Buffer) => {
      const str = data.toString();
      if (str === '\x03') {
        // Ctrl+C -> forward SIGINT handling
        process.emit('SIGINT', 'SIGINT');
        return;
      }
      this.ptyManager.write(str);
    });

    this.ptyManager.start(config.claude.command, config.claude.args, config.claude.env);
    this.stateMachine.transition('BUSY');
    this.logger.info('Claude started');
  }

  async stop(): Promise<void> {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.ptyManager.kill();
    await this.adapterRegistry.closeAll();
    this.logger.info('Stopped');
  }

  private handlePtyData(raw: string): void {
    // Mirror PTY output to current terminal so user can see Claude's interface
    process.stdout.write(raw);

    const stripped = stripAnsi(raw);
    this.outputBuffer.push(stripped);

    // Keep last 50 lines for analysis window
    if (this.outputBuffer.length > 50) {
      this.outputBuffer = this.outputBuffer.slice(-50);
    }

    const state = this.stateMachine.getState();

    if (state === 'PROCESSING_INPUT') {
      // Wait for output to resume before leaving lock
      this.stateMachine.transition('BUSY');
      this.channelRouter.reset();
    }

    if (state === 'BUSY' || state === 'IDLE') {
      if (this.pauseTimer) clearTimeout(this.pauseTimer);
      this.pauseTimer = setTimeout(() => {
        this.analyzeBuffer();
      }, 800);
    }
  }

  private analyzeBuffer(): void {
    const result = this.inputDetector.analyze(this.outputBuffer);
    if (result.awaitingInput && result.message) {
      this.logger.info({ promptId: result.message.promptId }, 'Awaiting input detected');
      this.stateMachine.transition('AWAITING_INPUT');
      this.channelRouter.broadcast(result.message).catch((err) => {
        this.logger.error(err, 'Broadcast failed');
      });
    }
  }
}

// CLI entry point
async function main() {
  const configPath = process.argv[2] || './ccbridge.config.json';

  if (!existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    console.error('Run: cp ccbridge.config.example.json ccbridge.config.json');
    console.error('Then edit ccbridge.config.json with your settings.');
    process.exit(1);
  }

  const app = new CcbridgeApp(configPath);

  process.on('SIGINT', async () => {
    await app.stop();
    process.exit(0);
  });

  await app.start();
}

const isMain = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
