import type { IChannelAdapter, PromptMessage } from '../types/index.js';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { WSClient, EventDispatcher, LoggerLevel } from '@larksuiteoapi/node-sdk';

interface FeishuConfig {
  mode: 'self-built' | 'webhook' | 'websocket';
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  webhookPort?: number;
  webhookPath?: string;
  webhookUrl?: string;
}

interface FeishuContext {
  receiveId: string;
  receiveIdType: 'open_id' | 'chat_id';
}

interface TokenInfo {
  token: string;
  expiresAt: number; // timestamp in ms
}

// WebSocket event data shape from @larksuiteoapi/node-sdk
interface WsMessageData {
  sender?: {
    sender_id?: { open_id?: string };
    sender_type?: string;
  };
  message?: {
    chat_id?: string;
    chat_type?: string;
    content?: string;
    message_type?: string;
  };
}

export class FeishuAdapter implements IChannelAdapter {
  readonly name = 'feishu';
  private config: FeishuConfig | null = null;
  private handler: ((text: string, promptId?: string) => void) | null = null;
  private server: FastifyInstance | null = null;
  private wsClient: WSClient | null = null;
  private tokenInfo: TokenInfo | null = null;
  private currentContext: FeishuContext | null = null;

  async initialize(config: unknown): Promise<void> {
    this.config = config as FeishuConfig;

    if (this.config.mode === 'self-built') {
      const port = this.config.webhookPort || 3000;
      const path = this.config.webhookPath || '/feishu/webhook';
      this.server = Fastify({ logger: false });
      this.server.post(path, async (request, reply) => {
        const body = request.body as Record<string, unknown>;
        console.log('[FeishuAdapter] Webhook received:', JSON.stringify(body, null, 2));
        this.handleWebhookMessage(body);
        reply.send({ code: 0 });
      });
      await this.server.listen({ port, host: '0.0.0.0' });
      console.log(`[FeishuAdapter] Webhook server listening on http://0.0.0.0:${port}${path}`);
      return;
    }

    if (this.config.mode === 'websocket') {
      if (!this.config.appId || !this.config.appSecret) {
        throw new Error('Missing appId or appSecret for Feishu websocket mode');
      }

      const dispatcher = new EventDispatcher({
        encryptKey: this.config.encryptKey || '',
        loggerLevel: LoggerLevel.error,
      });

      // Catch-all to see what events are arriving
      (dispatcher as any).handles.set('*', async (data: any) => {
        console.log('[FeishuAdapter] WS raw event:', JSON.stringify(data, null, 2));
      });

      dispatcher.register({
        'im.message.receive_v1': async (data: WsMessageData) => {
          this.handleWsMessage(data);
        },
        'card.action.trigger': async (data: WsMessageData) => {
          this.handleWsMessage(data);
        },
      });

      this.wsClient = new WSClient({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
        loggerLevel: LoggerLevel.error,
        autoReconnect: true,
        onReady: () => console.log('[FeishuAdapter] WebSocket connected and ready'),
        onError: (err) => console.error('[FeishuAdapter] WebSocket error:', err.message),
        onReconnecting: () => console.log('[FeishuAdapter] WebSocket reconnecting...'),
        onReconnected: () => console.log('[FeishuAdapter] WebSocket reconnected'),
      });

      await this.wsClient.start({ eventDispatcher: dispatcher });
      console.log('[FeishuAdapter] WebSocket client started');
    }
  }

