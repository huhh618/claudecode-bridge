import type { PromptMessage } from '../types/index.js';

interface DetectorConfig {
  confirmationPatterns: string[];
  selectionPatterns: string[];
  invitationPatterns: string[];
  ignorePatterns: string[];
}

interface AnalysisResult {
  awaitingInput: boolean;
  message?: PromptMessage;
}

export class InputDetector {
  private confirmationRes: RegExp[];
  private selectionRes: RegExp[];
  private invitationRes: RegExp[];
  private ignoreRes: RegExp[];

  constructor(private config: DetectorConfig) {
    this.confirmationRes = config.confirmationPatterns.map((p) => new RegExp(p, 'i'));
    this.selectionRes = config.selectionPatterns.map((p) => new RegExp(p, 'i'));
    this.invitationRes = config.invitationPatterns.map((p) => new RegExp(p, 'i'));
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

    const invitationMatch = filtered.some((line) =>
      this.invitationRes.some((re) => re.test(line))
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

    if (confirmationMatch || invitationMatch || (hasPromptEnd && filtered.length > 0)) {
      return {
        awaitingInput: true,
        message: {
          type: confirmationMatch ? 'confirmation' : (invitationMatch ? 'question' : 'question'),
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
