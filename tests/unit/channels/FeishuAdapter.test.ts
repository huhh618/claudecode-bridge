import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FeishuAdapter } from '../../../src/channels/FeishuAdapter.js';

describe('FeishuAdapter', () => {
  let adapter: FeishuAdapter;

  beforeEach(() => {
    adapter = new FeishuAdapter();
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('has name "feishu"', () => {
    expect(adapter.name).toBe('feishu');
  });

  it('initializes in self-built mode', async () => {
    await adapter.initialize({
      mode: 'self-built',
      appId: 'test-app',
      appSecret: 'test-secret',
      encryptKey: 'test-key',
      webhookPort: 39999,
      webhookPath: '/test/webhook',
    });
    expect(adapter).toBeDefined();
  });

  it('send builds a message payload', async () => {
    await adapter.initialize({
      mode: 'self-built',
      appId: 'test-app',
      appSecret: 'test-secret',
      encryptKey: 'test-key',
      webhookPort: 39999,
      webhookPath: '/test/webhook',
    });
    // send should not throw
    await expect(adapter.send({
      type: 'selection',
      title: 'Test',
      body: 'Body',
      options: ['[1] A'],
      promptId: 'p1',
    })).resolves.toBeUndefined();
  });

  it('onReply registers handler triggered by webhook', async () => {
    const handler = vi.fn();
    adapter.onReply(handler);

    await adapter.initialize({
      mode: 'self-built',
      appId: 'test-app',
      appSecret: 'test-secret',
      encryptKey: 'test-key',
      webhookPort: 39999,
      webhookPath: '/test/webhook',
    });

    // Simulate a simulated webhook trigger via internal method
    (adapter as any).handleWebhookMessage({ text: '1' });
    expect(handler).toHaveBeenCalledWith('1', undefined);
  });
});
