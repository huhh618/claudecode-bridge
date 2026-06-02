import type { IChannelAdapter, PromptMessage } from '../types/index.js';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

interface FeishuConfig {
  mode: 'self-built' | 'webhook';
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  webhookPort?: number;
  webhookPath?: string;
  webhookUrl?: string;
}

export class FeishuAdapter implements IChannelAdapter {
  readonly name = 'feishu';
  private config: FeishuConfig | null = null;
  private handler: ((text: string, promptId?: string) => void) | null = null;
  private server: FastifyInstance | null = null;

  async initialize(config: unknown): Promise<void> {
    this.config = config as FeishuConfig;
    if (this.config.mode === 'self-built') {
      this.server = Fastify({ logger: false });
      this.server.post(this.config.webhookPath || '/feishu/webhook', async (request, reply) => {
        const body = request.body as Record<string, unknown>;
        const text = this.extractText(body);
        if (text) {
          this.handler?.(text, undefined);
        }
        reply.send({ code: 0 });
      });
      await this.server.listen({ port: this.config.webhookPort || 3000, host: '0.0.0.0' });
    }
  }

  async send(message: PromptMessage): Promise<void> {
    if (this.config?.mode === 'webhook' && this.config.webhookUrl) {
      await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text: this.formatMessage(message) } }),
      });
    } else if (this.config?.mode === 'self-built') {
      // TODO: call Feishu open API with tenant_access_token
      // For MVP, log the message; full API integration in v1.1
      console.log(`[FeishuAdapter] Would send: ${this.formatMessage(message)}`);
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
    this.handler = null;
  }

  // Exposed for testing
  private handleWebhookMessage(body: Record<string, unknown>): void {
    const text = this.extractText(body);
    if (text) {
      this.handler?.(text, undefined);
    }
  }

  private extractText(body: Record<string, unknown>): string | null {
    if (typeof body.text === 'string') return body.text;
    if (body.event && typeof (body.event as Record<string, unknown>).text === 'string') {
      return (body.event as Record<string, unknown>).text as string;
    }
    return null;
  }

  private formatMessage(message: PromptMessage): string {
    const lines: string[] = [];
    if (message.title) lines.push(message.title);
    lines.push(message.body);
    if (message.options) lines.push(...message.options);
    return lines.join('\n');
  }
}
