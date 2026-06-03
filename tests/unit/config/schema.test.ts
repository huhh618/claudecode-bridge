import { describe, it, expect } from 'vitest';
import { configSchema } from '../../../src/config/schema.js';

describe('configSchema', () => {
  const minimalValid = {
    claude: { command: 'claude', args: [], env: {} },
    stateMachine: { pauseThresholdMs: 800, inputTimeoutSec: 300, processingLockMs: 3000 },
    detector: {
      confirmationPatterns: ['\\[Y/n\\]'],
      selectionPatterns: ['^\\s*[\\[\\(]\\d+[\\)\\]]\\s+'],
      invitationPatterns: ['你想从哪开始'],
      ignorePatterns: ['^Reading\\.'],
    },
    channels: { terminal: { enabled: true } },
    handover: { enabled: false },
  };

  it('accepts minimal valid config', () => {
    const result = configSchema.parse(minimalValid);
    expect(result.claude.command).toBe('claude');
    expect(result.channels.terminal.enabled).toBe(true);
  });

  it('provides defaults for claude fields', () => {
    const result = configSchema.parse({
      ...minimalValid,
      claude: { command: 'claude' },
    });
    expect(result.claude.args).toEqual([]);
    expect(result.claude.env).toEqual({});
  });

  it('provides defaults for stateMachine fields', () => {
    const result = configSchema.parse({
      ...minimalValid,
      stateMachine: {},
    });
    expect(result.stateMachine.pauseThresholdMs).toBe(800);
    expect(result.stateMachine.inputTimeoutSec).toBe(300);
    expect(result.stateMachine.processingLockMs).toBe(3000);
  });

  it('provides defaults for detector patterns', () => {
    const result = configSchema.parse({
      ...minimalValid,
      detector: {},
    });
    expect(result.detector.confirmationPatterns.length).toBeGreaterThan(0);
    expect(result.detector.selectionPatterns.length).toBeGreaterThan(0);
    expect(result.detector.invitationPatterns.length).toBeGreaterThan(0);
    expect(result.detector.ignorePatterns.length).toBeGreaterThan(0);
  });

  it('provides defaults for handover', () => {
    const result = configSchema.parse({
      ...minimalValid,
      handover: {},
    });
    expect(result.handover.enabled).toBe(true);
  });

  it('accepts feishu self-built config', () => {
    const result = configSchema.parse({
      ...minimalValid,
      channels: {
        terminal: { enabled: true },
        feishu: {
          enabled: true,
          mode: 'self-built',
          appId: 'cli_xxx',
          appSecret: 'secret',
          encryptKey: 'key',
          webhookPort: 3000,
          webhookPath: '/feishu/webhook',
        },
      },
    });
    expect(result.channels.feishu?.mode).toBe('self-built');
  });

  it('accepts feishu webhook config', () => {
    const result = configSchema.parse({
      ...minimalValid,
      channels: {
        terminal: { enabled: true },
        feishu: {
          enabled: true,
          mode: 'webhook',
          webhookUrl: 'https://hook.example.com/send',
        },
      },
    });
    expect(result.channels.feishu?.webhookUrl).toBe('https://hook.example.com/send');
  });

  it('accepts feishu websocket config', () => {
    const result = configSchema.parse({
      ...minimalValid,
      channels: {
        terminal: { enabled: true },
        feishu: {
          enabled: true,
          mode: 'websocket',
          appId: 'cli_xxx',
          appSecret: 'secret',
        },
      },
    });
    expect(result.channels.feishu?.mode).toBe('websocket');
  });

  it('rejects invalid feishu mode', () => {
    expect(() =>
      configSchema.parse({
        ...minimalValid,
        channels: {
          terminal: { enabled: true },
          feishu: { enabled: true, mode: 'invalid-mode' },
        },
      })
    ).toThrow();
  });

  it('rejects missing terminal channel', () => {
    expect(() =>
      configSchema.parse({
        ...minimalValid,
        channels: {},
      })
    ).toThrow();
  });

  it('rejects negative pauseThresholdMs', () => {
    expect(() =>
      configSchema.parse({
        ...minimalValid,
        stateMachine: { pauseThresholdMs: -1, inputTimeoutSec: 300, processingLockMs: 3000 },
      })
    ).toThrow();
  });

  it('rejects zero processingLockMs', () => {
    expect(() =>
      configSchema.parse({
        ...minimalValid,
        stateMachine: { pauseThresholdMs: 800, inputTimeoutSec: 300, processingLockMs: 0 },
      })
    ).toThrow();
  });
});
