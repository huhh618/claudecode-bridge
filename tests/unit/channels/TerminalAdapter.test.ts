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
});
