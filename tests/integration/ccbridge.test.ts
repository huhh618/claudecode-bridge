import { describe, it, expect } from 'vitest';
import { CcbridgeApp } from '../../src/index.js';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const TEST_CFG = join(process.cwd(), 'ccbridge.integration.json');

describe('CcbridgeApp integration', () => {
  beforeEach(() => {
    writeFileSync(TEST_CFG, JSON.stringify({
      claude: { command: process.platform === 'win32' ? 'cmd.exe' : 'bash', args: [], env: {} },
      stateMachine: { pauseThresholdMs: 800, inputTimeoutSec: 300, processingLockMs: 3000 },
      detector: {
        confirmationPatterns: ['\\[Y/n\\]'],
        selectionPatterns: ['^\\s*[\\[\\(]\\d+[\\)\\]]\\s+'],
        ignorePatterns: [],
      },
      channels: { terminal: { enabled: true } },
      handover: { enabled: false },
    }));
  });

  afterEach(() => {
    try { unlinkSync(TEST_CFG); } catch { /* ignore */ }
  });

  it('constructs and loads config', async () => {
    const app = new CcbridgeApp(TEST_CFG);
    expect(app).toBeDefined();
    await app.stop();
  });

  it('starts and stops without error', async () => {
    const app = new CcbridgeApp(TEST_CFG);
    await app.start();
    await app.stop();
  });
});
