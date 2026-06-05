import type { IChannelAdapter, PromptMessage } from '../types/index.js';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { WSClient, EventDispatcher, LoggerLevel } from '@larksuiteoapi/node-sdk';
import stripAnsi from 'strip-ansi';

interface FeishuConfig {
  mode: 'self-built' | 'webhook' | 'websocket';
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  webhookPort?: number;
  webhookPath?: string;
  webhookUrl?: string;
  instanceId?: string;
  receiveId?: string;
  receiveIdType?: 'open_id' | 'chat_id';
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
  private instanceId = '';
  private sentMessageIds = new Set<string>();
  private readonly maxTrackedMessages = 200;

  async initialize(config: unknown): Promise<void> {
    this.config = config as FeishuConfig;
    this.instanceId = this.config.instanceId || this.generateInstanceId();
    console.log(`[FeishuAdapter] Instance ID: ${this.instanceId}`);

    if (this.config.receiveId) {
      this.currentContext = {
        receiveId: this.config.receiveId,
        receiveIdType: this.config.receiveIdType || 'open_id',
      };
      console.log(`[FeishuAdapter] Pre-configured context: ${JSON.stringify(this.currentContext)}`);
    }

    if (this.config.mode === 'self-built') {
      const port = this.config.webhookPort || 3000;
      const path = this.config.webhookPath || '/feishu/webhook';
      this.server = Fastify({ logger: false });
      this.server.post(path, async (request, reply) => {
        const body = request.body as Record<string, unknown>;
        console.log('[FeishuAdapter] Webhook received:', JSON.stringify(body, null, 2));

        this.handleWebhookMessage(body);
        reply.send(this.buildWebhookResponse(body));
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

      // Catch-all to see what events are arriving.
      // Note: SDK may not dispatch card.action.trigger to a specific handler,
      // so we handle card actions here as well.
      (dispatcher as any).handles.set('*', async (data: any) => {
        console.log('[FeishuAdapter] WS raw event:', JSON.stringify(data, null, 2));
        const isCardAction = data?.action || data?.event?.action;
        if (isCardAction) {
          this.handleWsMessage(data);
          return { toast: { type: 'success', content: '已收到' } };
        }
      });

      dispatcher.register({
        'im.message.receive_v1': async (data: WsMessageData) => {
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
    const useCard = message.type === 'selection' || message.type === 'confirmation' || message.type === 'question';

    if (this.config?.mode === 'webhook' && this.config.webhookUrl) {
      const payload = useCard
        ? { msg_type: 'interactive', card: this.buildCardContent(message) }
        : { msg_type: 'text', content: JSON.stringify({ text: this.buildPlainText(message) }) };
      await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return;
    }

    // Both 'self-built' and 'websocket' modes use Feishu Open API to send messages
    if (this.config?.mode === 'self-built' || this.config?.mode === 'websocket') {
      const context = this.currentContext ?? (this.config.receiveId
        ? { receiveId: this.config.receiveId, receiveIdType: this.config.receiveIdType || 'open_id' }
        : null);
      if (!context) {
        console.warn('[FeishuAdapter] No context available. Set receiveId in config or message the bot first.');
        return;
      }
      const token = await this.ensureToken();

      const msgType = useCard ? 'interactive' : 'text';
      const content = useCard
        ? JSON.stringify(this.buildCardContent(message))
        : JSON.stringify({ text: this.buildPlainText(message) });

      const url = new URL('https://open.feishu.cn/open-apis/im/v1/messages');
      url.searchParams.set('receive_id_type', context.receiveIdType);

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          receive_id: context.receiveId,
          msg_type: msgType,
          content,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Feishu API error: ${response.status} ${body}`);
      }

      const data = (await response.json()) as { code?: number; msg?: string; data?: { message_id?: string } };
      if (data.code !== 0) {
        throw new Error(`Feishu API error: ${data.code} ${data.msg}`);
      }
      if (data.data?.message_id) {
        this.trackMessageId(data.data.message_id);
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
    this.sentMessageIds.clear();
  }

  private generateInstanceId(): string {
    return `cb_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
  }

  private trackMessageId(messageId: string): void {
    this.sentMessageIds.add(messageId);
    if (this.sentMessageIds.size > this.maxTrackedMessages) {
      const first = this.sentMessageIds.values().next().value;
      if (first) this.sentMessageIds.delete(first);
    }
    console.log(`[FeishuAdapter] Tracked sent message: ${messageId}`);
  }

  /**
   * Determine whether an incoming message should be handled by this instance.
   * Card actions are filtered by instanceId in button value.
   * Text messages are filtered by parent_id matching a message sent by this instance.
   */
  private shouldHandle(raw: Record<string, unknown>): boolean {
    // 1. Card action trigger: check instanceId in button value
    const action = this.extractAction(raw);
    if (action) {
      const value = this.parseActionValue(action);
      const actionInstanceId = value?.instanceId;
      if (actionInstanceId !== undefined) {
        if (actionInstanceId !== this.instanceId) {
          console.log(`[FeishuAdapter] Ignoring card action for instance ${actionInstanceId}, mine is ${this.instanceId}`);
          return false;
        }
        return true;
      }
      // Card action without instanceId: allow if we have an active context
      // (the user is interacting with this bot session)
      if (this.currentContext) {
        return true;
      }
      // Backward compat: no instanceId configured and no tracked messages yet
      if (!this.config?.instanceId && this.sentMessageIds.size === 0) {
        return true;
      }
      console.log(`[FeishuAdapter] Ignoring card action without instanceId and no context`);
      return false;
    }

    // 2. Text reply: check if it replies to a message sent by this instance
    const parentId = this.extractParentId(raw);
    if (parentId && this.sentMessageIds.has(parentId)) {
      return true;
    }

    // 3. Direct message in a known context (e.g., p2p chat without reply)
    //    Once a context is established, allow further messages from the same chat.
    if (!parentId && this.currentContext) {
      const msgContext = this.extractContextFromRaw(raw);
      if (
        msgContext &&
        msgContext.receiveId === this.currentContext.receiveId &&
        msgContext.receiveIdType === this.currentContext.receiveIdType
      ) {
        return true;
      }
    }

    // 4. Fallback: if no context yet, no instanceId configured, and no tracked messages yet, allow (backward compat)
    if (!this.currentContext && !this.config?.instanceId && this.sentMessageIds.size === 0) {
      return true;
    }

    console.log(`[FeishuAdapter] Ignoring message not for this instance (parentId=${parentId}, instanceId=${this.instanceId})`);
    return false;
  }

  private extractAction(raw: Record<string, unknown>): Record<string, unknown> | null {
    if (raw.action) return raw.action as Record<string, unknown>;
    const event = raw.event as Record<string, unknown> | undefined;
    if (event?.action) return event.action as Record<string, unknown>;
    return null;
  }

  /**
   * Parse action.value which may be a JSON string or an object.
   * Feishu sometimes serializes button values as strings in callbacks.
   */
  private parseActionValue(action: Record<string, unknown>): Record<string, unknown> | null {
    const value = action.value;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    if (value && typeof value === 'object') {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private extractParentId(raw: Record<string, unknown>): string | undefined {
    const message = raw.message as Record<string, unknown> | undefined;
    if (typeof message?.parent_id === 'string') return message.parent_id;

    const event = raw.event as Record<string, unknown> | undefined;
    const eventMessage = event?.message as Record<string, unknown> | undefined;
    if (typeof eventMessage?.parent_id === 'string') return eventMessage.parent_id;

    return undefined;
  }

  private extractContextFromRaw(raw: Record<string, unknown>): FeishuContext | null {
    // WebSocket format
    const data = raw as unknown as Partial<WsMessageData>;
    if (data.message) {
      const chatType = data.message.chat_type;
      const chatId = data.message.chat_id;
      const openId = data.sender?.sender_id?.open_id;
      if (chatType === 'p2p' && openId) {
        return { receiveId: openId, receiveIdType: 'open_id' };
      }
      if (chatType === 'group' && chatId) {
        return { receiveId: chatId, receiveIdType: 'chat_id' };
      }
    }
    // Webhook format
    return this.extractContext(raw);
  }

  // WebSocket message handler
  private handleWsMessage(data: WsMessageData): void {
    const raw = data as unknown as Record<string, unknown>;
    if (!this.shouldHandle(raw)) {
      return;
    }
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

      // Update the original card message to show result and remove buttons
      const messageId = raw.open_message_id as string | undefined;
      if (messageId) {
        const resultText = text === 'Y' ? '已确认' : (text === 'n' ? '已取消' : `已选择: ${text}`);
        this.updateCardMessage(messageId, resultText).catch((err) => {
          console.error('[FeishuAdapter] Failed to update card:', err);
        });
      }
    }
  }

  private extractWsText(data: WsMessageData): string | null {
    const raw = data as unknown as Record<string, unknown>;
    const event = raw.event as Record<string, unknown> | undefined;
    const isCardAction = raw.type === 'card.action.trigger' || raw.action || event?.action;
    if (isCardAction) {
      const action = (raw.action || event?.action) as Record<string, unknown> | undefined;
      if (action) {
        const value = this.parseActionValue(action);
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
    if (!this.shouldHandle(body)) {
      return;
    }
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

      // Update the original card message to show result and remove buttons
      const event = body.event as Record<string, unknown> | undefined;
      const message = event?.message as Record<string, unknown> | undefined;
      const messageId = typeof message?.parent_id === 'string' ? message.parent_id : undefined;
      if (messageId) {
        const resultText = text === 'Y' ? '已确认' : (text === 'n' ? '已取消' : `已选择: ${text}`);
        this.updateCardMessage(messageId, resultText).catch((err) => {
          console.error('[FeishuAdapter] Failed to update card:', err);
        });
      }
    }
  }

  private extractText(body: Record<string, unknown>): string | null {
    // Plain text body (for simple testing)
    if (typeof body.text === 'string') return body.text;

    // Feishu event message format (from HTTP webhook)
    const event = body.event as Record<string, unknown> | undefined;

    // Handle card action trigger (user clicked a button)
    // Check multiple possible locations for the action data.
    const isCardAction = event?.type === 'card.action.trigger' || body.type === 'card.action.trigger';
    if (isCardAction) {
      const action = (event?.action || body.action) as Record<string, unknown> | undefined;
      if (action) {
        const value = this.parseActionValue(action);
        if (value && typeof value.text === 'string') return value.text;
      }
      return null;
    }

    if (!event) return null;

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

  /**
   * Build the HTTP response body for a webhook request.
   * Card action triggers need a toast response, otherwise Feishu
   * client shows an error. Normal messages just need { code: 0 }.
   */
  private buildWebhookResponse(body: Record<string, unknown>): Record<string, unknown> {
    const event = body.event as Record<string, unknown> | undefined;
    const isCardAction = event?.type === 'card.action.trigger' || body.type === 'card.action.trigger';
    if (isCardAction) {
      return { toast: { type: 'success', content: '已收到' } };
    }
    return { code: 0 };
  }

  /**
   * Update an existing interactive card message to show the result
   * and remove action buttons (mark as processed).
   */
  private async updateCardMessage(messageId: string, resultText: string): Promise<void> {
    const token = await this.ensureToken();

    const card = {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '处理结果' },
      },
      elements: [
        { tag: 'markdown', content: `**${resultText}**` },
      ],
    };

    const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: JSON.stringify(card),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Update card error: ${response.status} ${body}`);
    }

    const data = (await response.json()) as { code?: number; msg?: string };
    if (data.code !== 0) {
      throw new Error(`Update card error: ${data.code} ${data.msg}`);
    }

    console.log(`[FeishuAdapter] Card updated: ${messageId} -> ${resultText}`);
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
   * Build plain text for msg_type='text'.
   * Feishu text messages do NOT support Markdown; send raw text only.
   */
  private buildPlainText(message: PromptMessage): string {
    const lines: string[] = [];
    if (message.title) {
      lines.push(message.title);
      lines.push('');
    }
    lines.push(stripAnsi(message.body).trim());
    return lines.join('\n');
  }

  /**
   * Build Feishu Interactive Message Card.
   * Selection and confirmation types use cards so buttons can be attached.
   * Multi-line body content is wrapped in a Markdown code block.
   */
  private buildCardContent(message: PromptMessage): Record<string, unknown> {
    const title = message.title ?? this.inferTitle(message.type);
    const body = this.formatCardBody(message.body);

    // Use 'markdown' element instead of 'div'+'lark_md' because lark_md
    // does NOT render code blocks (```), while 'markdown' supports full
    // standard Markdown including fenced code blocks.
    const elements: Record<string, unknown>[] = [
      { tag: 'markdown', content: body },
    ];

    if (message.type === 'selection' && message.options && message.options.length > 0) {
      const actions = message.options.map((opt) => {
        const cleanOpt = stripAnsi(opt).trim();
        return {
          tag: 'button',
          text: { tag: 'plain_text', content: cleanOpt },
          type: 'primary',
          value: { text: cleanOpt, instanceId: this.instanceId },
        };
      });
      elements.push({ tag: 'action', actions });
    }

    if (message.type === 'confirmation') {
      elements.push({
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '确认' },
            type: 'primary',
            value: { text: 'Y', instanceId: this.instanceId },
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '取消' },
            type: 'default',
            value: { text: 'n', instanceId: this.instanceId },
          },
        ],
      });
    }

    return {
      config: { wide_screen_mode: true },
      ...(title ? {
        header: {
          title: { tag: 'plain_text', content: title },
        },
      } : {}),
      elements,
    };
  }

  private inferTitle(type: PromptMessage['type']): string | undefined {
    switch (type) {
      case 'selection': return 'Claude 需要你选择';
      case 'confirmation': return 'Claude 请求确认';
      case 'question': return 'Claude 向你提问';
      default: return undefined;
    }
  }

  private formatCardBody(body: string): string {
    const cleaned = stripAnsi(body).trim();
    // Wrap multi-line output in a Markdown code block for readable formatting
    if (cleaned.includes('\n') && !cleaned.includes('```')) {
      return `\`\`\`\n${cleaned}\n\`\`\``;
    }
    return cleaned;
  }
}
