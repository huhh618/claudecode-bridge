import { describe, it, expect } from 'vitest';
import { InputDetector } from '../../../src/core/InputDetector.js';

describe('InputDetector', () => {
  const defaultConfig = {
    confirmationPatterns: ['\\[Y/n\\]', 'Confirm\\?'],
    selectionPatterns: ['^\\s*[\\[\\(]\\d+[\\)\\]]\\s+'],
    invitationPatterns: ['你想从哪开始', 'What would you like to do', 'How can I help'],
    ignorePatterns: ['^Reading', '^Thinking'],
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

  it('detects invitation/greeting prompts', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = [
      '作为 Claude Code，我可以帮你处理各种软件工程任务：',
      '核心能力',
      '  - 编码与修改：写新功能、修 bug、重构代码、添加测试',
      '  - 代码理解：解释代码逻辑、分析依赖关系、审查 PR',
      '如果你手头有具体的代码问题，直接告诉我就好。',
      '你想从哪开始？',
    ];
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.type).toBe('question');
    expect(result.message?.body).toContain('你想从哪开始？');
  });

  it('detects English invitation prompts', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = [
      'Tip: Send message to Claude while',
      'What would you like to do?',
    ];
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.type).toBe('question');
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

  it('does not detect selection with only one option', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = ['Choose:', '[1] Only option'];
    const result = detector.analyze(lines);
    // Single option should not trigger selection, but may trigger question via promptEnd
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.type).toBe('question');
  });

  it('returns false when all lines are ignored', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = ['Reading files...', 'Thinking...', 'Searching...'];
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(false);
  });

  it('detects prompt ending with colon', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = ['Please select an option:'];
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.type).toBe('question');
  });

  it('detects prompt ending with bare >', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = ['Enter your choice:', '> '];
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.type).toBe('question');
  });

  it('detects confirmation without options', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = ['Do you want to proceed? [Y/n]'];
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.type).toBe('confirmation');
  });

  it('returns false for empty lines array', () => {
    const detector = new InputDetector(defaultConfig);
    const result = detector.analyze([]);
    expect(result.awaitingInput).toBe(false);
  });

  it('detects invitation without other prompt markers', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = ['How can I help you today?'];
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.type).toBe('question');
  });

  it('includes promptId in message', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = ['Proceed? [Y/n]'];
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.promptId).toBeDefined();
    expect(typeof result.message?.promptId).toBe('string');
  });

  it('detects ANSI interactive menu via cursor positioning + reverse video', () => {
    const detector = new InputDetector(defaultConfig);
    const raw = '\x1b[2J\x1b[H\x1b[7m Review changes \x1b[0m\x1b[?25l';
    const result = detector.analyze([''], raw);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.type).toBe('question');
  });

  it('detects ANSI interactive menu via cursor positioning + bold', () => {
    const detector = new InputDetector(defaultConfig);
    const raw = '\x1b[H\x1b[1m Select option \x1b[0m';
    const result = detector.analyze(['some text'], raw);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.type).toBe('question');
  });

  it('does not detect plain color output as interactive', () => {
    const detector = new InputDetector(defaultConfig);
    const raw = '\x1b[32mhello\x1b[0m \x1b[34mworld\x1b[0m';
    const result = detector.analyze(['hello world'], raw);
    expect(result.awaitingInput).toBe(false);
  });

  it('does not detect cursor positioning alone as interactive', () => {
    const detector = new InputDetector(defaultConfig);
    const raw = '\x1b[H some text';
    const result = detector.analyze(['some text'], raw);
    expect(result.awaitingInput).toBe(false);
  });

  it('detects ANSI interactive even without prompt markers', () => {
    const detector = new InputDetector(defaultConfig);
    // Simulate a review screen with cursor positioning, reverse video, and cursor hide
    const raw = '\x1b[2J\x1b[1;1H\x1b[7m[ ] Approve\x1b[0m \x1b[?25l';
    const lines = ['[ ] Approve'];
    const result = detector.analyze(lines, raw);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.type).toBe('question');
  });

  it('filters thinking spinner lines', () => {
    const detector = new InputDetector({
      ...defaultConfig,
      ignorePatterns: [...defaultConfig.ignorePatterns, '\\(thinking\\)'],
    });
    const lines = ['✻(thinking)', '(thinking)', 'Proceed? [Y/n]'];
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.body).not.toContain('(thinking)');
  });

  it('filters junk spinner residues', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = ['●', '·', 'Proceed? [Y/n]'];
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.body).not.toContain('●');
    expect(result.message?.body).not.toContain('·');
  });

  it('filters box-drawing separator lines', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = ['────────────────────────────────────', 'Proceed? [Y/n]'];
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.body).not.toContain('────');
  });

  it('limits body to recent 40 lines', () => {
    const detector = new InputDetector(defaultConfig);
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
    lines.push('Proceed? [Y/n]');
    const result = detector.analyze(lines);
    expect(result.awaitingInput).toBe(true);
    expect(result.message?.body).not.toContain('line 1');
    expect(result.message?.body).not.toContain('line 21');
    expect(result.message?.body).toContain('line 22');
    expect(result.message?.body).toContain('line 60');
    expect(result.message?.body).toContain('Proceed? [Y/n]');
  });
});