  async send(message: PromptMessage): Promise<void> {
    const card = this.buildCardContent(message);
    const useCard = card != null;

    if (this.config?.mode === 'webhook' && this.config.webhookUrl) {
      const payload = useCard
        ? { msg_type: 'interactive', card }
        : { msg_type: 'text', content: { text: this.formatMessage(message) } };
      await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return;
    }

    // Both 'self-built' and 'websocket' modes use Feishu Open API to send messages
    if (this.config?.mode === 'self-built' || this.config?.mode === 'websocket') {
      if (!this.currentContext) {
        console.warn('[FeishuAdapter] No context available; skipping send. User must message the bot first.');
        return;
      }
      const token = await this.ensureToken();
      const content = useCard
        ? JSON.stringify(card)
        : JSON.stringify({ text: this.formatMessage(message) });

      const url = new URL('https://open.feishu.cn/open-apis/im/v1/messages');
      url.searchParams.set('receive_id_type', this.currentContext.receiveIdType);

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          receive_id: this.currentContext.receiveId,
          msg_type: useCard ? 'interactive' : 'text',
          content,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Feishu API error: ${response.status} ${body}`);
      }

      const data = (await response.json()) as { code?: number; msg?: string };
      if (data.code !== 0) {
        throw new Error(`Feishu API error: ${data.code} ${data.msg}`);
      }
    }
  }

  onReply(handler: (text: string, promptId?: string) => void): void {
    this.handler = handler;
  }

  async close(): Promise<void> {
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
    this.handler = null;
    this.currentContext = null;
    this.tokenInfo = null;
  }

  // WebSocket message handler
  private handleWsMessage(data: WsMessageData): void {
    const text = this.extractWsText(data);
    const context = this.extractWsContext(data);
    console.log(`[FeishuAdapter] WS extractText="${text}", context=${JSON.stringify(context)}`);
    if (context) {
      this.currentContext = context;
      console.log('[FeishuAdapter] WS context saved:', context);
    }
    if (text) {
      console.log('[FeishuAdapter] WS calling handler with text:', text);
      this.handler?.(text, undefined);
    }
  }

  private extractWsText(data: WsMessageData): string | null {
    // Handle card action trigger from WebSocket (with or without type wrapper)
    const raw = data as unknown as Record<string, unknown>;
    if (raw.type === 'card.action.trigger' || raw.action) {
      const action = raw.action as Record<string, unknown> | undefined;
      if (action) {
        const value = action.value as Record<string, unknown> | undefined;
        if (value && typeof value.text === 'string') return value.text;
      }
      return null;
    }

    if (!data.message || typeof data.message.content !== 'string') return null;
    try {
      const content = JSON.parse(data.message.content) as Record<string, unknown>;
      if (typeof content.text === 'string') return content.text;
    } catch {
      // ignore malformed JSON
    }
    return null;
  }

  private extractWsContext(data: WsMessageData): FeishuContext | null {
    if (!data.message) return null;
    const chatType = data.message.chat_type;
    const chatId = data.message.chat_id;
    const openId = data.sender?.sender_id?.open_id;

    if (chatType === 'p2p' && openId) {
      return { receiveId: openId, receiveIdType: 'open_id' };
    }
    if (chatType === 'group' && chatId) {
      return { receiveId: chatId, receiveIdType: 'chat_id' };
    }
    return null;
  }

  // HTTP Webhook message handler (for self-built mode)
  private handleWebhookMessage(body: Record<string, unknown>): void {
    const text = this.extractText(body);
    const context = this.extractContext(body);
    console.log(`[FeishuAdapter] Webhook extractText="${text}", context=${JSON.stringify(context)}`);
    if (context) {
      this.currentContext = context;
      console.log('[FeishuAdapter] Webhook context saved:', context);
    }
    if (text) {
      console.log('[FeishuAdapter] Webhook calling handler with text:', text);
      this.handler?.(text, undefined);
    }
  }

  private extractText(body: Record<string, unknown>): string | null {
    // Plain text body (for simple testing)
    if (typeof body.text === 'string') return body.text;

    // Feishu event message format (from HTTP webhook)
    const event = body.event as Record<string, unknown> | undefined;
    if (!event) return null;

    // Handle card action trigger (user clicked a button)
    if (event.type === 'card.action.trigger') {
      const action = event.action as Record<string, unknown> | undefined;
      if (action) {
        const value = action.value as Record<string, unknown> | undefined;
        if (value && typeof value.text === 'string') return value.text;
      }
      return null;
    }

    const message = event.message as Record<string, unknown> | undefined;
    if (message && typeof message.content === 'string') {
      try {
        const content = JSON.parse(message.content) as Record<string, unknown>;
        if (typeof content.text === 'string') return content.text;
      } catch {
        // ignore malformed JSON
      }
    }
    // Fallback for event with direct text field
    if (typeof event.text === 'string') return event.text;

    return null;
  }

  private extractContext(body: Record<string, unknown>): FeishuContext | null {
    const event = body.event as Record<string, unknown> | undefined;
    if (!event) return null;

    const message = event.message as Record<string, unknown> | undefined;
    if (!message) return null;

    const chatType = message.chat_type as string | undefined;
    const chatId = message.chat_id as string | undefined;
    const sender = (event.sender as Record<string, unknown> | undefined)?.sender_id as Record<string, unknown> | undefined;
    const openId = sender?.open_id as string | undefined;

    if (chatType === 'p2p' && openId) {
      return { receiveId: openId, receiveIdType: 'open_id' };
    }

    if (chatType === 'group' && chatId) {
      return { receiveId: chatId, receiveIdType: 'chat_id' };
    }

    return null;
  }

  private async ensureToken(): Promise<string> {
    const now = Date.now();
    const bufferMs = 60_000; // refresh 1 minute before expiry

    if (this.tokenInfo && this.tokenInfo.expiresAt > now + bufferMs) {
      return this.tokenInfo.token;
    }

    if (!this.config?.appId || !this.config?.appSecret) {
      throw new Error('Missing appId or appSecret for Feishu API');
    }

    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: this.config.appId,
        app_secret: this.config.appSecret,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Feishu token API error: ${response.status} ${body}`);
    }

