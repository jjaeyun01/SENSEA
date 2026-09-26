export type VoiceCommand =
  | { type: 'SET_DESTINATION'; query: string }
  | { type: 'CONFIRM_DESTINATION' }
  | { type: 'SELECT_ROUTE'; preference: 'shortest' | 'quiet' }
  | { type: 'START_NAVIGATION' | 'REPEAT' | 'PAUSE' | 'STOP' | 'BACK' | 'DESCRIBE_SURROUNDINGS' | 'UNKNOWN' };

/** Deliberately conservative: unrecognized speech must never start navigation. */
export function parseCommand(transcript: string): VoiceCommand {
  const text = transcript.trim().toLowerCase().replace(/[.!?,。！？]+$/u, '').trim();
  const commands: Array<[RegExp, VoiceCommand]> = [
    [/^(yes|confirm)$/u, { type: 'CONFIRM_DESTINATION' }],
    [/^(start navigation|start)$/u, { type: 'START_NAVIGATION' }],
    [/^repeat$/u, { type: 'REPEAT' }],
    [/^pause$/u, { type: 'PAUSE' }],
    [/^stop$/u, { type: 'STOP' }],
    [/^(back|no)$/u, { type: 'BACK' }],
    [/^describe surroundings$/u, { type: 'DESCRIBE_SURROUNDINGS' }],
    [/^shortest route$/u, { type: 'SELECT_ROUTE', preference: 'shortest' }],
    [/^quiet route$/u, { type: 'SELECT_ROUTE', preference: 'quiet' }],
  ];
  for (const [pattern, command] of commands) if (pattern.test(text)) return command;
  const destination = text.match(/^take me to\s+(?:the\s+)?(.+)$/u);
  if (destination?.[1].trim()) return { type: 'SET_DESTINATION', query: destination[1].trim() };
  return { type: 'UNKNOWN' };
}
