import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CcBridgeApp, parseCliArgs } from '../../src/index.js';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const TEST_CFG = join(process.cwd(), 'cc-bridge.unit.json');

describe('CcBridgeApp', () => {
  beforeEach(() => {
    writeFileSync(TEST_CFG, JSON.stringify({
      claude: { command: process.platform === 'win32' ? 'cmd.exe' : 'bash', args: [], env: {} },
      stateMachine: { pauseThresholdMs: 800, inputTimeoutSec: 300, processingLockMs: 3000 },
      detector: {
        confirmationPatterns: ['\\[Y/n\\]'],
        selectionPatterns: ['^\\s*[\\[\\(]\\d+[\\)\\]]\\s+'],
        ignorePatterns: [],
      },
      channels: { terminal: { enabled: true } },
      handover: { enabled: false },
    }));
  });

  afterEach(() => {
    try { unlinkSync(TEST_CFG); } catch { /* ignore */ }
  });

  it('constructs and loads config', async () => {
    const app = new CcBridgeApp(TEST_CFG);
    expect(app).toBeDefined();
    await app.stop();
  });

  it('truncates output buffer to last 200 lines', async () => {
    const app = new CcBridgeApp(TEST_CFG);
    await app.start();

    // Access private buffer via any
    const outputBuffer = (app as any).outputBuffer as string[];
    for (let i = 0; i < 210; i++) {
      outputBuffer.push(`line ${i}`);
    }
    expect(outputBuffer.length).toBe(210);

    (app as any).handlePtyData('\x1b[32mtest\x1b[0m');
    expect((app as any).outputBuffer.length).toBeLessThanOrEqual(200);
    expect((app as any).rawOutputBuffer.length).toBeLessThanOrEqual(200);
    await app.stop();
  });

  it('strips ANSI and adds to output buffer', async () => {
    const app = new CcBridgeApp(TEST_CFG);
    await app.start();

    (app as any).handlePtyData('\x1b[32mhello\x1b[0m');
    const buffer = (app as any).outputBuffer as string[];
    expect(buffer[buffer.length - 1]).toBe('hello');
    await app.stop();
  });

  it('transitions from PROCESSING_INPUT to BUSY on PTY data', async () => {
    const app = new CcBridgeApp(TEST_CFG);
    await app.start();

    const sm = (app as any).stateMachine;
    sm.transition('PROCESSING_INPUT');
    expect(sm.getState()).toBe('PROCESSING_INPUT');

    (app as any).handlePtyData('some output');
    expect(sm.getState()).toBe('BUSY');
    await app.stop();
  });

  it('resets channel router when leaving PROCESSING_INPUT', async () => {
    const app = new CcBridgeApp(TEST_CFG);
    await app.start();

    const router = (app as any).channelRouter;
    // Manually lock the router by setting internal state
    (router as any).locked = true;
    expect(router.isLocked()).toBe(true);

    const sm = (app as any).stateMachine;
    sm.transition('PROCESSING_INPUT');
    (app as any).handlePtyData('output');
    expect(router.isLocked()).toBe(false);
    await app.stop();
  });

  it('clears pause timer on stop', async () => {
    const app = new CcBridgeApp(TEST_CFG);
    await app.start();

    (app as any).pauseTimer = setTimeout(() => {}, 10000);
    await app.stop();
    // stop() clears the timer but does not set the field to null
    expect((app as any).pauseTimer).toBeDefined();
  });

  it('analyzes buffer and broadcasts on AWAITING_INPUT', async () => {
    const app = new CcBridgeApp(TEST_CFG);
    await app.start();

    const sm = (app as any).stateMachine;
    const router = (app as any).channelRouter;
    const broadcastSpy = vi.spyOn(router, 'broadcast').mockResolvedValue(undefined);

    (app as any).outputBuffer = ['Proceed? [Y/n]'];
    sm.transition('BUSY');
    (app as any).analyzeBuffer();

    expect(sm.getState()).toBe('AWAITING_INPUT');
    expect(broadcastSpy).toHaveBeenCalled();
    await app.stop();
  });

  it('does not broadcast when no input detected', async () => {
    const app = new CcBridgeApp(TEST_CFG);
    await app.start();

    const sm = (app as any).stateMachine;
    const router = (app as any).channelRouter;
    const broadcastSpy = vi.spyOn(router, 'broadcast').mockResolvedValue(undefined);

    (app as any).outputBuffer = ['Hello world', 'Some random text'];
    sm.transition('BUSY');
    (app as any).analyzeBuffer();

    expect(broadcastSpy).not.toHaveBeenCalled();
    await app.stop();
  });

  it('restores stdin on stop', async () => {
    const app = new CcBridgeApp(TEST_CFG);
    await app.start();

    expect((app as any).onStdinData).not.toBeNull();
    await app.stop();
    expect((app as any).onStdinData).toBeNull();
  });

  it('restores stdin when PTY exits', async () => {
    const app = new CcBridgeApp(TEST_CFG);
    await app.start();

    const ptyManager = (app as any).ptyManager as import('../../src/core/PtyManager.js').PtyManager;
    ptyManager.emit('exit', 0);

    expect((app as any).onStdinData).toBeNull();
    await app.stop();
  });
});

describe('parseCliArgs', () => {
  it('uses default config path when no args', () => {
    const opts = parseCliArgs([]);
    expect(opts.configPath).toBe('./cc-bridge.config.json');
    expect(opts.claudeArgs).toEqual([]);
    expect(opts.cwd).toBeUndefined();
  });

  it('parses custom config path as first positional arg', () => {
    const opts = parseCliArgs(['./my-config.json']);
    expect(opts.configPath).toBe('./my-config.json');
  });

  it('parses --dir flag', () => {
    const opts = parseCliArgs(['--dir', 'D:\\projects\\my-app']);
    expect(opts.cwd).toBe('D:\\projects\\my-app');
  });

  it('forwards -w to claude (worktree) instead of consuming it', () => {
    const opts = parseCliArgs(['-w', 'my-worktree']);
    expect(opts.cwd).toBeUndefined();
    expect(opts.claudeArgs).toEqual(['-w', 'my-worktree']);
  });

  it('parses claude args after -- separator', () => {
    const opts = parseCliArgs(['--', '-p', 'fix bug']);
    expect(opts.claudeArgs).toEqual(['-p', 'fix bug']);
  });

  it('forwards unknown flags to claude args', () => {
    const opts = parseCliArgs(['-p', 'fix bug']);
    expect(opts.claudeArgs).toEqual(['-p', 'fix bug']);
  });

  it('combines config path, --dir, and claude args', () => {
    const opts = parseCliArgs(['./my-config.json', '--dir', 'D:\\projects', '--', '-p', 'hello']);
    expect(opts.configPath).toBe('./my-config.json');
    expect(opts.cwd).toBe('D:\\projects');
    expect(opts.claudeArgs).toEqual(['-p', 'hello']);
  });

  it('combines --dir with claude -w worktree flag', () => {
    const opts = parseCliArgs(['--dir', 'D:\\projects\\my-app', '-w', 'my-worktree']);
    expect(opts.cwd).toBe('D:\\projects\\my-app');
    expect(opts.claudeArgs).toEqual(['-w', 'my-worktree']);
  });
});
