export type State = 'IDLE' | 'BUSY' | 'AWAITING_INPUT' | 'PROCESSING_INPUT';

export interface PromptMessage {
  type: 'selection' | 'confirmation' | 'question' | 'raw';
  title?: string;
  body: string;
  options?: string[];
  timeout?: number;
  promptId: string;
}

export interface IChannelAdapter {
  readonly name: string;
  initialize(config: unknown): Promise<void>;
  send(message: PromptMessage): Promise<void>;
  onReply(handler: (text: string, promptId?: string) => void): void;
  close(): Promise<void>;
}

export interface PtyOutputChunk {
  raw: string;
  stripped: string;
  timestamp: number;
}

export interface CcbridgeConfig {
  claude: {
    command: string;
    args: string[];
    env: Record<string, string>;
  };
  stateMachine: {
    pauseThresholdMs: number;
    inputTimeoutSec: number;
    processingLockMs: number;
  };
  detector: {
    confirmationPatterns: string[];
    selectionPatterns: string[];
    ignorePatterns: string[];
  };
  channels: {
    terminal: { enabled: boolean };
    feishu?: {
      enabled: boolean;
      mode: 'self-built' | 'webhook';
      appId?: string;
      appSecret?: string;
      encryptKey?: string;
      webhookPort?: number;
      webhookPath?: string;
      webhookUrl?: string;
    };
    telegram?: { enabled: boolean };
    wecom?: { enabled: boolean };
  };
  handover: {
    enabled: boolean;
  };
}
