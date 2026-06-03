import { spawn, type IPty } from 'node-pty';
import { EventEmitter } from 'events';

export class PtyManager extends EventEmitter {
  private pty: IPty | null = null;

  start(command: string, args: string[], env: Record<string, string>, cwd?: string): void {
    this.pty = spawn(command, args, {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      env: { ...process.env, ...env },
      cwd,
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
