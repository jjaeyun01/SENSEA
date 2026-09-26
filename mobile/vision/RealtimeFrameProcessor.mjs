/**
 * Owns at most one analyzing frame and one pending frame. Frames must be
 * independently owned small buffers, never borrowed native callback handles.
 * No HTTP, image history, unbounded Promise chain or automatic speech.
 */
export class RealtimeFrameProcessor {
  constructor({
    analyze, onResult = () => {}, onError = () => {},
    minIntervalMs = 200, maxResultAgeMs = 1000, analysisTimeoutMs = 1500,
    maxFrameBytes = 512 * 1024,
    now = () => performance.now(),
    schedule = (callback, delay) => setTimeout(callback, delay),
    unschedule = timer => clearTimeout(timer),
  }) {
    for (const callback of [analyze, onResult, onError, now, schedule, unschedule]) {
      if (typeof callback !== "function") throw new TypeError("Callbacks must be functions");
    }
    for (const limit of [maxResultAgeMs, analysisTimeoutMs, maxFrameBytes]) {
      if (!Number.isFinite(limit) || limit <= 0) throw new TypeError("Limits must be positive");
    }
    if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
      throw new TypeError("minIntervalMs must be nonnegative");
    }
    Object.assign(this, {
      analyze, onResult, onError, minIntervalMs, maxResultAgeMs, analysisTimeoutMs,
      maxFrameBytes, now, schedule, unschedule,
    });
    this.enabled = false;
    this.disposed = false;
    this.generation = 0;
    this.active = null;
    this.pending = null;
    this.wakeTimer = null;
    this.lastStartedAt = -Infinity;
    this.seen = new WeakSet();
    this.counts = {
      received: 0, analyzed: 0, delivered: 0, dropped: 0, released: 0,
      errors: 0, timeouts: 0, peakRetainedFrames: 0, peakRetainedBytes: 0,
    };
  }

  start() {
    if (this.disposed) throw new Error("Processor is disposed");
    if (this.enabled) return;
    this.enabled = true;
    this.generation += 1;
    this.lastStartedAt = -Infinity;
    this.pump();
  }

  pause() {
    this.enabled = false;
    this.generation += 1;
    if (this.wakeTimer !== null) this.unschedule(this.wakeTimer);
    this.wakeTimer = null;
    this.dropPending();
    // Cancellation is advisory. Do not free memory still used by the analyzer.
    this.active?.abort.abort();
  }

  dispose() {
    this.disposed = true;
    this.pause();
  }

  offer(frame) {
    if (!frame || typeof frame.release !== "function") {
      throw new TypeError("An owned frame with a synchronous release function is required");
    }
    if (this.seen.has(frame)) throw new TypeError("A frame lease may only be offered once");
    this.seen.add(frame);
    this.counts.received += 1;
    if (!this.enabled || this.disposed || !this.validFrame(frame)) {
      this.counts.dropped += 1;
      this.release(frame);
      return false;
    }
    this.dropPending();
    // A failed release pauses the processor.
    if (!this.enabled) {
      this.counts.dropped += 1;
      this.release(frame);
      return false;
    }
    this.pending = frame;
    this.recordPeak();
    this.pump();
    return true;
  }

  validFrame(frame) {
    const { data, width, height, capturedAt } = frame;
    const stride = frame.rowStride ?? width;
    const age = this.now() - capturedAt;
    return data instanceof Uint8Array &&
      // Check the backing allocation too: a tiny view can keep a large buffer alive.
      data.buffer.byteLength <= this.maxFrameBytes &&
      [width, height, stride].every(value => Number.isSafeInteger(value) && value > 0) &&
      stride >= width && (height - 1) * stride + width <= data.length &&
      Number.isFinite(capturedAt) && age >= 0 && age <= this.maxResultAgeMs;
  }

  dropPending() {
    const frame = this.pending;
    this.pending = null;
    if (frame) {
      this.counts.dropped += 1;
      this.release(frame);
    }
  }

  release(frame) {
    try {
      frame.release();
      this.counts.released += 1;
    } catch (error) {
      this.pause();
      this.report(error);
    }
  }

  report(error) {
    this.counts.errors += 1;
    // Application callbacks must not break resource cleanup.
    try { this.onError(error); } catch { /* Already counted; no frame logging. */ }
  }

  getStats() {
    const frames = [this.active?.frame, this.pending].filter(Boolean);
    return {
      ...this.counts,
      inFlight: this.active ? 1 : 0,
      pending: this.pending ? 1 : 0,
      retainedFrames: frames.length,
      retainedBytes: frames.reduce((sum, frame) => sum + frame.data.buffer.byteLength, 0),
      enabled: this.enabled,
    };
  }

  recordPeak() {
    const stats = this.getStats();
    this.counts.peakRetainedFrames = Math.max(this.counts.peakRetainedFrames, stats.retainedFrames);
    this.counts.peakRetainedBytes = Math.max(this.counts.peakRetainedBytes, stats.retainedBytes);
  }

  pump() {
    if (!this.enabled || this.active || !this.pending || this.wakeTimer !== null) return;
    if (this.now() - this.pending.capturedAt > this.maxResultAgeMs) {
      this.dropPending();
      return;
    }
    const delay = this.lastStartedAt + this.minIntervalMs - this.now();
    if (delay > 0) {
      this.wakeTimer = this.schedule(() => {
        this.wakeTimer = null;
        this.pump();
      }, delay);
      return;
    }
    const task = {
      frame: this.pending, generation: this.generation, abort: new AbortController(),
      startedAt: this.now(),
    };
    this.pending = null;
    this.active = task;
    this.lastStartedAt = task.startedAt;
    this.recordPeak();
    const deadline = this.schedule(() => {
      if (this.active !== task || !this.enabled || task.generation !== this.generation) return;
      this.counts.timeouts += 1;
      this.pause();
      this.report(new Error("Local frame analysis timed out; restart the analyzer before resuming"));
    }, this.analysisTimeoutMs);
    void this.run(task, deadline);
  }

  async run(task, deadline) {
    try {
      this.counts.analyzed += 1;
      const result = await this.analyze(task.frame, { signal: task.abort.signal });
      const ageMs = this.now() - task.frame.capturedAt;
      if (this.enabled && task.generation === this.generation && ageMs <= this.maxResultAgeMs) {
        // New arrivals do not invalidate a still-fresh completed result; otherwise
        // a camera faster than inference would suppress every result forever.
        this.onResult(result, { capturedAt: task.frame.capturedAt, ageMs });
        this.counts.delivered += 1;
      }
    } catch (error) {
      if (this.enabled && task.generation === this.generation) this.report(error);
    } finally {
      this.unschedule(deadline);
      this.active = null;
      this.release(task.frame);
      this.pump();
    }
  }
}
