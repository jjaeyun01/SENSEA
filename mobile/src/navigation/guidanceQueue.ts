export type GuidancePriority = 0 | 1 | 2 | 3;

export type GuidanceMessage = {
  id: string;
  priority: GuidancePriority;
  text: string;
};

type QueuedMessage = GuidanceMessage & { sequence: number };

/** Lower priority numbers are more urgent. Messages with equal priority remain FIFO. */
export class GuidanceQueue {
  private messages: QueuedMessage[] = [];
  private sequence = 0;

  enqueue(message: GuidanceMessage): void {
    this.messages.push({ ...message, sequence: this.sequence++ });
    this.messages.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
  }

  next(): GuidanceMessage | undefined {
    const message = this.messages.shift();
    if (!message) return undefined;
    const { sequence: _sequence, ...result } = message;
    return result;
  }

  clear(): void {
    this.messages = [];
  }

  get size(): number {
    return this.messages.length;
  }
}

