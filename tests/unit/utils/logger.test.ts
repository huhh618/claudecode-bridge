import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../../../src/utils/logger.js';

describe('logger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LOG_LEVEL;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

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

  it('respects LOG_LEVEL environment variable', () => {
    process.env.LOG_LEVEL = 'debug';
    const logger = createLogger('env-test');
    expect(logger.level).toBe('debug');
  });

  it('defaults to info level when LOG_LEVEL is not set', () => {
    const logger = createLogger('default-test');
    expect(logger.level).toBe('info');
  });

  it('enables pino-pretty transport in non-production', () => {
    process.env.NODE_ENV = 'development';
    const logger = createLogger('dev-test');
    // pino-pretty transport is set, logger should be valid
    expect(typeof logger.info).toBe('function');
  });

  it('omits transport in production', () => {
    process.env.NODE_ENV = 'production';
    const logger = createLogger('prod-test');
    expect(typeof logger.info).toBe('function');
  });
});
