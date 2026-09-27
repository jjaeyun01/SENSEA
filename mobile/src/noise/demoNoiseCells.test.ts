import { describe, expect, it } from 'vitest';

import { createDemoNoiseCells } from './demoNoiseCells';

describe('demo noise map cells', () => {
  it('creates clearly marked, privacy-threshold-compatible demo cells', () => {
    const now = new Date('2026-09-27T15:34:12.000Z');
    const cells = createDemoNoiseCells(now);

    expect(cells).toHaveLength(12);
    expect(cells.every(cell => cell.is_demo)).toBe(true);
    expect(cells.every(cell => cell.contributing_users >= 3)).toBe(true);
    expect(cells.every(cell => cell.average_relative_noise >= 0 && cell.average_relative_noise <= 1)).toBe(true);
    expect(cells.every(cell => cell.hour_bucket === '2026-09-27T15:00:00.000Z')).toBe(true);
    expect(new Set(cells.map(cell => cell.grid_cell_id)).size).toBe(cells.length);
  });
});
