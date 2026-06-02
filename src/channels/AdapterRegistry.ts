import type { IChannelAdapter } from '../types/index.js';
import { TerminalAdapter } from './TerminalAdapter.js';
import { FeishuAdapter } from './FeishuAdapter.js';

export class AdapterRegistry {
  private adapters = new Map<string, IChannelAdapter>();
  private enabled = new Set<string>();

  constructor() {
    this.adapters.set('terminal', new TerminalAdapter());
    this.adapters.set('feishu', new FeishuAdapter());
  }

  get(name: string): IChannelAdapter | undefined {
    return this.adapters.get(name);
  }

  async initializeAll(channelsConfig: Record<string, unknown>): Promise<void> {
    for (const [name, adapter] of this.adapters) {
      const cfg = channelsConfig[name] as { enabled: boolean } | undefined;
      if (cfg?.enabled) {
        await adapter.initialize(cfg);
        this.enabled.add(name);
      }
    }
  }

  getAllEnabled(): IChannelAdapter[] {
    return Array.from(this.enabled)
      .map((name) => this.adapters.get(name)!)
      .filter(Boolean);
  }

  async closeAll(): Promise<void> {
    for (const [name, adapter] of this.adapters) {
      if (this.enabled.has(name)) {
        await adapter.close();
      }
    }
    this.enabled.clear();
  }
}
