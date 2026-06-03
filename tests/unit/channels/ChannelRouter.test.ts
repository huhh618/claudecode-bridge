import { describe, it, expect, vi } from 'vitest';
import { ChannelRouter } from '../../../src/channels/ChannelRouter.js';
import type { IChannelAdapter, PromptMessage } from '../../../src/types/index.js';

function createMockAdapter(name: string): IChannelAdapter {
  return {
    name,
    initialize: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    onReply: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ChannelRouter', () => {
  it('broadcasts prompt to all adapters', async () => {
    const a1 = createMockAdapter('a1');
    const a2 = createMockAdapter('a2');
    const router = new ChannelRouter([a1, a2]);

    const msg: PromptMessage = { type: 'confirmation', body: 'Yes?', promptId: 'p1' };
    await router.broadcast(msg);

    expect(a1.send).toHaveBeenCalledWith(msg);
    expect(a2.send).toHaveBeenCalledWith(msg);
  });

  it('routes first reply back to handler and notifies others', async () => {
    const a1 = createMockAdapter('a1');
    const a2 = createMockAdapter('a2');
    const router = new ChannelRouter([a1, a2]);

    const onInput = vi.fn();
    router.listen(onInput);

    // Simulate a1 replying first
    const a1ReplyHandler = (a1.onReply as ReturnType<typeof vi.fn>).mock.calls[0][0] as (text: string) => void;
    const a2ReplyHandler = (a2.onReply as ReturnType<typeof vi.fn>).mock.calls[0][0] as (text: string) => void;

    a1ReplyHandler('yes');
    expect(onInput).toHaveBeenCalledWith('yes', 'a1');

    // a2's late reply should trigger a notification
    a2ReplyHandler('no');
    expect(a2.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'raw',
      body: expect.stringContaining('a1'),
    }));
  });

  it('returns lock status', () => {
    const router = new ChannelRouter([createMockAdapter('a1')]);
    expect(router.isLocked()).toBe(false);
  });

  it('reset clears lock', async () => {
    const a1 = createMockAdapter('a1');
    const router = new ChannelRouter([a1]);
    router.listen(() => {});

    const handler = (a1.onReply as ReturnType<typeof vi.fn>).mock.calls[0][0] as (text: string) => void;
    handler('x');
    expect(router.isLocked()).toBe(true);

    router.reset();
    expect(router.isLocked()).toBe(false);
  });

  it('handles broadcast when one adapter send fails', async () => {
    const a1 = createMockAdapter('a1');
    const a2 = createMockAdapter('a2');
    a1.send = vi.fn().mockRejectedValue(new Error('send failed'));
    a2.send = vi.fn().mockResolvedValue(undefined);

    const router = new ChannelRouter([a1, a2]);
    const msg: PromptMessage = { type: 'confirmation', body: 'Yes?', promptId: 'p1' };
    await expect(router.broadcast(msg)).resolves.toBeUndefined();
    expect(a1.send).toHaveBeenCalled();
    expect(a2.send).toHaveBeenCalled();
  });

  it('allows new input after reset', async () => {
    const a1 = createMockAdapter('a1');
    const router = new ChannelRouter([a1]);
    const onInput = vi.fn();
    router.listen(onInput);

    const handler = (a1.onReply as ReturnType<typeof vi.fn>).mock.calls[0][0] as (text: string) => void;
    handler('first');
    expect(router.isLocked()).toBe(true);

    router.reset();
    handler('second');
    expect(onInput).toHaveBeenCalledTimes(2);
  });

  it('notifies late channel on repeated replies after lock', async () => {
    const a1 = createMockAdapter('a1');
    const a2 = createMockAdapter('a2');
    const router = new ChannelRouter([a1, a2]);
    router.listen(() => {});

    const a1Handler = (a1.onReply as ReturnType<typeof vi.fn>).mock.calls[0][0] as (text: string) => void;
    const a2Handler = (a2.onReply as ReturnType<typeof vi.fn>).mock.calls[0][0] as (text: string) => void;

    a1Handler('yes');
    a2Handler('no');
    a2Handler('maybe');
    expect(a2.send).toHaveBeenCalledTimes(2);
  });

  it('works with a single adapter', async () => {
    const a1 = createMockAdapter('a1');
    const router = new ChannelRouter([a1]);
    const onInput = vi.fn();
    router.listen(onInput);

    const msg: PromptMessage = { type: 'confirmation', body: 'Yes?', promptId: 'p1' };
    await router.broadcast(msg);
    expect(a1.send).toHaveBeenCalledWith(msg);

    const handler = (a1.onReply as ReturnType<typeof vi.fn>).mock.calls[0][0] as (text: string) => void;
    handler('ok');
    expect(onInput).toHaveBeenCalledWith('ok', 'a1');
  });
});
