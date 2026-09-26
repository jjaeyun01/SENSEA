import { parseCommand } from './commands.ts';
import type { VoiceCommand } from './commands.ts';

/** Ports let the frontend choose its Expo SDK, audio module and screen layout. */
export interface VoicePorts {
  stopListening(): Promise<void>;
  stopSpeaking(): Promise<void>;
  // Resolve only when speech finishes; reject on playback failure.
  speak(text: string): Promise<void>;
  onCommand(command: VoiceCommand): Promise<void>;
}

export class VoiceController {
  private last = '';
  private speaking = false;
  private revision = 0;
  constructor(private ports: VoicePorts) {}

  get isSpeaking() { return this.speaking; }

  async say(text: string, options: { remember?: boolean } = {}): Promise<void> {
    if (!text.trim()) return;
    const revision = ++this.revision;
    this.speaking = true;
    try {
      await this.ports.stopListening();
      if (revision !== this.revision) return;
      await this.ports.stopSpeaking();
      if (revision !== this.revision) return;
      if (options.remember !== false) this.last = text;
      await this.ports.speak(text);
    } finally {
      if (revision === this.revision) this.speaking = false;
    }
  }

  /** Call from the accessible microphone button before starting recording. */
  async prepareToListen(): Promise<void> {
    ++this.revision;
    await this.ports.stopSpeaking();
    this.speaking = false;
  }

  async stop(): Promise<void> {
    ++this.revision;
    await this.ports.stopListening();
    await this.ports.stopSpeaking();
    this.speaking = false;
  }

  async acceptTranscript(text: string): Promise<void> {
    if (this.speaking) return; // Ignore speech output echo.
    const command = parseCommand(text);
    if (command.type === 'REPEAT') {
      await this.say(this.last || 'There are no instructions to repeat.');
    } else if (command.type === 'UNKNOWN') {
      await this.say('I did not understand that command. Please enter a destination or try speaking again.');
    } else {
      if (command.type === 'STOP' || command.type === 'PAUSE') await this.stop();
      await this.ports.onCommand(command);
    }
  }
}
