import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(async () => [{ id: '490', name: 'Helen C. White Hall', source: 'uw' as const }]),
  detail: vi.fn(async () => ({ id: '490', name: 'Helen C. White Hall', latitude: 43.07, longitude: -89.40, source: 'uw' as const })),
}));
vi.mock('../auth/supabase', () => ({ isSupabaseConfigured: false, supabase: {} }));
vi.mock('./campusApi', () => ({ searchCampusPlaces: mocks.search, getCampusPlace: mocks.detail }));

import { directoryPlace, searchDirectory } from './uwDirectory';

it('uses the live backend building lookup when the Supabase directory is unavailable', async () => {
  const signal = new AbortController().signal;
  expect((await searchDirectory('Helen', signal))[0].id).toBe('490');
  expect(mocks.search).toHaveBeenCalledWith('Helen', signal);
  expect((await directoryPlace('490', 'Helen C. White Hall', signal))?.latitude).toBe(43.07);
  expect(mocks.detail).toHaveBeenCalledWith('490', signal);
  expect(await directoryPlace('490', 'College Library', signal)).toMatchObject({
    name: 'College Library', buildingName: 'Helen C. White Hall',
  });
});
