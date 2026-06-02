import { describe, it, expect, vi } from 'vitest';
import { StateMachine } from '../../../src/core/StateMachine.js';
import type { State } from '../../../src/types/index.js';

describe('StateMachine', () => {
  it('initial state is IDLE', () => {
    const sm = new StateMachine();
    expect(sm.getState()).toBe('IDLE');
  });

  it('transitions through valid states', () => {
    const sm = new StateMachine();
    sm.transition('BUSY');
    expect(sm.getState()).toBe('BUSY');
    sm.transition('AWAITING_INPUT');
    expect(sm.getState()).toBe('AWAITING_INPUT');
    sm.transition('PROCESSING_INPUT');
    expect(sm.getState()).toBe('PROCESSING_INPUT');
    sm.transition('BUSY');
    expect(sm.getState()).toBe('BUSY');
    sm.transition('IDLE');
    expect(sm.getState()).toBe('IDLE');
  });

  it('emits events on transition', () => {
    const sm = new StateMachine();
    const handler = vi.fn();
    sm.on('AWAITING_INPUT', handler);
    sm.transition('BUSY');
    sm.transition('AWAITING_INPUT');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not emit for unrelated transitions', () => {
    const sm = new StateMachine();
    const handler = vi.fn();
    sm.on('AWAITING_INPUT', handler);
    sm.transition('BUSY');
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows multiple handlers for the same state', () => {
    const sm = new StateMachine();
    const h1 = vi.fn();
    const h2 = vi.fn();
    sm.on('BUSY', h1);
    sm.on('BUSY', h2);
    sm.transition('BUSY');
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });
});
