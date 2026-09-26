import { describe, expect, it } from 'vitest';
import { parseVoiceCommand } from './commands';

describe('parseVoiceCommand', () => {
  it.each([
    ['Take me to Memorial Library', { type: 'DESTINATION_REQUEST', destination: 'memorial library' }],
    ['take me to library', { type: 'DESTINATION_REQUEST', destination: 'library' }],
    ['Start navigation', { type: 'START_NAVIGATION' }],
    ['Repeat', { type: 'REPEAT' }],
    ['Pause', { type: 'PAUSE' }],
    ['Describe surroundings', { type: 'DESCRIBE_SURROUNDINGS' }],
    ['Back', { type: 'BACK' }],
    ['Stop', { type: 'STOP' }],
  ])('%s', (input, expected) => expect(parseVoiceCommand(input)).toEqual(expected));
});
