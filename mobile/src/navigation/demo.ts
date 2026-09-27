import type { Place, Route } from './campusApi';

export const demoPlaces: Place[] = [
  { id: 'demo-library', name: 'Memorial Library', address: 'Simulation only — no verified entrance', source: 'demo' },
  { id: 'demo-student', name: 'Campus Student Center', address: 'Fictional demo destination', source: 'demo' },
  { id: 'demo-science', name: 'Science Hall', address: 'Simulation only — no verified entrance', source: 'demo' },
  { id: 'demo-morgridge', name: 'Morgridge Hall', address: 'Simulation only — no verified entrance', source: 'demo' },
];
export function searchDemo(query: string) {
  const aliases: Record<string, string> = { '도서관': 'library', '중앙도서관': 'library', '학생회관': 'student', '학생 회관': 'student', '공학관': 'science', '모그리지 홀': 'morgridge' };
  const needle = aliases[query.trim()] ?? query.toLowerCase().trim();
  return demoPlaces.filter(place => place.name.toLowerCase().includes(needle));
}
export function demoRoutes(place: Place): Route[] {
  const definitions = [
    { id: 'flat-safe', label: 'Flat-route simulation', minutes: 5, meters: 360, stairs: false, noise: 'fresh' as const,
      instructions: ['Simulation: continue ahead for 80 meters.', 'Simulation: in ten meters, take the right branch.', 'Simulation: approach a crossing. This is not permission to cross.', `Simulation: near ${place.name}.`] },
    { id: 'fast', label: 'Shortest-route simulation', minutes: 3, meters: 240, stairs: true, noise: 'stale' as const,
      instructions: ['Simulation: continue ahead for 50 meters.', 'Simulation: stairs begin ahead.', 'Simulation: turn left after the stairs.', `Simulation: near ${place.name}.`] },
    { id: 'safe', label: 'Reviewed-route simulation', minutes: 6, meters: 410, stairs: false, noise: 'unknown' as const,
      instructions: ['Simulation: follow the pedestrian path.', 'Simulation: approach the crossing and check your surroundings.', 'Simulation: continue to the next landmark.', `Simulation: near ${place.name}.`] },
  ];
  return definitions.map(item => ({ id: item.id, label: item.label, distance_m: item.meters, duration_seconds: item.minutes * 60,
    source: 'demo', encoded_polyline: '', hasStairs: item.stairs, noiseStatus: item.noise,
    warnings: ['Fictional walkthrough. Stairs and noise values are fixtures, not field observations.'],
    steps: item.instructions.map((instruction, index) => ({ instruction, distance_m: index === 3 ? 0 : item.meters / 3,
      start: { latitude: 0, longitude: 0 }, end: { latitude: 0, longitude: 0 } })),
  }));
}
