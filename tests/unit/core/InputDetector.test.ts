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
});
