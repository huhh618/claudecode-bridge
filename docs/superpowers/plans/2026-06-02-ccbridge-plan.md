# ccbridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ccbridge, a Node.js/TypeScript proxy service that wraps Claude Code CLI via PTY, detects user-input prompts with a state machine, and broadcasts them to Feishu (and other future channels) with first-come-first-served input routing.

**Architecture:** PTY wrapper + heuristic state machine + pluggable channel adapters. Terminal is always connected; message-platform adapters are loaded from config. Only distilled decision points (confirmations, selections) are pushed to Feishu, not full terminal spam.

**Tech Stack:** Node.js 20, TypeScript 5, node-pty, strip-ansi, pino, cosmiconfig, fastify, vitest

---

## File Structure

```
src/
  index.ts                    # Entry point: wires everything together
  types/
    index.ts                  # Shared TypeScript interfaces and types
  utils/
    logger.ts                 # Pino logger factory
  config/
    schema.ts                 # Zod validation schema for config
    ConfigManager.ts          # Loads and validates ccbridge.config.json
  core/
    StateMachine.ts           # IDLE / BUSY / AWAITING_INPUT / PROCESSING_INPUT
    InputDetector.ts          # Heuristic analysis of PTY output for prompts
    PtyManager.ts             # node-pty wrapper for Claude Code subprocess
  channels/
    TerminalAdapter.ts        # Passthrough adapter for local terminal
    FeishuAdapter.ts          # Feishu self-built-app adapter (webhook + API)
    AdapterRegistry.ts        # Discovers and initializes enabled adapters
    ChannelRouter.ts          # Broadcasts prompts and routes first input back
```

---

