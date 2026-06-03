import { describe, it, expect, vi } from 'vitest';
import { PtyManager } from '../../../src/core/PtyManager.js';

const isWin = process.platform === 'win32';

describe('PtyManager', () => {
  it('emits data events when PTY produces output', async () => {
    const pty = new PtyManager();
    const dataHandler = vi.fn();
    pty.on('data', dataHandler);

    if (isWin) {
      pty.start('cmd.exe', ['/c', 'echo hello'], {});
    } else {
      pty.start('bash', ['-c', 'echo hello'], {});
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(dataHandler).toHaveBeenCalled();
    const calls = dataHandler.mock.calls as string[][];
    const combined = calls.map((c) => c[0]).join('');
    expect(combined.toLowerCase()).toContain('hello');
    pty.kill();
  });

  it('spawns PTY in specified working directory', async () => {
    const pty = new PtyManager();
    const dataHandler = vi.fn();
    pty.on('data', dataHandler);

    if (isWin) {
      pty.start('cmd.exe', ['/c', 'cd'], {}, 'C:\\');
    } else {
      pty.start('bash', ['-c', 'pwd'], {}, '/');
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(dataHandler).toHaveBeenCalled();
    const combined = dataHandler.mock.calls.map((c) => c[0]).join('');
    if (isWin) {
      expect(combined.toLowerCase()).toContain('c:\\');
    } else {
      expect(combined.trim()).toBe('/');
    }
    pty.kill();
  });

  it('emits exit event when process ends', async () => {
    const pty = new PtyManager();
    const exitHandler = vi.fn();
    pty.on('exit', exitHandler);

    if (isWin) {
      pty.start('cmd.exe', ['/c', 'exit 0'], {});
    } else {
      pty.start('bash', ['-c', 'exit 0'], {});
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(exitHandler).toHaveBeenCalled();
    pty.kill();
  });

  it('write sends data to PTY stdin', async () => {
    const pty = new PtyManager();
    const dataHandler = vi.fn();
    pty.on('data', dataHandler);

    if (isWin) {
      pty.start('cmd.exe', ['/c', 'set /p var=&echo %var%'], {});
    } else {
      pty.start('bash', ['-c', 'read var && echo $var'], {});
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    pty.write('test-input\r');

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const combined = dataHandler.mock.calls.map((c) => c[0]).join('');
    expect(combined.toLowerCase()).toContain('test-input');
    pty.kill();
  });

  it('resize does not throw when pty is active', async () => {
    const pty = new PtyManager();
    if (isWin) {
      // Use ping to keep process alive briefly
      pty.start('cmd.exe', ['/c', 'ping -n 3 127.0.0.1'], {});
    } else {
      pty.start('bash', ['-c', 'sleep 3'], {});
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(() => pty.resize(100, 40)).not.toThrow();
    pty.kill();
  });

  it('kill is safe to call multiple times', async () => {
    const pty = new PtyManager();
    if (isWin) {
      pty.start('cmd.exe', ['/c', 'echo hello'], {});
    } else {
      pty.start('bash', ['-c', 'echo hello'], {});
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    pty.kill();
    expect(() => pty.kill()).not.toThrow();
  });

  it('emits exit event with exit code', async () => {
    const pty = new PtyManager();
    const exitHandler = vi.fn();
    pty.on('exit', exitHandler);

    if (isWin) {
      pty.start('cmd.exe', ['/c', 'exit 42'], {});
    } else {
      pty.start('bash', ['-c', 'exit 42'], {});
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(exitHandler).toHaveBeenCalled();
    const code = exitHandler.mock.calls[0][0];
    expect(typeof code).toBe('number');
  });
});
