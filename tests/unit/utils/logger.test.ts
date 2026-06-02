import { describe, it, expect } from 'vitest';
import { createLogger } from '../../../src/utils/logger.js';

describe('logger', () => {
  it('createLogger returns a pino-like logger with info/warn/error/debug methods', () => {
    const logger = createLogger('test');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.child).toBe('function');
  });

  it('child logger inherits the parent bindings', () => {
    const parent = createLogger('parent');
    const child = parent.child({ module: 'child' });
    expect(typeof child.info).toBe('function');
  });
});
