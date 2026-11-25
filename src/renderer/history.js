// Linear undo/redo stack of serialized snapshots.
export class History {
  constructor(limit = 200) { this.limit = limit; this.stack = []; this.index = -1; }
  reset(snap) { this.stack = [snap]; this.index = 0; }
  push(snap) {
    if (snap === this.stack[this.index]) return false;
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(snap);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    return true;
  }
  undo() { return this.index > 0 ? this.stack[--this.index] : null; }
  redo() { return this.index < this.stack.length - 1 ? this.stack[++this.index] : null; }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.stack.length - 1; }
}
