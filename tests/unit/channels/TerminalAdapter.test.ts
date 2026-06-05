import { describe, it, expect, vi } from 'vitest';
import { TerminalAdapter } from '../../../src/channels/TerminalAdapter.js';

describe('TerminalAdapter', () => {
  it('has name "terminal"', () => {
    const adapter = new TerminalAdapter();
    expect(adapter.name).toBe('terminal');
  });

  it('initializes without error', async () => {
    const adapter = new TerminalAdapter();
    await expect(adapter.initialize({})).resolves.toBeUndefined();
  });

  it('send resolves without error', async () => {
    const adapter = new TerminalAdapter();
    await expect(adapter.send({
      type: 'confirmation',
      body: 'Test',
      promptId: 'p1',
    })).resolves.toBeUndefined();
  });

  it('onReply registers a handler', () => {
    const adapter = new TerminalAdapter();
    const handler = vi.fn();
    adapter.onReply(handler);
    // TerminalAdapter does not expose triggerReply; verify handler is stored by invoking via internal handler
    (adapter as any).handler('hello');
    expect(handler).toHaveBeenCalledWith('hello');
  });

  it('close resolves without error', async () => {
    const adapter = new TerminalAdapter();
    await expect(adapter.close()).resolves.toBeUndefined();
  });

  it('logs title to console when send has a title', async () => {
    const adapter = new TerminalAdapter();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await adapter.send({
      type: 'confirmation',
      title: 'Test Title',
      body: 'Body',
      promptId: 'p1',
    });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Test Title'));
    logSpy.mockRestore();
  });

  it('does not log when send has no title', async () => {
    const adapter = new TerminalAdapter();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await adapter.send({
      type: 'confirmation',
      body: 'Body',
      promptId: 'p1',
    });
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('overwrites previous handler on second onReply', () => {
    const adapter = new TerminalAdapter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    adapter.onReply(h1);
    adapter.onReply(h2);
    (adapter as any).handler('x');
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledWith('x');
  });

  it('clears handler on close', async () => {
    const adapter = new TerminalAdapter();
    const handler = vi.fn();
    adapter.onReply(handler);
    expect((adapter as any).handler).toBe(handler);
    await adapter.close();
    expect((adapter as any).handler).toBeNull();
  });
});
