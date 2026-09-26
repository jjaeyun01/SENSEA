import type { VoiceController } from './controller.ts';

export type WakeWordState = 'off' | 'starting' | 'waiting' | 'prompting' | 'listening' | 'processing' | 'error';

export interface WakeWordPorts {
  /** Bind the native detector to the custom SENSEA model. Do not upload audio. */
  startDetection(onDetected: () => void, signal: AbortSignal): Promise<void>;
  /** Idempotent: resolve only after the detector releases the microphone. */
  stopDetection(): Promise<void>;
  /** Record at most maxDurationMs, transcribe, and always delete temporary audio.
   * Abort must stop recording/network work and settle this promise promptly.
   * Resolve with an empty string for silence. End early on end-of-speech.
   */
  captureCommand(signal: AbortSignal, maxDurationMs: number): Promise<string>;
  onError(message: string): void;
}

/** Foreground-only coordination, not a native wake-word recognition engine.
 * The UI must disable this session on background, screen lock, or unmount.
 * All speech while enabled should go through announce() or onCommand.
 */
export class WakeWordSession {
  private current: WakeWordState = 'off';
  private active: AbortController | null = null;
  private pending: Promise<void> = Promise.resolve();

  constructor(private voice: VoiceController, private ports: WakeWordPorts) {}

  get state(): WakeWordState { return this.current; }

  /** Call only after explicit opt-in and microphone permission. */
  enable(): Promise<void> {
    if (this.active) return this.pending;
    const run = new AbortController();
    this.active = run;
    this.pending = this.pending.then(() => this.arm(run)).catch(() => this.fail(run));
    return this.pending;
  }

  async disable(): Promise<void> {
    this.active?.abort();
    this.active = null;
    this.current = 'off';
    // Stop immediately; queue a final cleanup after any pending native start.
    const immediate = Promise.allSettled([this.ports.stopDetection(), this.voice.stop()]);
    this.pending = this.pending.then(async () => {
      const results = await Promise.allSettled([this.ports.stopDetection(), this.voice.stop()]);
      if (results.some(result => result.status === 'rejected')) {
        this.current = 'error';
        this.ports.onError('Could not stop voice input. Please close the app.');
      }
    });
    await immediate;
    await this.pending;
  }

  /** Accessible microphone button and native wake callback use the same flow. */
  requestCommand(): Promise<void> {
    const run = this.active;
    if (!run || this.current !== 'waiting') return Promise.resolve();
    this.current = 'prompting'; // Ignore repeated detection callbacks immediately.
    this.pending = this.pending.then(async () => {
      if (!this.valid(run)) return;
      await this.ports.stopDetection();
      if (!this.valid(run)) return;
      // Do not replace the navigation instruction used by "Repeat".
      await this.voice.say('How can I help?', { remember: false });
      if (!this.valid(run)) return;
      this.current = 'listening';
      const transcript = await this.ports.captureCommand(run.signal, 15_000);
      if (!this.valid(run)) return;
      this.current = 'processing';
      if (transcript.trim()) {
        await this.voice.acceptTranscript(transcript);
      } else {
        await this.voice.say('I did not hear a command. Say SENSEA to try again.', { remember: false });
      }
      if (this.valid(run)) await this.arm(run);
    }).catch(() => this.fail(run));
    return this.pending;
  }

  /** Route and camera announcements must not overlap with wake-word detection.
   * Caller should queue announcements when this returns false (session busy).
   */
  async announce(text: string): Promise<boolean> {
    const run = this.active;
    if (!run || this.current !== 'waiting') return false;
    this.current = 'prompting';
    this.pending = this.pending.then(async () => {
      if (!this.valid(run)) return;
      await this.ports.stopDetection();
      if (!this.valid(run)) return;
      await this.voice.say(text);
      if (this.valid(run)) await this.arm(run);
    }).catch(() => this.fail(run));
    await this.pending;
    return this.valid(run);
  }

  private valid(run: AbortController): boolean {
    return this.active === run && !run.signal.aborted;
  }

  private async arm(run: AbortController): Promise<void> {
    if (!this.valid(run)) return;
    this.current = 'starting';
    await this.ports.startDetection(() => {
      if (this.valid(run)) void this.requestCommand();
    }, run.signal);
    if (this.valid(run)) this.current = 'waiting';
  }

  private async fail(run: AbortController): Promise<void> {
    if (!this.valid(run)) return;
    run.abort();
    this.active = null;
    this.current = 'error';
    await Promise.allSettled([this.ports.stopDetection(), this.voice.stop()]);
    this.ports.onError('Voice control is unavailable. Please use the on-screen controls or enable voice control again.');
  }
}
