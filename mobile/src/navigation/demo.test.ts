import { describe, expect, it } from 'vitest';
import { demoRoutes, searchDemo } from './demo';
import { GuidanceQueue } from './guidanceQueue';
describe('merged fr1/fr_num2 walkthrough', () => {
  it('supports existing destination aliases without inventing unknown places', () => {
    expect(searchDemo('모그리지 홀')[0]?.name).toBe('Morgridge Hall');
    expect(searchDemo('학생회관')[0]?.id).toBe('demo-student');
    expect(searchDemo('nonexistent building')).toEqual([]);
  });
  it('keeps demo alternatives explicit and uses the selected destination at arrival', () => {
    const destination = searchDemo('Morgridge')[0]!;
    const routes = demoRoutes(destination);
    expect(routes).toHaveLength(3);
    expect(routes.every(route => route.source === 'demo' && !route.encoded_polyline)).toBe(true);
    expect(routes.map(route => route.noiseStatus)).toEqual(['fresh', 'stale', 'unknown']);
    expect(routes.some(route => route.hasStairs)).toBe(true);
    expect(routes.every(route => route.steps.at(-1)?.instruction.includes('Morgridge Hall'))).toBe(true);
  });
  it('prioritizes the demo emergency alert over route cues and keeps equal priority FIFO', () => {
    const queue = new GuidanceQueue();
    queue.enqueue({ id: 'route', priority: 2, text: 'Turn' });
    queue.enqueue({ id: 'urgent', priority: 0, text: 'Simulation alert' });
    queue.enqueue({ id: 'route2', priority: 2, text: 'Continue' });
    expect([queue.next()?.id, queue.next()?.id, queue.next()?.id]).toEqual(['urgent', 'route', 'route2']);
  });
});
