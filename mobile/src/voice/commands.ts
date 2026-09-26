export type VoiceCommand =
  | { type: 'DESTINATION_REQUEST'; destination: string }
  | { type: 'START_NAVIGATION' | 'REPEAT' | 'PAUSE' | 'RESUME' | 'DESCRIBE_SURROUNDINGS' | 'BACK' | 'STOP' | 'CONFIRM' }
  | { type: 'SELECT_ROUTE'; routeNumber: number }
  | { type: 'UNKNOWN'; transcript: string };

export function parseVoiceCommand(transcript: string): VoiceCommand {
  const normalized = transcript.trim().toLowerCase().replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  const destination = normalized.match(/^(?:take me to|navigate to|go to)\s+(.+)$/)?.[1]?.trim();
  if (destination) return { type: 'DESTINATION_REQUEST', destination };
  if (/^(?:start navigation|start)$/.test(normalized)) return { type: 'START_NAVIGATION' };
  if (/^(?:repeat|repeat instruction|say that again)$/.test(normalized)) return { type: 'REPEAT' };
  if (/^(?:pause|pause navigation)$/.test(normalized)) return { type: 'PAUSE' };
  if (/^(?:resume|continue|resume navigation)$/.test(normalized)) return { type: 'RESUME' };
  if (/^(?:describe surroundings|describe my surroundings|camera)$/.test(normalized)) return { type: 'DESCRIBE_SURROUNDINGS' };
  if (/^(?:back|go back|edit destination)$/.test(normalized)) return { type: 'BACK' };
  if (/^(?:stop|stop navigation|cancel)$/.test(normalized)) return { type: 'STOP' };
  if (/^(?:confirm|yes|that's right|correct)$/.test(normalized)) return { type: 'CONFIRM' };
  const selection = normalized.match(/^(?:select |route )?(one|two|1|2)$/)?.[1];
  if (selection) return { type: 'SELECT_ROUTE', routeNumber: selection === 'one' || selection === '1' ? 1 : 2 };
  return { type: 'UNKNOWN', transcript };
}
