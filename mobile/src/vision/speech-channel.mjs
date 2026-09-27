/** One pending utterance only; a warning can replace ordinary speech before stop resolves. */
export class LatestSpeechChannel {
  constructor({ stop, speak, isAllowed, now = () => Date.now() }) {
    this.stop = stop; this.speak = speak; this.isAllowed = isAllowed; this.now = now;
    this.pending = null; this.inFlight = null; this.draining = null; this.revision = 0;
  }
  fresh(message) {
    const age = this.now() - message.receivedAt;
    return Number.isFinite(age) && age >= 0 && age <= 1000;
  }
  offer(message) {
    if (!message || typeof message.text !== "string" || !message.text.trim() ||
        !this.fresh(message) || !this.isAllowed(!!message.manual)) return false;
    // While a warning is waiting, ordinary observations must not replace it.
    const waiting = this.pending ?? this.inFlight;
    if (waiting?.priority && !message.priority && !message.manual) return false;
    if (this.pending) this.drop(this.pending);
    this.pending = { text: message.text, receivedAt: message.receivedAt,
      manual: !!message.manual, priority: !!message.priority, onDropped: message.onDropped };
    this.revision++;
    this.pump();
    return true;
  }
  pump() {
    if (this.draining) return;
    this.draining = this.drain().finally(() => {
      this.draining = null;
      // An offer may arrive in the microtask between drain completion and finally.
      if (this.pending) this.pump();
    });
  }
  async drain() {
    while (this.pending) {
      const message = this.pending, revision = this.revision;
      this.pending = null; this.inFlight = message;
      let delivered = false;
      try {
        await this.stop();
        if (revision === this.revision && !this.pending && this.fresh(message) &&
            this.isAllowed(message.manual)) {
          this.speak(message.text, message.manual);
          delivered = true;
        }
      } catch { /* A speech-engine failure must not stop camera processing. */ }
      if (!delivered) this.drop(message);
      this.inFlight = null;
    }
  }
  drop(message) {
    try { message.onDropped?.(); } catch { /* Diagnostic callback must not break delivery. */ }
  }
  cancel() {
    this.revision++;
    if (this.pending) this.drop(this.pending);
    this.pending = null;
    try { Promise.resolve(this.stop()).catch(() => {}); } catch { /* Already unavailable. */ }
  }
}
