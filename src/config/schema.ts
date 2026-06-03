import { z } from 'zod';

export const configSchema = z.object({
  claude: z.object({
    command: z.string().default('claude'),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).default({}),
    cwd: z.string().optional(),
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
      'Is this okay\\?',
      'Proceed\\?',
      'Should I proceed',
      'Do you want me to (continue|proceed|apply)',
      'Apply these changes',
      "Let me know if you'd like me to",
      '是否继续',
      '确认修改',
      '确认执行',
      '批准',
    ]),
    selectionPatterns: z.array(z.string()).default([
      '^\\s*[\\[\\(]\\d+[\\)\\]]\\s+',
    ]),
    invitationPatterns: z.array(z.string()).default([
      '你想从哪开始',
      'What would you like to do',
      'How can I help',
      'Send message to Claude',
      "I need to edit",
      "I'll need to edit",
      '我将修改',
      'I will make the following changes',
      "Here's what I plan to do",
    ]),
    ignorePatterns: z.array(z.string()).default([
      '^Reading\\.',
      '^Searching\\.',
      '^Thinking\\.',
      '^Updating\\.',
      '^Analyzing\\.',
      '\\(thinking\\)',
      'thought for \\d+s',
      'Whatchamacallit',
    ]),
  }),
  channels: z.object({
    terminal: z.object({ enabled: z.boolean().default(true) }),
    feishu: z.object({
      enabled: z.boolean(),
      mode: z.enum(['self-built', 'webhook', 'websocket']),
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
