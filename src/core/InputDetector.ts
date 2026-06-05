import type { PromptMessage } from '../types/index.js';
import { AnsiStateMachine } from './AnsiStateMachine.js';

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

  analyze(_lines: string[], raw?: string): AnalysisResult {
    let plainLines: string[];
    let ansiInteractive = false;
    let hasInputPrompt = false;

    if (raw) {
      const asm = new AnsiStateMachine();
      asm.process(raw);
      plainLines = asm.getLastPlainLines(50);
      ansiInteractive = asm.hasInteractiveFeatures();
      const lastLine = plainLines[plainLines.length - 1]?.trim();
      hasInputPrompt = asm.isCursorAtBottom() && lastLine !== undefined && /^\s*>\s*$/.test(lastLine);
    } else {
      plainLines = _lines.slice(-50);
    }

    const filtered = plainLines
      .filter((line) => !this.isIgnored(line))
      .filter((line) => !this.isJunk(line));

    // Also filter _lines for selection detection because AnsiStateMachine
    // may miss lines that were rendered via complex terminal updates.
    const filteredLines = _lines.slice(-50)
      .filter((line) => !this.isIgnored(line))
      .filter((line) => !this.isJunk(line));

    // 1. Selection list detection — use union of both sources
    const selectionMatches = [...new Set([...filtered, ...filteredLines])].filter((line) =>
      this.selectionRes.some((re) => re.test(line))
    );
    const hasOptions = selectionMatches.length >= 2;

    // 2. Confirmation detection
    const confirmationMatch = filtered.some((line) =>
      this.confirmationRes.some((re) => re.test(line))
    );

    // 3. Invitation detection
    const invitationMatch = filtered.some((line) =>
      this.invitationRes.some((re) => re.test(line))
    );

    // 4. Prompt-ending punctuation — only check the last few lines.
    // Prompts appear at the end of output; mid-text questions/colons are false positives.
    const lastFewLines = filtered.slice(-3);
    const hasPromptEnd = lastFewLines.some((line) => {
      const trimmed = line.trim();
      // Standalone prompt cursor (Claude Code input line)
      if (/^\s*>\s*$/.test(trimmed)) return true;
      // Question mark: require substantive text before it, and reject log prefixes like "Error?"
      if (trimmed.endsWith('?')) {
        const before = trimmed.slice(0, -1).trim();
        return before.length >= 3 && !/^(Error|Warning|INFO|DEBUG|Trace|Exception)$/i.test(before);
      }
      // Colon: require substantive text and reject common log prefixes like "Error:", "at foo:"
      if (trimmed.endsWith(':')) {
        const before = trimmed.slice(0, -1).trim();
        return before.length >= 3 && !/^(Error|Warning|INFO|DEBUG|TRACE|FATAL|at\s+\S+|\S+\s+failed)$/i.test(before);
      }
      return false;
    });

    const buildBody = (source: string[]) => {
      const recent = source.slice(-40);
      // Strip terminal UI border residues and dedent common leading whitespace
      const cleaned = recent.map((line) =>
        line.replace(/^[│║╎╏├┤┌┐└┘\s]+/, '').replace(/[│║╎╏├┤┌┐└┘\s]+$/, '')
      );
      const nonEmpty = cleaned.filter((l) => l.trim().length > 0);
      const minIndent = nonEmpty.length > 0
        ? Math.min(...nonEmpty.map((l) => l.length - l.trimStart().length))
        : 0;
      const dedented = cleaned.map((l) => (l.trim().length > 0 ? l.slice(minIndent) : l));
      return dedented
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    };

    const body = buildBody(filtered);
    if (!body) {
      return { awaitingInput: false };
    }

    if (hasOptions) {
      return {
        awaitingInput: true,
        message: {
          type: 'selection',
          body,
          options: selectionMatches,
          promptId: crypto.randomUUID(),
        },
      };
    }

    if (confirmationMatch || invitationMatch || ansiInteractive || hasInputPrompt || (hasPromptEnd && filtered.length > 0)) {
      return {
        awaitingInput: true,
        message: {
          type: confirmationMatch ? 'confirmation' : 'question',
          body,
          promptId: crypto.randomUUID(),
        },
      };
    }

    return { awaitingInput: false };
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

    // Terminal UI border lines with content (e.g. │ Welcome back! │)
    if (/^[│║╎╏├┤┌┐└┘].*[│║╎╏├┤┌┐└┘]$/.test(trimmed)) {
      return true;
    }

    // Claude Code splash screen elements
    if (/Welcome back!/.test(trimmed)) return true;
    if (/Tips for getting started/.test(trimmed)) return true;
    if (/Recent activity/.test(trimmed)) return true;
    if (/No recent activity/.test(trimmed)) return true;
    if (/API Usage Billing/.test(trimmed)) return true;
    if (/Run \/init to create a CLAUDE\.md/.test(trimmed)) return true;

    // Claude Code version header
    if (/Claude Code v\d+\.\d+/.test(trimmed)) return true;

    // Claude Code thinking animations
    if (/Infusing[…\.]+/.test(trimmed)) return true;
    if (/Smooshing[…\.]+/.test(trimmed)) return true;
    if (/\(thinking\)/.test(trimmed)) return true;
    if (/thought for \d+s/.test(trimmed)) return true;
    if (/inking\)/.test(trimmed)) return true; // residue of (thinking)

    // Standalone spinner chars that leaked into longer lines
    if (/^[✢✶✻✽●·⏵\s]+/.test(trimmed) && /Infusing|thinking|Smooshing/.test(trimmed)) {
      return true;
    }

    // Claude Code status indicators — filter ALL lines starting with ● or ⏵
    // (these are spinner/status indicators, never conversation content)
    if (/^[●⏵]\s+\S/.test(trimmed)) return true;

    // Claude Code file-read hints
    if (/^Read \d+ file.*\(ctrl\+o/.test(trimmed)) return true;

    // Claude Code tip box (⎿ Tip: ...)
    if (/^[⎿]\s+Tip:/.test(trimmed)) return true;

    // Command-approval system hints
    if (/^>.*requires approval/.test(trimmed)) return true;

    // Help hints shown below prompts
    if (/^Esc to cancel/.test(trimmed)) return true;
    if (/esc to interrupt/.test(trimmed)) return true;
    if (/Tab to amend/.test(trimmed)) return true;
    if (/ctrl\+e to explain/.test(trimmed)) return true;

    // Separator lines mixed with labels (e.g. "──────────── Bash command")
    if (/^[_\-─═]+.*\s+(command|file|Bash)/i.test(trimmed)) return true;

    // Command-approval option prefixes with action hints
    if (/shift\+tab to cycle\).*(esc|ctrl)/.test(trimmed)) return true;

    // User input echo (Claude Code prompt: "> user text")
    // Keep bare ">" for prompt detection, but filter echoed user input
    if (/^>\s+\S/.test(trimmed)) return true;

    // Edit-mode hints
    if (/accept edits on/.test(trimmed)) return true;
    if (/shift\+tab to cycle/.test(trimmed)) return true;

    return false;
  }
}
