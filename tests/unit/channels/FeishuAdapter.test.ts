import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FeishuAdapter } from '../../../src/channels/FeishuAdapter.js';

describe('FeishuAdapter', () => {
  let adapter: FeishuAdapter;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    adapter = new FeishuAdapter();
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, msg: 'ok' }),
      text: async () => '',
    } as Response);
  });

  afterEach(async () => {
    await adapter.close();
    vi.restoreAllMocks();
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

  describe('webhook mode', () => {
    it('sends question as interactive card via webhookUrl', async () => {
      await adapter.initialize({
        mode: 'webhook',
        webhookUrl: 'https://hook.example.com/send',
      });

      await adapter.send({
        type: 'question',
        body: 'Hello',
        promptId: 'p1',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://hook.example.com/send',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"msg_type":"interactive"'),
        })
      );
      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.card.header.title.content).toBe('Claude 向你提问');
      expect(body.card.elements[0].content).toBe('Hello');
    });

    it('sends selection as interactive card via webhook', async () => {
      await adapter.initialize({
        mode: 'webhook',
        webhookUrl: 'https://hook.example.com/send',
      });

      await adapter.send({
        type: 'selection',
        title: 'Choose',
        body: 'Pick one',
        options: ['[1] A', '[2] B'],
        promptId: 'p1',
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://hook.example.com/send',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"msg_type":"interactive"'),
        })
      );
      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.card.header.title.content).toBe('Choose');
      expect(body.card.elements[1].actions).toHaveLength(2);
    });

    it('sends confirmation as interactive card via webhook', async () => {
      await adapter.initialize({
        mode: 'webhook',
        webhookUrl: 'https://hook.example.com/send',
      });

      await adapter.send({
        type: 'confirmation',
        body: 'Proceed?',
        promptId: 'p1',
      });

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.msg_type).toBe('interactive');
      expect(body.card.elements[1].actions[0].value.text).toBe('Y');
      expect(body.card.elements[1].actions[1].value.text).toBe('n');
    });
  });

  describe('self-built mode', () => {
    const config = {
      mode: 'self-built' as const,
      appId: 'test-app',
      appSecret: 'test-secret',
      encryptKey: 'test-key',
      webhookPort: 39999,
      webhookPath: '/test/webhook',
    };

    beforeEach(async () => {
      fetchSpy.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('tenant_access_token')) {
          return {
            ok: true,
            json: async () => ({ code: 0, tenant_access_token: 't-xxx', expire: 7200 }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ code: 0, msg: 'ok' }),
          text: async () => '',
        } as Response;
      });
    });

    it('silently skips send when no context', async () => {
      await adapter.initialize(config);
      await expect(
        adapter.send({ type: 'question', body: 'Hello', promptId: 'p1' })
      ).resolves.toBeUndefined();
    });

    it('sends question card after receiving p2p webhook', async () => {
      await adapter.initialize(config);

      // Simulate p2p message webhook
      (adapter as any).handleWebhookMessage({
        event: {
          sender: { sender_id: { open_id: 'ou_user' } },
          message: { chat_type: 'p2p', chat_id: 'oc_chat', content: '{"text":"hello"}' },
        },
      });

      await adapter.send({ type: 'question', body: 'Reply', promptId: 'p1' });

      const calls = fetchSpy.mock.calls;
      const sendCall = calls.find((c) =>
        (c[0] as string).toString().includes('/im/v1/messages')
      );
      expect(sendCall).toBeDefined();
      const sendBody = JSON.parse((sendCall![1] as RequestInit).body as string);
      expect(sendBody).toMatchObject({
        receive_id: 'ou_user',
        msg_type: 'interactive',
      });
      const card = JSON.parse(sendBody.content);
      expect(card.header.title.content).toBe('Claude 向你提问');
      expect(card.elements[0].content).toBe('Reply');
    });

    it('sends selection as interactive card', async () => {
      await adapter.initialize(config);
      (adapter as any).handleWebhookMessage({
        event: {
          sender: { sender_id: { open_id: 'ou_user' } },
          message: { chat_type: 'p2p', chat_id: 'oc_chat', content: '{"text":"hello"}' },
        },
      });

      await adapter.send({
        type: 'selection',
        title: 'Choose',
        body: 'Pick one',
        options: ['[1] A', '[2] B'],
        promptId: 'p1',
      });

      const calls = fetchSpy.mock.calls;
      const sendCall = calls.find((c) =>
        (c[0] as string).toString().includes('/im/v1/messages')
      );
      expect(sendCall).toBeDefined();
      const sendBody = JSON.parse((sendCall![1] as RequestInit).body as string);
      expect(sendBody.msg_type).toBe('interactive');
      const card = JSON.parse(sendBody.content);
      expect(card.header.title.content).toBe('Choose');
      expect(card.elements[0].content).toBe('Pick one');
      expect(card.elements[1].actions).toHaveLength(2);
      expect(card.elements[1].actions[0].value.text).toBe('[1] A');
    });

    it('sends confirmation as interactive card', async () => {
      await adapter.initialize(config);
      (adapter as any).handleWebhookMessage({
        event: {
          sender: { sender_id: { open_id: 'ou_user' } },
          message: { chat_type: 'p2p', chat_id: 'oc_chat', content: '{"text":"hello"}' },
        },
      });

      await adapter.send({
        type: 'confirmation',
        body: 'Proceed?',
        promptId: 'p1',
      });

      const calls = fetchSpy.mock.calls;
      const sendCall = calls.find((c) =>
        (c[0] as string).toString().includes('/im/v1/messages')
      );
      expect(sendCall).toBeDefined();
      const sendBody = JSON.parse((sendCall![1] as RequestInit).body as string);
      expect(sendBody.msg_type).toBe('interactive');
      const card = JSON.parse(sendBody.content);
      expect(card.elements[1].actions).toHaveLength(2);
      expect(card.elements[1].actions[0].value.text).toBe('Y');
      expect(card.elements[1].actions[1].value.text).toBe('n');
    });

    it('sends question card to group after receiving group webhook', async () => {
      await adapter.initialize(config);

      (adapter as any).handleWebhookMessage({
        event: {
          sender: { sender_id: { open_id: 'ou_user' } },
          message: { chat_type: 'group', chat_id: 'oc_group', content: '{"text":"hello"}' },
        },
      });

      await adapter.send({ type: 'question', body: 'Reply', promptId: 'p2' });

      const calls = fetchSpy.mock.calls;
      const sendCall = calls.find((c) =>
        (c[0] as string).toString().includes('/im/v1/messages')
      );
      expect(sendCall).toBeDefined();
      const sendBody = JSON.parse((sendCall![1] as RequestInit).body as string);
      expect(sendBody).toMatchObject({
        receive_id: 'oc_group',
        msg_type: 'interactive',
      });
      const card = JSON.parse(sendBody.content);
      expect(card.header.title.content).toBe('Claude 向你提问');
      expect(card.elements[0].content).toBe('Reply');
    });

    it('reuses cached token until expiry', async () => {
      await adapter.initialize(config);

      (adapter as any).handleWebhookMessage({
        event: {
          sender: { sender_id: { open_id: 'ou_user' } },
          message: { chat_type: 'p2p', chat_id: 'oc_chat', content: '{"text":"hello"}' },
        },
      });

      await adapter.send({ type: 'question', body: 'A', promptId: 'p1' });
      await adapter.send({ type: 'question', body: 'B', promptId: 'p2' });

      const tokenCalls = fetchSpy.mock.calls.filter((c) =>
        (c[0] as string).toString().includes('tenant_access_token')
      );
      expect(tokenCalls).toHaveLength(1);
    });

    it('handles card action trigger callback', async () => {
      await adapter.initialize(config);
      const handler = vi.fn();
      adapter.onReply(handler);

      (adapter as any).handleWebhookMessage({
        event: {
          type: 'card.action.trigger',
          action: { value: { text: '1' } },
        },
      });

      expect(handler).toHaveBeenCalledWith('1', undefined);
    });

    it('handles card action without instanceId when context exists', async () => {
      await adapter.initialize(config);
      const handler = vi.fn();
      adapter.onReply(handler);

      // Establish context by simulating an incoming message first
      (adapter as any).handleWebhookMessage({
        event: {
          sender: { sender_id: { open_id: 'ou_user' } },
          message: { chat_type: 'p2p', chat_id: 'oc_chat', content: '{"text":"hello"}' },
        },
      });

      // Then click a card button that lacks instanceId
      (adapter as any).handleWebhookMessage({
        event: {
          type: 'card.action.trigger',
          action: { value: { text: 'Y' } },
        },
      });

      expect(handler).toHaveBeenCalledWith('Y', undefined);
    });

    it('handles card action with stringified value', async () => {
      await adapter.initialize(config);
      const handler = vi.fn();
      adapter.onReply(handler);

      (adapter as any).handleWebhookMessage({
        event: {
          type: 'card.action.trigger',
          action: { value: JSON.stringify({ text: 'string-value', instanceId: (adapter as any).instanceId }) },
        },
      });

      expect(handler).toHaveBeenCalledWith('string-value', undefined);
    });

    it('builds toast response for card action webhook', () => {
      const result = (adapter as any).buildWebhookResponse({
        event: { type: 'card.action.trigger', action: { value: { text: 'Y' } } },
      });
      expect(result.toast).toBeDefined();
      expect(result.toast.type).toBe('success');
    });

    it('builds plain code response for normal message webhook', () => {
      const result = (adapter as any).buildWebhookResponse({
        event: {
          sender: { sender_id: { open_id: 'ou_user' } },
          message: { chat_type: 'p2p', chat_id: 'oc_chat', content: '{"text":"hello"}' },
        },
      });
      expect(result.code).toBe(0);
      expect(result.toast).toBeUndefined();
    });

    it('accepts direct message without parent_id when context exists', async () => {
      await adapter.initialize(config);
      const handler = vi.fn();
      adapter.onReply(handler);

      // First message establishes context and sends a reply (tracked message)
      (adapter as any).handleWebhookMessage({
        event: {
          sender: { sender_id: { open_id: 'ou_user' } },
          message: { chat_type: 'p2p', chat_id: 'oc_chat', content: '{"text":"hello"}' },
        },
      });
      expect(handler).toHaveBeenCalledWith('hello', undefined);
      handler.mockClear();

      // Simulate bot sending a message (tracks message_id)
      (adapter as any).trackMessageId('msg_123');

      // Second direct message from same user without parent_id should still be accepted
      (adapter as any).handleWebhookMessage({
        event: {
          sender: { sender_id: { open_id: 'ou_user' } },
          message: { chat_type: 'p2p', chat_id: 'oc_chat', content: '{"text":"second"}' },
        },
      });
      expect(handler).toHaveBeenCalledWith('second', undefined);
    });

    it('ignores direct message from different context', async () => {
      await adapter.initialize(config);
      const handler = vi.fn();
      adapter.onReply(handler);

      // Establish context with user A
      (adapter as any).handleWebhookMessage({
        event: {
          sender: { sender_id: { open_id: 'ou_user_a' } },
          message: { chat_type: 'p2p', chat_id: 'oc_chat_a', content: '{"text":"hello"}' },
        },
      });
      expect(handler).toHaveBeenCalledWith('hello', undefined);
      handler.mockClear();

      // Direct message from user B should be ignored
      (adapter as any).handleWebhookMessage({
        event: {
          sender: { sender_id: { open_id: 'ou_user_b' } },
          message: { chat_type: 'p2p', chat_id: 'oc_chat_b', content: '{"text":"intruder"}' },
        },
      });
      expect(handler).not.toHaveBeenCalled();
    });
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

    (adapter as any).handleWebhookMessage({ text: '1' });
    expect(handler).toHaveBeenCalledWith('1', undefined);
  });

  it('extracts text from Feishu event message content', async () => {
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

    (adapter as any).handleWebhookMessage({
      event: {
        sender: { sender_id: { open_id: 'ou_user' } },
        message: { chat_type: 'p2p', chat_id: 'oc_chat', content: '{"text":"hello from feishu"}' },
      },
    });

    expect(handler).toHaveBeenCalledWith('hello from feishu', undefined);
  });

  it('falls back to event.text when message content is absent', async () => {
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

    (adapter as any).handleWebhookMessage({
      event: {
        sender: { sender_id: { open_id: 'ou_user' } },
        text: 'fallback text',
      },
    });

    expect(handler).toHaveBeenCalledWith('fallback text', undefined);
  });

  it('handles malformed JSON in message content gracefully', async () => {
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

    (adapter as any).handleWebhookMessage({
      event: {
        sender: { sender_id: { open_id: 'ou_user' } },
        message: { chat_type: 'p2p', chat_id: 'oc_chat', content: 'not-json' },
      },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('skips send when no context in self-built mode', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await adapter.initialize({
      mode: 'self-built',
      appId: 'test-app',
      appSecret: 'test-secret',
      encryptKey: 'test-key',
      webhookPort: 39999,
      webhookPath: '/test/webhook',
    });

    await adapter.send({ type: 'question', body: 'No context', promptId: 'p1' });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No context'));
    warnSpy.mockRestore();
  });

  it('throws when send API returns non-zero code', async () => {
    await adapter.initialize({
      mode: 'self-built',
      appId: 'test-app',
      appSecret: 'test-secret',
      encryptKey: 'test-key',
      webhookPort: 39999,
      webhookPath: '/test/webhook',
    });

    (adapter as any).handleWebhookMessage({
      event: {
        sender: { sender_id: { open_id: 'ou_user' } },
        message: { chat_type: 'p2p', chat_id: 'oc_chat', content: '{"text":"hello"}' },
      },
    });

    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('tenant_access_token')) {
        return {
          ok: true,
          json: async () => ({ code: 0, tenant_access_token: 't-xxx', expire: 7200 }),
          text: async () => '',
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ code: 95001, msg: 'permission denied' }),
        text: async () => '',
      } as Response;
    });

    await expect(
      adapter.send({ type: 'question', body: 'Fail', promptId: 'p1' })
    ).rejects.toThrow('Feishu API error: 95001');
  });

  it('throws when token API returns error', async () => {
    await adapter.initialize({
      mode: 'self-built',
      appId: 'test-app',
      appSecret: 'test-secret',
      encryptKey: 'test-key',
      webhookPort: 39999,
      webhookPath: '/test/webhook',
    });

    (adapter as any).handleWebhookMessage({
      event: {
        sender: { sender_id: { open_id: 'ou_user' } },
        message: { chat_type: 'p2p', chat_id: 'oc_chat', content: '{"text":"hello"}' },
      },
    });

    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ code: 99991, msg: 'bad app credentials' }),
      text: async () => '',
    } as Response);

    await expect(
      adapter.send({ type: 'question', body: 'Fail', promptId: 'p1' })
    ).rejects.toThrow('Feishu token API error: 99991');
  });

  it('formats message with title, body and options', () => {
    const result = (adapter as any).formatMessage({
      type: 'selection',
      title: 'Title',
      body: 'Body',
      options: ['[1] A', '[2] B'],
      promptId: 'p1',
    });
    expect(result).toBe('Title\nBody\n[1] A\n[2] B');
  });

  it('formats message with body only', () => {
    const result = (adapter as any).formatMessage({
      type: 'question',
      body: 'Body only',
      promptId: 'p1',
    });
    expect(result).toBe('Body only');
  });

  it('wraps multi-line body in code block', () => {
    const result = (adapter as any).formatCardBody('line1\nline2\nline3');
    expect(result).toBe('\`\`\`\nline1\nline2\nline3\n\`\`\`');
  });

  it('builds plain text with title', () => {
    const result = (adapter as any).buildPlainText({
      type: 'question',
      title: 'Claude 向你提问',
      body: 'line1\nline2',
      promptId: 'p1',
    });
    expect(result).toBe('Claude 向你提问\n\nline1\nline2');
  });

  it('builds plain text for single-line body', () => {
    const result = (adapter as any).buildPlainText({
      type: 'question',
      body: 'Hello',
      promptId: 'p1',
    });
    expect(result).toBe('Hello');
  });

  it('builds plain text without title when title is absent', () => {
    const result = (adapter as any).buildPlainText({
      type: 'raw',
      body: 'Just raw text',
      promptId: 'p1',
    });
    expect(result).toBe('Just raw text');
  });

  it('strips ANSI from body and options', () => {
    const card = (adapter as any).buildCardContent({
      type: 'selection',
      body: '\x1b[32mhello\x1b[0m',
      options: ['\x1b[32m[1] Yes\x1b[0m'],
      promptId: 'p1',
    });
    expect(card.elements[0].content).toBe('hello');
    expect(card.elements[1].actions[0].text.content).toBe('[1] Yes');
    expect(card.elements[1].actions[0].value.text).toBe('[1] Yes');
  });

  describe('websocket mode', () => {
    it('throws when appId/appSecret missing', async () => {
      await expect(
        adapter.initialize({ mode: 'websocket', appId: '', appSecret: '' })
      ).rejects.toThrow('Missing appId or appSecret');
    });

    it('receives p2p message via WebSocket handler', async () => {
      // Mock WSClient to avoid real network connection
      const { WSClient } = await import('@larksuiteoapi/node-sdk');
      const startMock = vi.fn().mockResolvedValue(undefined);
      const closeMock = vi.fn();
      vi.spyOn(WSClient.prototype, 'start').mockImplementation(startMock);
      vi.spyOn(WSClient.prototype, 'close').mockImplementation(closeMock);

      const handler = vi.fn();
      adapter.onReply(handler);

      await adapter.initialize({
        mode: 'websocket',
        appId: 'test-app',
        appSecret: 'test-secret',
        encryptKey: 'test-key',
      });

      // Simulate WS message via internal handler
      (adapter as any).handleWsMessage({
        sender: { sender_id: { open_id: 'ou_ws_user' } },
        message: { chat_type: 'p2p', chat_id: 'oc_chat', content: '{"text":"ws hello"}' },
      });

      expect(handler).toHaveBeenCalledWith('ws hello', undefined);
    });

    it('sends question card after receiving websocket message', async () => {
      const { WSClient } = await import('@larksuiteoapi/node-sdk');
      vi.spyOn(WSClient.prototype, 'start').mockResolvedValue(undefined);
      vi.spyOn(WSClient.prototype, 'close').mockImplementation(() => {});

      await adapter.initialize({
        mode: 'websocket',
        appId: 'test-app',
        appSecret: 'test-secret',
        encryptKey: 'test-key',
      });

      (adapter as any).handleWsMessage({
        sender: { sender_id: { open_id: 'ou_ws_user' } },
        message: { chat_type: 'p2p', chat_id: 'oc_chat', content: '{"text":"ws hello"}' },
      });

      fetchSpy.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('tenant_access_token')) {
          return {
            ok: true,
            json: async () => ({ code: 0, tenant_access_token: 't-xxx', expire: 7200 }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ code: 0, msg: 'ok' }),
          text: async () => '',
        } as Response;
      });

      await adapter.send({ type: 'question', body: 'WS Reply', promptId: 'p1' });

      const calls = fetchSpy.mock.calls;
      const sendCall = calls.find((c) =>
        (c[0] as string).toString().includes('/im/v1/messages')
      );
      expect(sendCall).toBeDefined();
      const sendBody = JSON.parse((sendCall![1] as RequestInit).body as string);
      expect(sendBody).toMatchObject({
        receive_id: 'ou_ws_user',
        msg_type: 'interactive',
      });
      const card = JSON.parse(sendBody.content);
      expect(card.header.title.content).toBe('Claude 向你提问');
      expect(card.elements[0].content).toBe('WS Reply');
    });

    it('sends selection card via websocket mode', async () => {
      const { WSClient } = await import('@larksuiteoapi/node-sdk');
      vi.spyOn(WSClient.prototype, 'start').mockResolvedValue(undefined);
      vi.spyOn(WSClient.prototype, 'close').mockImplementation(() => {});

      await adapter.initialize({
        mode: 'websocket',
        appId: 'test-app',
        appSecret: 'test-secret',
        encryptKey: 'test-key',
      });

      (adapter as any).handleWsMessage({
        sender: { sender_id: { open_id: 'ou_ws_user' } },
        message: { chat_type: 'p2p', chat_id: 'oc_chat', content: '{"text":"ws hello"}' },
      });

      fetchSpy.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('tenant_access_token')) {
          return {
            ok: true,
            json: async () => ({ code: 0, tenant_access_token: 't-xxx', expire: 7200 }),
            text: async () => '',
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ code: 0, msg: 'ok' }),
          text: async () => '',
        } as Response;
      });

      await adapter.send({
        type: 'selection',
        title: 'WS Choose',
        body: 'Pick',
        options: ['[1] A'],
        promptId: 'p1',
      });

      const calls = fetchSpy.mock.calls;
      const sendCall = calls.find((c) =>
        (c[0] as string).toString().includes('/im/v1/messages')
      );
      expect(sendCall).toBeDefined();
      const sendBody = JSON.parse((sendCall![1] as RequestInit).body as string);
      expect(sendBody.msg_type).toBe('interactive');
      const card = JSON.parse(sendBody.content);
      expect(card.header.title.content).toBe('WS Choose');
    });

    it('handles card action trigger from websocket', async () => {
      const { WSClient } = await import('@larksuiteoapi/node-sdk');
      vi.spyOn(WSClient.prototype, 'start').mockResolvedValue(undefined);
      vi.spyOn(WSClient.prototype, 'close').mockImplementation(() => {});

      await adapter.initialize({
        mode: 'websocket',
        appId: 'test-app',
        appSecret: 'test-secret',
        encryptKey: 'test-key',
      });

      const handler = vi.fn();
      adapter.onReply(handler);

      (adapter as any).handleWsMessage({
        type: 'card.action.trigger',
        action: { value: { text: 'ws-card-1' } },
      });

      expect(handler).toHaveBeenCalledWith('ws-card-1', undefined);
    });

    it('handles card action trigger from websocket without type field', async () => {
      const { WSClient } = await import('@larksuiteoapi/node-sdk');
      vi.spyOn(WSClient.prototype, 'start').mockResolvedValue(undefined);
      vi.spyOn(WSClient.prototype, 'close').mockImplementation(() => {});

      await adapter.initialize({
        mode: 'websocket',
        appId: 'test-app',
        appSecret: 'test-secret',
        encryptKey: 'test-key',
      });

      const handler = vi.fn();
      adapter.onReply(handler);

      (adapter as any).handleWsMessage({
        action: { value: { text: 'ws-card-no-type' } },
      });

      expect(handler).toHaveBeenCalledWith('ws-card-no-type', undefined);
    });

    it('handles card action trigger from websocket with event wrapper', async () => {
      const { WSClient } = await import('@larksuiteoapi/node-sdk');
      vi.spyOn(WSClient.prototype, 'start').mockResolvedValue(undefined);
      vi.spyOn(WSClient.prototype, 'close').mockImplementation(() => {});

      await adapter.initialize({
        mode: 'websocket',
        appId: 'test-app',
        appSecret: 'test-secret',
        encryptKey: 'test-key',
      });

      const handler = vi.fn();
      adapter.onReply(handler);

      (adapter as any).handleWsMessage({
        event: {
          type: 'card.action.trigger',
          action: { value: { text: 'ws-card-with-event' } },
        },
      });

      expect(handler).toHaveBeenCalledWith('ws-card-with-event', undefined);
    });
  });
});
