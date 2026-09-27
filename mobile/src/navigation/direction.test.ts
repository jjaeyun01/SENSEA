import { describe, expect, it } from 'vitest';

import { directionCue, spokenDirection } from './direction';

const origin = { latitude: 43.075, longitude: -89.4 };

describe('relative direction guidance', () => {
  it('describes north as straight ahead when the user faces north', () => {
    const cue = directionCue({ ...origin, heading: 0 }, { latitude: 43.076, longitude: -89.4 });
    expect(cue?.clock).toBe(12);
    expect(cue?.haptic).toBe('straight');
  });

  it('describes an eastern target as three o clock and right', () => {
    const cue = directionCue({ ...origin, heading: 0 }, { latitude: 43.075, longitude: -89.399 });
    expect(cue?.clock).toBe(3);
    expect(cue?.haptic).toBe('right');
    expect(spokenDirection(cue)).toContain("3 o'clock");
  });

  it('does not invent a direction without a usable heading', () => {
    expect(directionCue({ ...origin, heading: null }, { latitude: 43.076, longitude: -89.4 })).toBeNull();
    expect(directionCue({ ...origin, heading: -1 }, { latitude: 43.076, longitude: -89.4 })).toBeNull();
  });
});
