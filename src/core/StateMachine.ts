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
