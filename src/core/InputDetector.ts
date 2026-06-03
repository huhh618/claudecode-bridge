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

  analyze(lines: string[], raw?: string): AnalysisResult {
    const filtered = lines
      .filter((line) => !this.isIgnored(line))
      .filter((line) => !this.isJunk(line));

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

    const ansiInteractive = raw ? this.detectAnsiInteractive(raw) : false;

    const hasOptions = selectionMatches.length >= 2;

    const buildBody = (source: string[]) => {
      const recent = source.slice(-40);
      return recent
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    };

    if (hasOptions) {
      return {
        awaitingInput: true,
        message: {
          type: 'selection',
          body: buildBody(filtered),
          options: selectionMatches,
          promptId: crypto.randomUUID(),
        },
      };
    }

    if (confirmationMatch || invitationMatch || ansiInteractive || (hasPromptEnd && filtered.length > 0)) {
      return {
        awaitingInput: true,
        message: {
          type: confirmationMatch ? 'confirmation' : 'question',
          body: buildBody(filtered),
          promptId: crypto.randomUUID(),
        },
      };
    }

    return { awaitingInput: false };
  }

  /**
   * Detect interactive UI patterns (review/approval screens) via ANSI sequences.
   * These are common in Claude Code's review interface where cursor positioning
   * and reverse video (highlighting) are used to render selectable options.
   */
  private detectAnsiInteractive(raw: string): boolean {
    // Cursor positioning: ESC[row;colH or ESC[H
    const cursorPos = /\x1b\[[0-9;]*[Hf]/.test(raw);
    // Reverse video (highlight): ESC[7m
    const reverseVideo = /\x1b\[7m/.test(raw);
    // Bold: ESC[1m
    const bold = /\x1b\[1m/.test(raw);
    // Cursor hide: ESC[?25l (interactive UIs often hide cursor)
    const cursorHide = /\x1b\[\?25l/.test(raw);

    // Interactive menu signature: cursor positioning + (reverse video or bold or cursor hide)
    return cursorPos && (reverseVideo || bold || cursorHide);
  }

  private isIgnored(line: string): boolean {
    return this.ignoreRes.some((re) => re.test(line));
  }

  private isJunk(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.length === 0) return false;

    // Spinner residues: 1-3 chars without letters/digits/Chinese
    if (trimmed.length <= 3 && /^[^a-zA-Z0-9\u4e00-\u9fa5]+$/.test(trimmed)) {
      return true;
    }

    // Box-drawing / block separator lines
    if (/^[\u2500-\u257F\s]+$/.test(trimmed)) {
      return true;
    }

    return false;
  }
}
