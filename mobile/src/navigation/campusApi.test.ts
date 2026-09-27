import { describe, expect, it } from 'vitest';
import { parseCampusPlaceResponse, parseCampusSearchResponse } from './campusApi';

describe('campus building API contract', () => {
  it('converts backend search results into selectable UW places', () => {
    expect(parseCampusSearchResponse({
      places: [{ id: '432', name: ' Memorial Union ' }],
      source: 'https://map.wisc.edu',
    })).toEqual([{ id: '432', name: 'Memorial Union', source: 'uw' }]);
  });

  it('keeps the address and coordinates returned by building details', () => {
    expect(parseCampusPlaceResponse({
      id: '432',
      name: 'Memorial Union',
      address: ' 800 Langdon St. ',
      latitude: 43.076,
      longitude: -89.399,
      coordinate_kind: 'building_representative_point',
    })).toEqual({
      id: '432',
      name: 'Memorial Union',
      address: '800 Langdon St.',
      latitude: 43.076,
      longitude: -89.399,
      source: 'uw',
    });
  });

  it.each([
    { id: 'not-a-building', name: 'Union', latitude: 43, longitude: -89 },
    { id: '1', name: '', latitude: 43, longitude: -89 },
    { id: '1', name: 'Union', latitude: 143, longitude: -89 },
  ])('rejects malformed building details: %j', value => {
    expect(() => parseCampusPlaceResponse(value)).toThrow(/invalid/i);
  });
});