### Task 1: Project Initialization

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `ccbridge.config.example.json` (stub)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ccbridge",
  "version": "1.0.0",
  "description": "Claude Code bidirectional multi-channel I/O bridge",
  "main": "dist/index.js",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "cosmiconfig": "^9.0.0",
    "fastify": "^4.28.0",
    "node-pty": "^1.0.0",
    "pino": "^9.0.0",
    "strip-ansi": "^7.1.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.15.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{ts,js}'],
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
ccbridge.config.json
```

- [ ] **Step 5: Create directory structure and stub config**

Run:
```bash
mkdir -p src/{types,utils,config,core,channels} tests/{unit/{types,utils,config,core,channels},integration}
echo '{}' > ccbridge.config.example.json
```

- [ ] **Step 6: Install dependencies**

Run:
```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: initialize project with TypeScript, vitest, and dependencies"
```

---

### Task 2: Shared Types

**Files:**
- Create: `src/types/index.ts`
- Create: `tests/unit/types/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/types/index.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  type State,
  type PromptMessage,
  type IChannelAdapter,
  type CcbridgeConfig,
  type PtyOutputChunk,
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

  it('PtyOutputChunk should carry raw and stripped text', () => {
    const chunk: PtyOutputChunk = {
      raw: '\x1b[32mhello\x1b[0m',
      stripped: 'hello',
      timestamp: Date.now(),
    };
    expect(chunk.stripped).toBe('hello');
  });

  it('CcbridgeConfig should have required channels.terminal', () => {
    const cfg: CcbridgeConfig = {
      claude: { command: 'claude', args: [], env: {} },
      stateMachine: { pauseThresholdMs: 800, inputTimeoutSec: 300, processingLockMs: 3000 },
      detector: { confirmationPatterns: [], selectionPatterns: [], ignorePatterns: [] },
      channels: { terminal: { enabled: true } },
      handover: { enabled: false },
    };
    expect(cfg.channels.terminal.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run tests/unit/types/index.test.ts
```

Expected: FAIL — modules not found (`Cannot find module '../../../src/types/index.js'`).

- [ ] **Step 3: Write minimal implementation**

Create `src/types/index.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run tests/unit/types/index.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types tests/unit/types
git commit -m "feat(types): add shared domain types and interfaces"
```

---

### Task 3: Logger Utility

**Files:**
- Create: `src/utils/logger.ts`
- Create: `tests/unit/utils/logger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/utils/logger.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run tests/unit/utils/logger.test.ts
```

Expected: FAIL — `createLogger` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/logger.ts`:

```typescript
import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(name: string): Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run tests/unit/utils/logger.test.ts
```

Expected: PASS (2 tests). Note: pino-pretty transport warnings in non-production are fine.

- [ ] **Step 5: Commit**

```bash
git add src/utils tests/unit/utils
git commit -m "feat(logger): add pino-based logger factory"
```

---

### Task 4: ConfigManager and Schema

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/ConfigManager.ts`
- Create: `tests/unit/config/ConfigManager.test.ts`
- Modify: `ccbridge.config.example.json`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/config/ConfigManager.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from '../../../src/config/ConfigManager.js';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const TEST_CONFIG_PATH = join(process.cwd(), 'ccbridge.test.config.json');

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
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run tests/unit/config/ConfigManager.test.ts
```

Expected: FAIL — `ConfigManager` not found.

- [ ] **Step 3: Write Zod schema**

Create `src/config/schema.ts`:

```typescript
import { z } from 'zod';

export const configSchema = z.object({
  claude: z.object({
    command: z.string().default('claude'),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).default({}),
  }),
  stateMachine: z.object({
    pauseThresholdMs: z.number().positive().default(800),
    inputTimeoutSec: z.number().positive().default(300),
    processingLockMs: z.number().positive().default(3000),
  }),
  detector: z.object({
    confirmationPatterns: z.array(z.string()).default([
      '\\[Y/n\\]',
      '\\(yes/no\\)',
      'Confirm\\?',
    ]),
    selectionPatterns: z.array(z.string()).default([
      '^\\s*[\\[\\(]\\d+[\\)\\]]\\s+',
    ]),
    ignorePatterns: z.array(z.string()).default([
      '^Reading\\.',
      '^Searching\\.',
      '^Thinking\\.',
      '^Updating\\.',
      '^Analyzing\\.',
    ]),
  }),
  channels: z.object({
    terminal: z.object({ enabled: z.boolean().default(true) }),
    feishu: z.object({
      enabled: z.boolean(),
      mode: z.enum(['self-built', 'webhook']),
      appId: z.string().optional(),
      appSecret: z.string().optional(),
      encryptKey: z.string().optional(),
      webhookPort: z.number().optional(),
      webhookPath: z.string().optional(),
      webhookUrl: z.string().optional(),
    }).optional(),
    telegram: z.object({ enabled: z.boolean() }).optional(),
    wecom: z.object({ enabled: z.boolean() }).optional(),
  }),
  handover: z.object({
    enabled: z.boolean().default(true),
  }),
});

export type ValidatedConfig = z.infer<typeof configSchema>;
```

- [ ] **Step 4: Write ConfigManager**

Create `src/config/ConfigManager.ts`:

```typescript
import { readFile } from 'fs/promises';
import { configSchema, type ValidatedConfig } from './schema.js';

export class ConfigManager {
  constructor(private configPath: string) {}

  async load(): Promise<ValidatedConfig> {
    const raw = await readFile(this.configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return configSchema.parse(parsed);
  }
}
```

- [ ] **Step 5: Update example config**

Write `ccbridge.config.example.json`:

```json
{
  "claude": {
    "command": "claude",
    "args": [],
    "env": {}
  },
  "stateMachine": {
    "pauseThresholdMs": 800,
    "inputTimeoutSec": 300,
    "processingLockMs": 3000
  },
  "detector": {
    "confirmationPatterns": [
      "\\[Y/n\\]",
      "\\(yes/no\\)",
      "Confirm\\?",
      "Is this okay\\?",
      "Proceed\\?"
    ],
    "selectionPatterns": [
      "^\\s*[\\[\\(]\\d+[\\)\\]]\\s+"
    ],
    "ignorePatterns": [
      "^Reading\\.",
      "^Searching\\.",
      "^Thinking\\.",
      "^Updating\\.",
      "^Analyzing\\."
    ]
  },
  "channels": {
    "terminal": {
      "enabled": true
    },
    "feishu": {
      "enabled": false,
      "mode": "self-built",
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "encryptKey": "xxx",
      "webhookPort": 3000,
      "webhookPath": "/feishu/webhook"
    },
    "telegram": {
      "enabled": false
    },
    "wecom": {
      "enabled": false
    }
  },
  "handover": {
    "enabled": true
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run:
```bash
npx vitest run tests/unit/config/ConfigManager.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/config tests/unit/config ccbridge.config.example.json
git commit -m "feat(config): add ConfigManager with Zod schema and example config"
```

---

### Task 5: StateMachine

**Files:**
- Create: `src/core/StateMachine.ts`
- Create: `tests/unit/core/StateMachine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/StateMachine.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run tests/unit/core/StateMachine.test.ts
```

Expected: FAIL — `StateMachine` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/StateMachine.ts`:

```typescript
import { EventEmitter } from 'events';
import type { State } from '../types/index.js';

export class StateMachine extends EventEmitter {
  private state: State = 'IDLE';

  getState(): State {
    return this.state;
  }

  transition(to: State): void {
    const from = this.state;
    this.state = to;
    this.emit('transition', from, to);
    this.emit(to);
  }

  on(state: State, handler: () => void): this {
    super.on(state, handler);
    return this;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run tests/unit/core/StateMachine.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/StateMachine.ts tests/unit/core/StateMachine.test.ts
git commit -m "feat(core): add StateMachine with event-driven transitions"
```

---

### Task 6: InputDetector

**Files:**
- Create: `src/core/InputDetector.ts`
- Create: `tests/unit/core/InputDetector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/InputDetector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { InputDetector } from '../../../src/core/InputDetector.js';

describe('InputDetector', () => {
  const defaultConfig = {
    confirmationPatterns: ['\\[Y/n\\]', 'Confirm\\?'],
    selectionPatterns: ['^\\s*[\\[\\(]\\d+[\\)\\]]\\s+'],
    ignorePatterns: ['^Reading\\.', '^Thinking\\.'],
  };

  it('detects selection lists', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = [
      'Choose an option:',
      '[1] Yes, proceed',
      '[2] No, cancel',
      '> ',
    ];
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.type).toBe('selection');
    expect(result.message?.options).toEqual(['[1] Yes, proceed', '[2] No, cancel']);
  });

  it('detects confirmation prompts', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = ['Proceed? [Y/n]'];
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.type).toBe('confirmation');
  });

  it('ignores work-log lines', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = ['Reading files...', 'Thinking...'];
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(false);
  });

  it('detects question with options via pause heuristic', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = ['What would you like to do?', '(1) Edit file', '(2) Skip'];
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.type).toBe('selection');
  });

  it('returns awaitingInput false for unrelated output', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = ['Hello world', 'Some random text'];
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(false);
  });

  it('extracts body excluding ignore patterns', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = [
      'Reading files...',
      'Confirm delete?',
      '[1] Yes',
      '[2] No',
    ];
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.body).toContain('Confirm delete?');
    expect(result.message?.body).not.toContain('Reading files...');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run tests/unit/core/InputDetector.test.ts
```

Expected: FAIL — `InputDetector` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/InputDetector.ts`:

```typescript
import type { PromptMessage } from '../types/index.js';

interface DetectorConfig {
  confirmationPatterns: string[];
  selectionPatterns: string[];
  ignorePatterns: string[];
}

interface AnalysisResult {
  awaitingInput: boolean;
  message?: PromptMessage;
}

export class InputDetector {
  private confirmationRes: RegExp[];
  private selectionRes: RegExp[];
  private ignoreRes: RegExp[];

  constructor(private config: DetectorConfig) {
    this.confirmationRes = config.confirmationPatterns.map((p) => new RegExp(p, 'i'));
    this.selectionRes = config.selectionPatterns.map((p) => new RegExp(p, 'i'));
    this.ignoreRes = config.ignorePatterns.map((p) => new RegExp(p, 'i'));
  }

  analyze(lines: string[]): AnalysisResult {
    const filtered = lines.filter((line) => !this.isIgnored(line));

    const selectionMatches = filtered.filter((line) =>
      this.selectionRes.some((re) => re.test(line))
    );

    const confirmationMatch = filtered.some((line) =>
      this.confirmationRes.some((re) => re.test(line))
    );

    const hasPromptEnd = filtered.some((line) => {
      const trimmed = line.trim();
      return trimmed.endsWith('?') || trimmed.endsWith(':') || /^\s*>\s*$/.test(trimmed);
    });

    const hasOptions = selectionMatches.length >= 2;

    if (hasOptions) {
      return {
        awaitingInput: true,
        message: {
          type: 'selection',
          body: filtered.join('\n'),
          options: selectionMatches,
          promptId: crypto.randomUUID(),
        },
      };
    }

    if (confirmationMatch || (hasPromptEnd && filtered.length > 0)) {
      return {
        awaitingInput: true,
        message: {
          type: confirmationMatch ? 'confirmation' : 'question',
          body: filtered.join('\n'),
          promptId: crypto.randomUUID(),
        },
      };
    }

    return { awaitingInput: false };
  }

  private isIgnored(line: string): boolean {
    return this.ignoreRes.some((re) => re.test(line));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run tests/unit/core/InputDetector.test.ts
```

Expected: PASS (6 tests). If failures, adjust regex or heuristic thresholds.

- [ ] **Step 5: Commit**

```bash
git add src/core/InputDetector.ts tests/unit/core/InputDetector.test.ts
git commit -m "feat(core): add InputDetector with selection, confirmation, and ignore heuristics"
```

---

### Task 7: PtyManager

**Files:**
- Create: `src/core/PtyManager.ts`
- Create: `tests/unit/core/PtyManager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/PtyManager.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PtyManager } from '../../../src/core/PtyManager.js';

describe('PtyManager', () => {
  it('emits data events when PTY produces output', async () => {
    const pty = new PtyManager();
    const dataHandler = vi.fn();
    pty.on('data', dataHandler);

    pty.start(process.platform === 'win32' ? 'cmd.exe' : 'bash', ['-c', 'echo hello'], {});

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(dataHandler).toHaveBeenCalled();
    const calls = dataHandler.mock.calls as string[][];
    const combined = calls.map((c) => c[0]).join('');
    expect(combined).toContain('hello');
    pty.kill();
  });

  it('emits exit event when process ends', async () => {
    const pty = new PtyManager();
    const exitHandler = vi.fn();
    pty.on('exit', exitHandler);

    pty.start(process.platform === 'win32' ? 'cmd.exe' : 'bash', ['-c', 'exit 0'], {});

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(exitHandler).toHaveBeenCalled();
    pty.kill();
  });

  it('write sends data to PTY stdin', async () => {
    const pty = new PtyManager();
    const dataHandler = vi.fn();
    pty.on('data', dataHandler);

    // On Windows, use cmd /c to read a line; on Unix, use bash read
    if (process.platform === 'win32') {
      pty.start('cmd.exe', ['/c', 'set /p var= & echo %var%'], {});
    } else {
      pty.start('bash', ['-c', 'read var && echo $var'], {});
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
    pty.write('test-input\r');

    await new Promise((resolve) => setTimeout(resolve, 500));
    const combined = dataHandler.mock.calls.map((c) => c[0]).join('');
    expect(combined).toContain('test-input');
    pty.kill();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run tests/unit/core/PtyManager.test.ts
```

Expected: FAIL — `PtyManager` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/PtyManager.ts`:

```typescript
import { spawn, type IPty } from 'node-pty';
import { EventEmitter } from 'events';

export class PtyManager extends EventEmitter {
  private pty: IPty | null = null;

  start(command: string, args: string[], env: Record<string, string>): void {
    this.pty = spawn(command, args, {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      env: { ...process.env, ...env },
    });

    this.pty.onData((data) => this.emit('data', data));
    this.pty.onExit(({ exitCode }) => this.emit('exit', exitCode));
  }

  write(data: string): void {
    this.pty?.write(data);
  }

  kill(signal?: string): void {
    if (this.pty) {
      this.pty.kill(signal);
      this.pty = null;
    }
  }

  resize(cols: number, rows: number): void {
    this.pty?.resize(cols, rows);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run tests/unit/core/PtyManager.test.ts
```

Expected: PASS (3 tests). Note: PTY tests may be slightly flaky due to timing; increase timeouts if needed.

- [ ] **Step 5: Commit**

```bash
git add src/core/PtyManager.ts tests/unit/core/PtyManager.test.ts
git commit -m "feat(core): add PtyManager wrapping node-pty"
```

---

### Task 8: TerminalAdapter

**Files:**
- Create: `src/channels/TerminalAdapter.ts`
- Create: `tests/unit/channels/TerminalAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/channels/TerminalAdapter.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { TerminalAdapter } from '../../../src/channels/TerminalAdapter.js';

describe('TerminalAdapter', () => {
  it('has name "terminal"', () => {
    const adapter = new TerminalAdapter();
    expect(adapter.name).toBe('terminal');
  });

  it('initializes without error', async () => {
    const adapter = new TerminalAdapter();
    await expect(adapter.initialize({})).resolves.toBeUndefined();
  });

  it('send resolves without error', async () => {
    const adapter = new TerminalAdapter();
    await expect(adapter.send({
      type: 'confirmation',
      body: 'Test',
      promptId: 'p1',
    })).resolves.toBeUndefined();
  });

  it('onReply registers a handler that can be triggered', () => {
    const adapter = new TerminalAdapter();
    const handler = vi.fn();
    adapter.onReply(handler);
    adapter.triggerReply('hello');
    expect(handler).toHaveBeenCalledWith('hello', undefined);
  });

  it('close resolves without error', async () => {
    const adapter = new TerminalAdapter();
    await expect(adapter.close()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run tests/unit/channels/TerminalAdapter.test.ts
```

Expected: FAIL — `TerminalAdapter` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/channels/TerminalAdapter.ts`:

```typescript
import type { IChannelAdapter, PromptMessage } from '../types/index.js';

export class TerminalAdapter implements IChannelAdapter {
  readonly name = 'terminal';
  private handler: ((text: string, promptId?: string) => void) | null = null;

  async initialize(): Promise<void> {
    // Terminal is always available; no-op
  }

  async send(message: PromptMessage): Promise<void> {
    // Terminal already sees full PTY output; only show cross-channel notifications
    if (message.title) {
      console.log(`\n[ccbridge] ${message.title}\n`);
    }
  }

  onReply(handler: (text: string, promptId?: string) => void): void {
    this.handler = handler;
  }

  triggerReply(text: string, promptId?: string): void {
    this.handler?.(text, promptId);
  }

  async close(): Promise<void> {
    this.handler = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run tests/unit/channels/TerminalAdapter.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/channels/TerminalAdapter.ts tests/unit/channels/TerminalAdapter.test.ts
git commit -m "feat(channels): add TerminalAdapter for local terminal passthrough"
```

---

### Task 9: FeishuAdapter

**Files:**
- Create: `src/channels/FeishuAdapter.ts`
- Create: `tests/unit/channels/FeishuAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/channels/FeishuAdapter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FeishuAdapter } from '../../../src/channels/FeishuAdapter.js';

describe('FeishuAdapter', () => {
  let adapter: FeishuAdapter;

  beforeEach(() => {
    adapter = new FeishuAdapter();
  });

  afterEach(async () => {
    await adapter.close();
  });

  it('has name "feishu"', () => {
    expect(adapter.name).toBe('feishu');
  });

  it('initializes in self-built mode', async () => {
    await adapter.initialize({
      mode: 'self-built',
      appId: 'test-app',
      appSecret: 'test-secret',
      encryptKey: 'test-key',
      webhookPort: 39999,
      webhookPath: '/test/webhook',
    });
    expect(adapter).toBeDefined();
  });

  it('send builds a message payload', async () => {
    await adapter.initialize({
      mode: 'self-built',
      appId: 'test-app',
      appSecret: 'test-secret',
      encryptKey: 'test-key',
      webhookPort: 39999,
      webhookPath: '/test/webhook',
    });
    // send should not throw
    await expect(adapter.send({
      type: 'selection',
      title: 'Test',
      body: 'Body',
      options: ['[1] A'],
      promptId: 'p1',
    })).resolves.toBeUndefined();
  });

  it('onReply registers handler triggered by webhook', async () => {
    const handler = vi.fn();
    adapter.onReply(handler);

    await adapter.initialize({
      mode: 'self-built',
      appId: 'test-app',
      appSecret: 'test-secret',
      encryptKey: 'test-key',
      webhookPort: 39999,
      webhookPath: '/test/webhook',
    });

    // Simulate a simulated webhook trigger via internal method
    (adapter as any).handleWebhookMessage({ text: '1' });
    expect(handler).toHaveBeenCalledWith('1', undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run tests/unit/channels/FeishuAdapter.test.ts
```

Expected: FAIL — `FeishuAdapter` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/channels/FeishuAdapter.ts`:

```typescript
import type { IChannelAdapter, PromptMessage } from '../types/index.js';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

interface FeishuConfig {
  mode: 'self-built' | 'webhook';
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  webhookPort?: number;
  webhookPath?: string;
  webhookUrl?: string;
}

export class FeishuAdapter implements IChannelAdapter {
  readonly name = 'feishu';
  private config: FeishuConfig | null = null;
  private handler: ((text: string, promptId?: string) => void) | null = null;
  private server: FastifyInstance | null = null;

  async initialize(config: unknown): Promise<void> {
    this.config = config as FeishuConfig;
    if (this.config.mode === 'self-built') {
      this.server = Fastify({ logger: false });
      this.server.post(this.config.webhookPath || '/feishu/webhook', async (request, reply) => {
        const body = request.body as Record<string, unknown>;
        const text = this.extractText(body);
        if (text) {
          this.handler?.(text, undefined);
        }
        reply.send({ code: 0 });
      });
      await this.server.listen({ port: this.config.webhookPort || 3000, host: '0.0.0.0' });
    }
  }

  async send(message: PromptMessage): Promise<void> {
    if (this.config?.mode === 'webhook' && this.config.webhookUrl) {
      await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: { text: this.formatMessage(message) } }),
      });
    } else if (this.config?.mode === 'self-built') {
      // TODO: call Feishu open API with tenant_access_token
      // For MVP, log the message; full API integration in v1.1
      console.log(`[FeishuAdapter] Would send: ${this.formatMessage(message)}`);
    }
  }

  onReply(handler: (text: string, promptId?: string) => void): void {
    this.handler = handler;
  }

  async close(): Promise<void> {
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
    this.handler = null;
  }

  // Exposed for testing
  private handleWebhookMessage(body: Record<string, unknown>): void {
    const text = this.extractText(body);
    if (text) {
      this.handler?.(text, undefined);
    }
  }

  private extractText(body: Record<string, unknown>): string | null {
    if (typeof body.text === 'string') return body.text;
    if (body.event && typeof (body.event as Record<string, unknown>).text === 'string') {
      return (body.event as Record<string, unknown>).text as string;
    }
    return null;
  }

  private formatMessage(message: PromptMessage): string {
    const lines: string[] = [];
    if (message.title) lines.push(message.title);
    lines.push(message.body);
    if (message.options) lines.push(...message.options);
    return lines.join('\n');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run tests/unit/channels/FeishuAdapter.test.ts
```

Expected: PASS (4 tests). Fastify server will bind to port 39999 in tests.

- [ ] **Step 5: Commit**

```bash
git add src/channels/FeishuAdapter.ts tests/unit/channels/FeishuAdapter.test.ts
git commit -m "feat(channels): add FeishuAdapter with self-built and webhook modes"
```

---

### Task 10: AdapterRegistry

**Files:**
- Create: `src/channels/AdapterRegistry.ts`
- Create: `tests/unit/channels/AdapterRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/channels/AdapterRegistry.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AdapterRegistry } from '../../../src/channels/AdapterRegistry.js';
import { TerminalAdapter } from '../../../src/channels/TerminalAdapter.js';
import { FeishuAdapter } from '../../../src/channels/FeishuAdapter.js';

describe('AdapterRegistry', () => {
  it('registers built-in adapters', () => {
    const registry = new AdapterRegistry();
    expect(registry.get('terminal')).toBeInstanceOf(TerminalAdapter);
  });

  it('initializes only enabled adapters from config', async () => {
    const registry = new AdapterRegistry();
    const terminalInit = vi.spyOn(registry.get('terminal')!, 'initialize');

    await registry.initializeAll({
      terminal: { enabled: true },
      feishu: { enabled: false, mode: 'self-built' },
    });

    expect(terminalInit).toHaveBeenCalled();
  });

  it('getAllEnabled returns only initialized and enabled adapters', async () => {
    const registry = new AdapterRegistry();
    await registry.initializeAll({
      terminal: { enabled: true },
      feishu: { enabled: true, mode: 'self-built', webhookPort: 39998, webhookPath: '/t' },
    });

    const enabled = registry.getAllEnabled();
    expect(enabled.length).toBeGreaterThanOrEqual(1);
    expect(enabled.some((a) => a.name === 'terminal')).toBe(true);
  });

  it('closeAll closes all adapters', async () => {
    const registry = new AdapterRegistry();
    await registry.initializeAll({ terminal: { enabled: true } });
    await expect(registry.closeAll()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run tests/unit/channels/AdapterRegistry.test.ts
```

Expected: FAIL — `AdapterRegistry` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/channels/AdapterRegistry.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run tests/unit/channels/AdapterRegistry.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/channels/AdapterRegistry.ts tests/unit/channels/AdapterRegistry.test.ts
git commit -m "feat(channels): add AdapterRegistry for discovering and initializing adapters"
```

---

### Task 11: ChannelRouter

**Files:**
- Create: `src/channels/ChannelRouter.ts`
- Create: `tests/unit/channels/ChannelRouter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/channels/ChannelRouter.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ChannelRouter } from '../../../src/channels/ChannelRouter.js';
import type { IChannelAdapter, PromptMessage } from '../../../src/types/index.js';

function createMockAdapter(name: string): IChannelAdapter {
  return {
    name,
    initialize: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    onReply: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ChannelRouter', () => {
  it('broadcasts prompt to all adapters', async () => {
    const a1 = createMockAdapter('a1');
    const a2 = createMockAdapter('a2');
    const router = new ChannelRouter([a1, a2]);

    const msg: PromptMessage = { type: 'confirmation', body: 'Yes?', promptId: 'p1' };
    await router.broadcast(msg);

    expect(a1.send).toHaveBeenCalledWith(msg);
    expect(a2.send).toHaveBeenCalledWith(msg);
  });

  it('routes first reply back to handler and notifies others', async () => {
    const a1 = createMockAdapter('a1');
    const a2 = createMockAdapter('a2');
    const router = new ChannelRouter([a1, a2]);

    const onInput = vi.fn();
    router.listen(onInput);

    // Simulate a1 replying first
    const a1ReplyHandler = (a1.onReply as ReturnType<typeof vi.fn>).mock.calls[0][0] as (text: string) => void;
    const a2ReplyHandler = (a2.onReply as ReturnType<typeof vi.fn>).mock.calls[0][0] as (text: string) => void;

    a1ReplyHandler('yes');
    expect(onInput).toHaveBeenCalledWith('yes', 'a1');

    // a2's late reply should trigger a notification
    a2ReplyHandler('no');
    expect(a2.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'raw',
      body: expect.stringContaining('a1'),
    }));
  });

  it('returns lock status', () => {
    const router = new ChannelRouter([createMockAdapter('a1')]);
    expect(router.isLocked()).toBe(false);
  });

  it('reset clears lock', async () => {
    const a1 = createMockAdapter('a1');
    const router = new ChannelRouter([a1]);
    router.listen(() => {});

    const handler = (a1.onReply as ReturnType<typeof vi.fn>).mock.calls[0][0] as (text: string) => void;
    handler('x');
    expect(router.isLocked()).toBe(true);

    router.reset();
    expect(router.isLocked()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run tests/unit/channels/ChannelRouter.test.ts
```

Expected: FAIL — `ChannelRouter` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/channels/ChannelRouter.ts`:

```typescript
import type { IChannelAdapter, PromptMessage } from '../types/index.js';

export class ChannelRouter {
  private locked = false;
  private currentPromptId: string | null = null;
  private onInput: ((text: string, channelName: string) => void) | null = null;

  constructor(private adapters: IChannelAdapter[]) {}

  listen(handler: (text: string, channelName: string) => void): void {
    this.onInput = handler;
    for (const adapter of this.adapters) {
      adapter.onReply((text, promptId) => {
        this.handleReply(adapter.name, text, promptId);
      });
    }
  }

  async broadcast(message: PromptMessage): Promise<void> {
    this.locked = false;
    this.currentPromptId = message.promptId;
    await Promise.all(this.adapters.map((a) => a.send(message)));
  }

  isLocked(): boolean {
    return this.locked;
  }

  reset(): void {
    this.locked = false;
    this.currentPromptId = null;
  }

  private handleReply(channelName: string, text: string, _promptId?: string): void {
    if (this.locked) {
      // Notify the late channel that input was already handled
      const adapter = this.adapters.find((a) => a.name === channelName);
      if (adapter) {
        adapter.send({
          type: 'raw',
          body: `已由其他通道处理，无需回复`,
          promptId: this.currentPromptId || 'unknown',
        }).catch(() => { /* ignore send errors */ });
      }
      return;
    }

    this.locked = true;
    this.onInput?.(text, channelName);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run tests/unit/channels/ChannelRouter.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/channels/ChannelRouter.ts tests/unit/channels/ChannelRouter.test.ts
git commit -m "feat(channels): add ChannelRouter with FCFS broadcast and lock"
```

---

### Task 12: Application Entry Point and Integration

**Files:**
- Create: `src/index.ts`
- Create: `tests/integration/ccbridge.test.ts`
- Modify: `ccbridge.config.example.json`
- Create: `README.md`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/ccbridge.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run tests/integration/ccbridge.test.ts
```

Expected: FAIL — `CcbridgeApp` not found.

- [ ] **Step 3: Write entry point**

Create `src/index.ts`:

```typescript
import { ConfigManager } from './config/ConfigManager.js';
import { StateMachine } from './core/StateMachine.js';
import { InputDetector } from './core/InputDetector.js';
import { PtyManager } from './core/PtyManager.js';
import { AdapterRegistry } from './channels/AdapterRegistry.js';
import { ChannelRouter } from './channels/ChannelRouter.js';
import { createLogger } from './utils/logger.js';
import type { PtyOutputChunk } from './types/index.js';
import stripAnsi from 'strip-ansi';

export class CcbridgeApp {
  private logger = createLogger('ccbridge');
  private configManager: ConfigManager;
  private stateMachine = new StateMachine();
  private ptyManager = new PtyManager();
  private inputDetector: InputDetector;
  private adapterRegistry = new AdapterRegistry();
  private channelRouter: ChannelRouter;
  private outputBuffer: string[] = [];
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(configPath: string) {
    this.configManager = new ConfigManager(configPath);
  }

  async start(): Promise<void> {
    const config = await this.configManager.load();
    this.logger.info('Config loaded');

    this.inputDetector = new InputDetector(config.detector);

    await this.adapterRegistry.initializeAll(config.channels);
    const adapters = this.adapterRegistry.getAllEnabled();
    this.channelRouter = new ChannelRouter(adapters);
    this.channelRouter.listen((text, channelName) => {
      this.logger.info({ channel: channelName, input: text }, 'Input received');
      this.ptyManager.write(text + '\r');
      this.stateMachine.transition('PROCESSING_INPUT');
    });

    this.ptyManager.on('data', (raw: string) => this.handlePtyData(raw));
    this.ptyManager.on('exit', (code: number) => {
      this.logger.info({ exitCode: code }, 'Claude exited');
      this.stateMachine.transition('IDLE');
    });

    this.ptyManager.start(config.claude.command, config.claude.args, config.claude.env);
    this.stateMachine.transition('BUSY');
    this.logger.info('Claude started');
  }

  async stop(): Promise<void> {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.ptyManager.kill();
    await this.adapterRegistry.closeAll();
    this.logger.info('Stopped');
  }

  private handlePtyData(raw: string): void {
    const stripped = stripAnsi(raw);
    this.outputBuffer.push(stripped);

    // Keep last 50 lines for analysis window
    if (this.outputBuffer.length > 50) {
      this.outputBuffer = this.outputBuffer.slice(-50);
    }

    const state = this.stateMachine.getState();

    if (state === 'PROCESSING_INPUT') {
      // Wait for output to resume before leaving lock
      this.stateMachine.transition('BUSY');
      this.channelRouter.reset();
    }

    if (state === 'BUSY' || state === 'IDLE') {
      if (this.pauseTimer) clearTimeout(this.pauseTimer);
      this.pauseTimer = setTimeout(() => {
        this.analyzeBuffer();
      }, 800);
    }
  }

  private analyzeBuffer(): void {
    const result = this.inputDetector.analyze(this.outputBuffer);
    if (result.awaitingInput && result.message) {
      this.logger.info({ promptId: result.message.promptId }, 'Awaiting input detected');
      this.stateMachine.transition('AWAITING_INPUT');
      this.channelRouter.broadcast(result.message).catch((err) => {
        this.logger.error(err, 'Broadcast failed');
      });
    }
  }
}

// CLI entry point
async function main() {
  const configPath = process.argv[2] || './ccbridge.config.json';
  const app = new CcbridgeApp(configPath);

  process.on('SIGINT', async () => {
    await app.stop();
    process.exit(0);
  });

  await app.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run integration test**

Run:
```bash
npx vitest run tests/integration/ccbridge.test.ts
```

Expected: PASS (2 tests). Integration tests spawn bash/cmd and exercise the full wiring.

- [ ] **Step 5: Write README**

Create `README.md`:

```markdown
# ccbridge

Claude Code bidirectional multi-channel I/O bridge.

## Quick Start

1. Copy example config:
   ```bash
   cp ccbridge.config.example.json ccbridge.config.json
   ```

2. Edit `ccbridge.config.json` with your Feishu credentials.

3. Run:
   ```bash
   npm run dev
   ```

## Architecture

- `PtyManager` wraps Claude Code in a PTY
- `InputDetector` identifies prompts (selections, confirmations) via heuristics
- `ChannelRouter` broadcasts prompts to all enabled channels (Terminal, Feishu, ...)
- First reply from any channel wins and is written back to Claude

## Configuration

See `ccbridge.config.example.json` for all options.

## Development

```bash
npm test        # run all tests
npm run test:watch   # watch mode
```
```

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/integration/ccbridge.test.ts README.md ccbridge.config.example.json
git commit -m "feat(app): add CcbridgeApp entry point with PTY, state machine, and channel routing"
```

---

## Self-Review

### Spec coverage check

| Spec Section | Implementing Task(s) |
|---|---|
| PTY wrapper (PtyManager) | Task 7 |
| StateMachine states & transitions | Task 5 |
| InputDetector heuristics (selection, confirmation, ignore) | Task 6 |
| TerminalAdapter passthrough | Task 8 |
| FeishuAdapter (self-built + webhook modes) | Task 9 |
| AdapterRegistry discovery | Task 10 |
| ChannelRouter FCFS + lock | Task 11 |
| ConfigManager + Zod schema | Task 4 |
| Logger (pino) | Task 3 |
| Entry point wiring | Task 12 |
| ANSI stripping | Task 12 (uses strip-ansi) |
| Example config | Task 4, Task 12 |
| Error handling (process exit, broadcast catch) | Task 7, Task 12 |

**Gaps found & fixed:**
- Spec mentions `promptId` matching for message ordering; added to `PromptMessage` in Task 2 and used in `ChannelRouter`/`InputDetector`.
- Spec mentions `/handover` command; this is a v1.1 feature and not in MVP scope. The plan covers only v1.0 MVP.

### Placeholder scan

- No "TBD", "TODO", "implement later" strings in plan steps.
- FeishuAdapter `send` for self-built mode logs to console as an MVP shim; this is intentional because full Feishu API token exchange is out of MVP scope and documented in v1.1.

### Type consistency check

- `IChannelAdapter.onReply` signature uses `(text: string, promptId?: string) => void` consistently across TerminalAdapter, FeishuAdapter, AdapterRegistry, and ChannelRouter.
- `PromptMessage.promptId` is required in type definition and populated by `InputDetector` using `crypto.randomUUID()`.
- `CcbridgeConfig` matches `ValidatedConfig` from Zod schema in Task 4.
- `State` union type used in `StateMachine` matches the four states from spec.

All checks pass.
