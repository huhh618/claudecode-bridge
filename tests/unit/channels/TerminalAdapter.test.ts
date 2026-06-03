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

  it('onReply registers a handler that can be triggered', () => {
    const adapter = new TerminalAdapter();
    const handler = vi.fn();
    adapter.onReply(handler);
    adapter.triggerReply('hello');
    expect(handler).toHaveBeenCalledWith('hello', undefined);
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

  it('passes promptId through triggerReply', () => {
    const adapter = new TerminalAdapter();
    const handler = vi.fn();
    adapter.onReply(handler);
    adapter.triggerReply('hello', 'pid-123');
    expect(handler).toHaveBeenCalledWith('hello', 'pid-123');
  });

  it('overwrites previous handler on second onReply', () => {
    const adapter = new TerminalAdapter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    adapter.onReply(h1);
    adapter.onReply(h2);
    adapter.triggerReply('x');
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledWith('x', undefined);
  });

  it('does not trigger handler after close', async () => {
    const adapter = new TerminalAdapter();
    const handler = vi.fn();
    adapter.onReply(handler);
    await adapter.close();
    adapter.triggerReply('x');
    expect(handler).not.toHaveBeenCalled();
  });
});
