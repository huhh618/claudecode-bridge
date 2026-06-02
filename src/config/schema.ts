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
