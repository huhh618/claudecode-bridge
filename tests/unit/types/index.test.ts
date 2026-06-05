import { describe, it, expect } from 'vitest';
import {
  type State,
  type PromptMessage,
  type IChannelAdapter,
} from '../../../src/types/index.js';

describe('types', () => {
  it('State should accept valid states', () => {
    const s1: State = 'IDLE';
    const s2: State = 'BUSY';
    const s3: State = 'AWAITING_INPUT';
    const s4: State = 'PROCESSING_INPUT';
    expect([s1, s2, s3, s4]).toEqual(['IDLE', 'BUSY', 'AWAITING_INPUT', 'PROCESSING_INPUT']);
  });

  it('PromptMessage should require promptId and body', () => {
    const msg: PromptMessage = {
      type: 'confirmation',
      body: 'Confirm?',
      promptId: 'abc-123',
    };
    expect(msg.promptId).toBe('abc-123');
    expect(msg.body).toBe('Confirm?');
  });
});
