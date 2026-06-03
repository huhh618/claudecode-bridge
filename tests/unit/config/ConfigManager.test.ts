import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from '../../../src/config/ConfigManager.js';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const TEST_CONFIG_PATH = join(process.cwd(), 'cc-bridge.test.config.json');

describe('ConfigManager', () => {
  beforeEach(() => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      claude: { command: 'claude', args: [], env: {} },
      stateMachine: { pauseThresholdMs: 800, inputTimeoutSec: 300, processingLockMs: 3000 },
      detector: {
        confirmationPatterns: ['\\[Y/n\\]'],
        selectionPatterns: ['^\\s*[\\[\\(]\\d+[\\)\\]]\\s+'],
        ignorePatterns: ['^Reading\\.'],
      },
      channels: { terminal: { enabled: true } },
      handover: { enabled: true },
    }));
  });

  afterEach(() => {
    try { unlinkSync(TEST_CONFIG_PATH); } catch { /* ignore */ }
  });

  it('loads and validates a valid config file', async () => {
    const cm = new ConfigManager(TEST_CONFIG_PATH);
    const cfg = await cm.load();
    expect(cfg.claude.command).toBe('claude');
    expect(cfg.stateMachine.pauseThresholdMs).toBe(800);
    expect(cfg.channels.terminal.enabled).toBe(true);
  });

  it('throws on invalid config (missing required field)', async () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ claude: { command: 'claude' } }));
    const cm = new ConfigManager(TEST_CONFIG_PATH);
    await expect(cm.load()).rejects.toThrow();
  });

  it('provides default values for optional fields', async () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      claude: { command: 'claude', args: [], env: {} },
      stateMachine: { pauseThresholdMs: 800, inputTimeoutSec: 300, processingLockMs: 3000 },
      detector: {
        confirmationPatterns: [],
        selectionPatterns: [],
        ignorePatterns: [],
      },
      channels: { terminal: { enabled: true } },
      handover: { enabled: false },
    }));
    const cm = new ConfigManager(TEST_CONFIG_PATH);
    const cfg = await cm.load();
    expect(cfg.detector.confirmationPatterns).toEqual([]);
  });
});