    const data = (await response.json()) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`Feishu token API error: ${data.code} ${data.msg}`);
    }

    this.tokenInfo = {
      token: data.tenant_access_token,
      expiresAt: now + (data.expire ?? 7200) * 1000,
    };

    return this.tokenInfo.token;
  }

  private formatMessage(message: PromptMessage): string {
    const lines: string[] = [];
    if (message.title) lines.push(message.title);
    lines.push(message.body);
    if (message.options) lines.push(...message.options);
    return lines.join('\n');
  }

  /**
   * Build Feishu Interactive Message Card for selection / confirmation.
   * Returns null when card is not applicable (text should be used instead).
   */
  private buildCardContent(message: PromptMessage): Record<string, unknown> | null {
    if (message.type === 'selection') {
      const actions = (message.options ?? []).map((opt) => ({
        tag: 'button',
        text: { tag: 'plain_text', content: opt },
        type: 'primary',
        value: { text: opt },
      }));

      return {
        config: { wide_screen_mode: true },
        header: {
          title: {
            tag: 'plain_text',
            content: message.title ?? 'Claude 需要你选择',
          },
        },
        elements: [
          { tag: 'div', text: { tag: 'lark_md', content: message.body } },
          ...(actions.length > 0 ? [{ tag: 'action', actions }] : []),
        ],
      };
    }

    if (message.type === 'confirmation') {
      return {
        config: { wide_screen_mode: true },
        header: {
          title: {
            tag: 'plain_text',
            content: message.title ?? 'Claude 请求确认',
          },
        },
        elements: [
          { tag: 'div', text: { tag: 'lark_md', content: message.body } },
          {
            tag: 'action',
            actions: [
              {
                tag: 'button',
                text: { tag: 'plain_text', content: '确认' },
                type: 'primary',
                value: { text: 'Y' },
              },
              {
                tag: 'button',
                text: { tag: 'plain_text', content: '取消' },
                type: 'default',
                value: { text: 'n' },
              },
            ],
          },
        ],
      };
    }

    return null;
  }
}
