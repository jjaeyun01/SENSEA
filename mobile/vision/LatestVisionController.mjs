export class VisionRequestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VisionRequestError";
    this.code = code;
  }
}

/**
 * One controller per camera screen. Call request() at the user's capture action,
 * before awaiting the camera. capture/describe may ignore cancellation: every
 * continuation is still checked against the current generation.
 */
export class LatestVisionController {
  constructor({
    capture,
    releasePhoto,
    describe,
    stopSpeech,
    speak,
    makeRequestId,
    onResult = () => {},
    onError = () => {},
    now = () => performance.now(),
    maxResultAgeMs = 15000,
  }) {
    for (const callback of [capture, releasePhoto, describe, stopSpeech, speak, makeRequestId, onResult, onError, now]) {
      if (typeof callback !== "function") throw new TypeError("Callbacks must be functions");
    }
    if (!Number.isFinite(maxResultAgeMs) || maxResultAgeMs <= 0) {
      throw new TypeError("maxResultAgeMs must be positive");
    }
    Object.assign(this, {
      capture, releasePhoto, describe, stopSpeech, speak, makeRequestId, onResult, onError, now, maxResultAgeMs,
    });
    this.generation = 0;
    this.stationary = false;
    this.externalProcessingConsent = false;
    this.cleanupFailed = false;
    this.disposed = false;
    this.activeAbort = null;
    this.captureChain = Promise.resolve();
    this.speechChain = Promise.resolve();
  }

  isCurrent(token) {
    return !this.disposed && this.stationary && this.externalProcessingConsent && token.generation === this.generation;
  }

  ensureFresh(token) {
    const age = this.now() - token.startedAt;
    if (!Number.isFinite(age) || age < 0 || age > this.maxResultAgeMs) {
      throw new VisionRequestError("expired_result", "This photo is too old. Please take another photo.");
    }
  }

  enqueueSpeech(operation) {
    const pending = this.speechChain.then(operation);
    // Recover the queue after a native speech error; expose that error to its caller.
    this.speechChain = pending.catch(() => {});
    return pending;
  }

  setStationary(value) {
    if (typeof value !== "boolean") throw new TypeError("stationary must be a boolean");
    this.stationary = value;
    return value ? Promise.resolve() : this.cancel();
  }

  setExternalProcessingConsent(value) {
    if (typeof value !== "boolean") throw new TypeError("consent must be a boolean");
    this.externalProcessingConsent = value;
    return value ? Promise.resolve() : this.cancel();
  }

  cancel() {
    this.generation += 1;
    this.activeAbort?.abort();
    this.activeAbort = null;
    // Serialize native stop operations so a delayed old stop cannot silence new speech.
    return this.enqueueSpeech(() => this.stopSpeech());
  }

  dispose() {
    this.disposed = true;
    return this.cancel();
  }

  async request({ expectedPlace } = {}) {
    if (this.disposed) throw new VisionRequestError("disposed", "The camera screen is closed.");
    if (this.cleanupFailed) {
      throw new VisionRequestError("photo_cleanup_failed", "Check that temporary photos were removed before restarting.");
    }
    if (!this.externalProcessingConsent) {
      throw new VisionRequestError("external_consent_required", "Consent is required to send photos to an external AI service.");
    }
    if (!this.stationary) {
      throw new VisionRequestError("stationary_required", "Stop moving before taking a photo.");
    }
    this.generation += 1;
    this.activeAbort?.abort();
    const abort = new AbortController();
    this.activeAbort = abort;
    const token = { generation: this.generation, startedAt: this.now() };
    let photo;
    try {
      await this.enqueueSpeech(() => this.stopSpeech());
      if (!this.isCurrent(token)) return null;
      const requestId = this.makeRequestId().toLowerCase();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)) {
        throw new TypeError("makeRequestId must return a UUID");
      }

      // Some native cameras cannot take two photos at once. Skip obsolete queued
      // captures, while allowing an already running camera call to finish.
      const pendingCapture = this.captureChain.then(() => {
        if (!this.isCurrent(token)) return null;
        this.ensureFresh(token);
        return this.capture();
      });
      this.captureChain = pendingCapture.catch(() => {});
      photo = await pendingCapture;
      if (!this.isCurrent(token)) return null;
      this.ensureFresh(token);
      if (!photo) throw new VisionRequestError("capture_failed", "Could not take a photo.");
      const result = await this.describe({
        photo, requestId, expectedPlace, signal: abort.signal, externalProcessingConsent: true,
      });
      if (!this.isCurrent(token)) return null;
      this.ensureFresh(token);
      const text = speechText(result, requestId);
      return await this.enqueueSpeech(async () => {
        if (!this.isCurrent(token)) return null;
        await this.stopSpeech();
        if (!this.isCurrent(token)) return null;
        this.ensureFresh(token);
        this.onResult(result);
        // An onResult handler may synchronously close the screen or cancel.
        if (!this.isCurrent(token)) return null;
        this.ensureFresh(token);
        // speak must synchronously enqueue speech (e.g. Expo Speech.speak).
        this.speak(text);
        return result;
      });
    } catch (error) {
      if (!this.isCurrent(token)) return null;
      this.onError(error);
      return null;
    } finally {
      if (this.activeAbort === abort) this.activeAbort = null;
      if (photo) {
        try { await this.releasePhoto(photo); }
        catch {
          this.cleanupFailed = true;
          this.generation += 1;
          this.activeAbort?.abort();
          await this.enqueueSpeech(() => this.stopSpeech()).catch(() => {});
          this.onError(new VisionRequestError("photo_cleanup_failed", "Could not delete a temporary photo. Check the app's temporary files."));
        }
      }
    }
  }
}

function speechText(result, requestId) {
  const invalid = () => new VisionRequestError("invalid_response", "Could not validate the photo description response.");
  if (!result || result.request_id !== requestId || result.navigation_safe !== false) throw invalid();
  if (result.status === "retake" && result.quality?.status === "retake") {
    const reasons = ["low_resolution", "too_dark", "too_bright", "low_detail"];
    if (!reasons.includes(result.quality.reason)) throw invalid();
    const text = result.quality.guidance;
    if (typeof text === "string" && text.trim() && text.length <= 300) return text;
  }
  if (result.status === "described" && result.quality?.status === "usable") {
    const surfaces = ["detected", "not_detected", "uncertain"];
    if (
      result.quality.reason !== null || result.quality.guidance !== null ||
      !["low", "medium", "high"].includes(result.uncertainty) ||
      !surfaces.includes(result.roadway) || !surfaces.includes(result.sidewalk) ||
      !Array.isArray(result.recognized_text) || result.recognized_text.length > 10 ||
      !result.recognized_text.every(text => typeof text === "string")
    ) throw invalid();
    const text = result.description;
    if (typeof text === "string" && text.trim() && text.length <= 600) {
      return result.uncertainty === "high" ? "The photo alone is not enough to be certain. " + text : text;
    }
  }
  throw invalid();
}
