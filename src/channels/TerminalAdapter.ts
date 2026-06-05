import type { IChannelAdapter, PromptMessage } from '../types/index.js';

export class TerminalAdapter implements IChannelAdapter {
  readonly name = 'terminal';
  private handler: ((text: string, promptId?: string) => void) | null = null;

  async initialize(): Promise<void> {
    // Terminal is always available; no-op
  }

  async send(message: PromptMessage): Promise<void> {
    // Terminal already sees full PTY output; only show cross-channel notifications
    if (message.title) {
      console.log(`\n[cc-bridge] ${message.title}\n`);
    }
  }

  onReply(handler: (text: string, promptId?: string) => void): void {
    this.handler = handler;
  }

  async close(): Promise<void> {
    this.handler = null;
  }
}
