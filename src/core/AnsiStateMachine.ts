interface Cell {
  char: string;
  bold: boolean;
  reverse: boolean;
  color: number;
}

const MAX_ROWS = 50;

export class AnsiStateMachine {
  private cursorRow = 0;
  private cursorCol = 0;
  private bold = false;
  private reverse = false;
  private color = 0;
  private cursorHidden = false;
  private grid = new Map<string, Cell>();
  private maxRow = 0;
  private firstRow = 0;

  process(raw: string): void {
    let i = 0;
    const len = raw.length;

    while (i < len) {
      const ch = raw[i];

      if (ch === '\x1b' && i + 1 < len && raw[i + 1] === '[') {
        // CSI sequence
        const seqStart = i + 2;
        let j = seqStart;
        while (j < len) {
          const c = raw.charCodeAt(j);
          // Final byte: 0x40–0x7E
          if (c >= 0x40 && c <= 0x7e) {
            break;
          }
          j++;
        }
        if (j < len) {
          const params = raw.slice(seqStart, j);
          const cmd = raw[j];
          this.handleCsi(params, cmd);
          i = j + 1;
          continue;
        }
        // malformed: skip the ESC
        i++;
        continue;
      }

      if (ch === '\r') {
        this.cursorCol = 0;
        i++;
        continue;
      }

      if (ch === '\n') {
        this.cursorRow++;
        this.cursorCol = 0;
        this.maxRow = Math.max(this.maxRow, this.cursorRow);
        this.slideWindow();
        i++;
        continue;
      }

      if (ch === '\x08') {
        // Backspace
        this.cursorCol = Math.max(0, this.cursorCol - 1);
        i++;
        continue;
      }

      // Printable character (simplified: treat everything else as printable)
      this.setCell(this.cursorRow, this.cursorCol, {
        char: ch,
        bold: this.bold,
        reverse: this.reverse,
        color: this.color,
      });
      this.cursorCol++;
      i++;
    }
  }

  getLine(row: number): Cell[] {
    const cells: Cell[] = [];
    let maxCol = -1;

    // Find max col for this row
    for (const key of this.grid.keys()) {
      const [r, cStr] = key.split(':');
      if (Number(r) === row) {
        maxCol = Math.max(maxCol, Number(cStr));
      }
    }

    if (maxCol < 0) return [];

    for (let c = 0; c <= maxCol; c++) {
      const cell = this.grid.get(`${row}:${c}`);
      cells.push(cell || { char: ' ', bold: false, reverse: false, color: 0 });
    }
    return cells;
  }

  getLastLines(count: number): Cell[][] {
    const result: Cell[][] = [];
    const start = Math.max(0, this.maxRow - count + 1);
    for (let r = start; r <= this.maxRow; r++) {
      result.push(this.getLine(r));
    }
    return result;
  }

  getLastPlainLines(count: number): string[] {
    return this.getLastLines(count).map((line) =>
      line.map((c) => c.char).join('').trimEnd()
    );
  }

  isCursorAtBottom(): boolean {
    return this.cursorRow >= this.maxRow - 2;
  }

