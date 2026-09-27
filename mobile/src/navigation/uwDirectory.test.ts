import { describe, expect, it, vi } from 'vitest';

const rows = [
  { uw_map_object_id: '490', building_name: 'Helen C. White Hall', street_address: '600 N. Park St.', latitude: 43.07, longitude: -89.40, facility_name: 'College Library', facility_category: 'departments' },
  { uw_map_object_id: '490', building_name: 'Helen C. White Hall', street_address: '600 N. Park St.', latitude: 43.07, longitude: -89.40, facility_name: 'College Library', facility_category: 'libraries' },
  { uw_map_object_id: '490', building_name: 'Helen C. White Hall', street_address: '600 N. Park St.', latitude: 43.07, longitude: -89.40, facility_name: 'Open Book Café', facility_category: 'dining' },
  { uw_map_object_id: '18', building_name: 'Memorial Library', street_address: '728 State St.', latitude: 43.08, longitude: -89.39, facility_name: null, facility_category: null },
];

vi.mock('../auth/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: vi.fn(async () => ({ data: rows, error: null })) },
}));

import { campusSuggestions, directoryPlace, searchDirectory } from './uwDirectory';

describe('live campus directory', () => {
  it('deduplicates a facility listed in multiple categories so an exact query has one choice', async () => {
    expect((await searchDirectory('College Library')).map(place => place.name)).toEqual(['College Library']);
    expect(await directoryPlace('490', 'College Library')).toMatchObject({ name: 'College Library', buildingName: 'Helen C. White Hall' });
  });

  it('offers real buildings and dining places without fixed suggestions', async () => {
    expect((await campusSuggestions()).map(place => place.name)).toEqual(['Helen C. White Hall', 'Memorial Library']);
    expect((await searchDirectory('Book')).map(place => place.name)).toEqual(['Open Book Café']);
    expect((await searchDirectory('Helen')).map(place => place.name)).toEqual(['Helen C. White Hall']);
  });
});
