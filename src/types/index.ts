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

