import type { IChannelAdapter, PromptMessage } from '../types/index.js';

export class ChannelRouter {
  private locked = false;
  private currentPromptId: string | null = null;
  private winnerChannel: string | null = null;
  private onInput: ((text: string, channelName: string) => void) | null = null;

  constructor(private adapters: IChannelAdapter[]) {}

  listen(handler: (text: string, channelName: string) => void): void {
    this.onInput = handler;
    for (const adapter of this.adapters) {
      adapter.onReply((text) => {
        this.handleReply(adapter.name, text);
      });
    }
  }

  async broadcast(message: PromptMessage): Promise<void> {
    this.locked = false;
    this.winnerChannel = null;
    this.currentPromptId = message.promptId;
    const results = await Promise.allSettled(this.adapters.map((a) => a.send(message)));
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'rejected') {
        console.error(`[ChannelRouter] Send failed (${this.adapters[i].name}):`, r.reason);
      }
    }
  }

  isLocked(): boolean {
    return this.locked;
  }

  reset(): void {
    this.locked = false;
    this.winnerChannel = null;
    this.currentPromptId = null;
  }

  private handleReply(channelName: string, text: string): void {
    if (this.locked) {
      // Notify the late channel that input was already handled
      const adapter = this.adapters.find((a) => a.name === channelName);
      if (adapter) {
        adapter.send({
          type: 'raw',
          body: `已由 ${this.winnerChannel} 处理，无需回复`,
          promptId: this.currentPromptId || 'unknown',
        }).catch(() => { /* ignore send errors */ });
      }
      return;
    }

    this.locked = true;
    this.winnerChannel = channelName;
    this.onInput?.(text, channelName);
  }
}