  hasInteractiveFeatures(): boolean {
    const lines = this.getLastLines(15);

    // Feature 1: Button UI like "[ Yes ] [ No ]" with styling
    let styledButtonCount = 0;
    for (const line of lines) {
      const text = line.map((c) => c.char).join('');
      const buttonMatches = text.matchAll(/\[\s*[^\]]+\s*\]/g);
      for (const match of buttonMatches) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        const hasStyle = line
          .slice(start, end)
          .some((c) => c.bold || c.reverse || c.color > 0);
        if (hasStyle) styledButtonCount++;
      }
    }
    if (styledButtonCount >= 2) return true;

    // Feature 2: Reverse-video highlight regions (selection menus)
    for (const line of lines) {
      if (line.some((c) => c.reverse)) return true;
    }

    // Feature 3: Cursor hidden and near bottom (typical for interactive menus)
    if (this.cursorHidden && this.cursorRow >= this.maxRow - 3) return true;

    // Feature 4: Bold + color combo on bracketed text (buttons without reverse)
    for (const line of lines) {
      const hasBold = line.some((c) => c.bold);
      const hasColor = line.some((c) => c.color > 0);
      if (hasBold && hasColor) {
        const text = line.map((c) => c.char).join('');
        if (/\[\s*[^\]]+\s*\]/.test(text)) return true;
      }
    }

    // Feature 5: Cursor positioned at top with styled text (interactive menu header)
    if (this.cursorRow <= 2 && this.maxRow <= 5) {
      for (const line of lines) {
        if (line.some((c) => c.bold || c.reverse)) return true;
      }
    }

    return false;
  }

  private handleCsi(params: string, cmd: string): void {
    switch (cmd) {
      case 'H':
      case 'f': {
        const parts = params.split(';').map((p) => Number(p || '1'));
        this.cursorRow = (parts[0] || 1) - 1;
        this.cursorCol = (parts[1] || 1) - 1;
        break;
      }
      case 'A':
        this.cursorRow -= Math.max(1, Number(params || '1'));
        break;
      case 'B':
        this.cursorRow += Math.max(1, Number(params || '1'));
        break;
      case 'C':
        this.cursorCol += Math.max(1, Number(params || '1'));
        break;
      case 'D':
        this.cursorCol -= Math.max(1, Number(params || '1'));
        break;
      case 'G':
        this.cursorCol = Math.max(1, Number(params || '1')) - 1;
        break;
      case 'm': {
        const codes = params.split(';').map((p) => Number(p || '0'));
        if (codes.length === 0 || (codes.length === 1 && codes[0] === 0)) {
          this.bold = false;
          this.reverse = false;
          this.color = 0;
        }
        for (const code of codes) {
          if (code === 0) {
            this.bold = false;
            this.reverse = false;
            this.color = 0;
          } else if (code === 1) this.bold = true;
          else if (code === 7) this.reverse = true;
          else if (code === 22) this.bold = false;
          else if (code === 27) this.reverse = false;
          else if (code >= 30 && code <= 37) this.color = code;
          else if (code >= 90 && code <= 97) this.color = code;
        }
        break;
      }
      case 'J': {
        const n = Number(params || '0');
        if (n === 0) {
          // Erase from cursor to end of screen
          for (const key of this.grid.keys()) {
            const [rStr, cStr] = key.split(':');
            const r = Number(rStr);
            const c = Number(cStr);
            if (r > this.cursorRow) {
              this.grid.delete(key);
            } else if (r === this.cursorRow && c >= this.cursorCol) {
              this.grid.delete(key);
            }
          }
        } else if (n === 2) {
          // Erase entire screen
          this.grid.clear();
          this.firstRow = this.cursorRow;
          this.maxRow = this.cursorRow;
        }
        break;
      }
      case 'K': {
        const n = Number(params || '0');
        if (n === 2) {
          for (let c = 0; c < 300; c++) {
            this.grid.delete(`${this.cursorRow}:${c}`);
          }
        } else if (n === 0) {
          for (let c = this.cursorCol; c < 300; c++) {
            this.grid.delete(`${this.cursorRow}:${c}`);
          }
        } else if (n === 1) {
          for (let c = 0; c <= this.cursorCol; c++) {
            this.grid.delete(`${this.cursorRow}:${c}`);
          }
        }
        break;
      }
      case 'h':
      case 'l': {
        if (params.startsWith('?25')) {
          this.cursorHidden = cmd === 'l';
        }
        break;
      }
    }
  }

  private setCell(row: number, col: number, cell: Cell): void {
    this.grid.set(`${row}:${col}`, cell);
  }

  private slideWindow(): void {
    if (this.cursorRow > this.firstRow + MAX_ROWS) {
      const newFirst = this.cursorRow - MAX_ROWS;
      for (const key of this.grid.keys()) {
        const row = Number(key.split(':')[0]);
        if (row < newFirst) {
          this.grid.delete(key);
        }
      }
      this.firstRow = newFirst;
    }
  }
}
