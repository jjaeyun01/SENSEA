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
      entrance: null,
      entranceVerified: false,
      source: 'uw',
    });
  });

  it('accepts only an entrance with complete survey metadata', () => {
    expect(parseCampusPlaceResponse({
      id: '432', name: 'Memorial Union', address: null,
      latitude: 43.076, longitude: -89.399,
      entrance_verified: true,
      entrance: {
        latitude: 43.0759,
        longitude: -89.3991,
        accuracy_m: 3,
        surveyed_at: '2026-09-27T12:00:00-05:00',
        description: ' Field-surveyed east public entrance ',
      },
    }).entrance).toEqual({
      latitude: 43.0759,
      longitude: -89.3991,
      accuracyM: 3,
      surveyedAt: '2026-09-27T12:00:00-05:00',
      description: 'Field-surveyed east public entrance',
    });
  });

  it('rejects entrance coordinates without survey metadata', () => {
    expect(() => parseCampusPlaceResponse({
      id: '432', name: 'Memorial Union', address: null,
      latitude: 43.076, longitude: -89.399,
      entrance_verified: true,
      entrance: { latitude: 43.0759, longitude: -89.3991 },
    })).toThrow(/unverified entrance metadata/i);
  });

  it.each([
    { id: 'not-a-building', name: 'Union', latitude: 43, longitude: -89 },
    { id: '1', name: '', latitude: 43, longitude: -89 },
    { id: '1', name: 'Union', latitude: 143, longitude: -89 },
  ])('rejects malformed building details: %j', value => {
    expect(() => parseCampusPlaceResponse(value)).toThrow(/invalid/i);
  });
});
