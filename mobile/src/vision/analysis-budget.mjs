/** Give basic obstacle inference CPU headroom before enabling the optional model. */
export class AnalysisBudget {
  constructor() { this.enabled = false; this.reset(); }
  reset() { this.enabled = false; this.fast = 0; this.lastAt = -Infinity; this.lastNow = -Infinity; this.resumeAt = 0; }
  suspend(now) { this.enabled = false; this.fast = 0; this.resumeAt = now + 10000; return false; }
  tick(now) {
    if (!Number.isFinite(now) || now < this.lastNow) { this.reset(); return false; }
    this.lastNow = now;
    if (this.enabled && now - this.lastAt > 1000) this.suspend(now);
    return this.enabled;
  }
  observe(result, now) {
    this.tick(now);
    const age = now - result?.receivedAt;
    if (!Number.isFinite(age) || age < 0 || age > 1000 || result.receivedAt <= this.lastAt) return this.enabled;
    if (result.receivedAt - this.lastAt > 1000) this.fast = 0;
    this.lastAt = result.receivedAt;
    if (!Number.isFinite(result.processedMs) || result.processedMs < 0 || result.processedMs > 650 || age > 900)
      return this.suspend(now);
    if (result.quality?.status === "usable" && result.processedMs <= 350) this.fast = Math.min(3, this.fast + 1);
    else this.fast = 0;
    if (this.fast >= 3 && now >= this.resumeAt) this.enabled = true;
    return this.enabled;
  }
}
