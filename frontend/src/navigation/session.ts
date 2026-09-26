import type { Place, Route, RouteResponse, SenseaApi } from '../api/client.ts';

/** Simulation state only: advance via a button, never from an unverified GPS fix. */
export class NavigationSession {
  state: 'idle' | 'confirming' | 'choosing' | 'navigating' | 'paused' | 'arrived' = 'idle';
  destination: Place | null = null;
  options: RouteResponse | null = null;
  selected: Route | null = null;
  step = 0;
  private revision = 0;
  constructor(private api: SenseaApi, private startWaypoint = 'start') {}

  setDestination(place: Place) {
    this.reset();
    this.destination = place;
    this.state = 'confirming';
    return `Is ${place.name} your destination?`;
  }

  async confirmDestination() {
    if (this.state !== 'confirming' || !this.destination) throw new Error('Please select a destination first.');
    const revision = ++this.revision;
    const options = await this.api.routes(this.startWaypoint, this.destination.waypoint_id);
    if (revision !== this.revision) return; // Discard results after back/stop/new destination.
    this.options = options;
    this.selected = options.routes.find(r => r.id === options.recommended_route_id) ?? options.routes[0] ?? null;
    this.state = options.arrived ? 'arrived' : 'choosing';
  }

  selectRoute(id: string) {
    if (this.state !== 'choosing') throw new Error('Route selection is not available at this stage.');
    const route = this.options?.routes.find(r => r.id === id);
    if (!route) throw new Error('Please select an available route.');
    this.selected = route;
  }

  start() {
    if (!['choosing', 'paused'].includes(this.state) || !this.selected) throw new Error('Please confirm your destination and select a route first.');
    this.state = this.selected.segments.length ? 'navigating' : 'arrived';
    return this.instruction();
  }

  pause() { if (this.state === 'navigating') this.state = 'paused'; }

  advanceSimulation() {
    if (this.state !== 'navigating' || this.options?.mode !== 'simulation') throw new Error('You can advance only during simulated navigation.');
    this.step++;
    if (this.step >= (this.selected?.segments.length ?? 0)) this.state = 'arrived';
    return this.instruction();
  }

  instruction() {
    if (this.state === 'arrived') return 'You have reached the simulated destination.';
    return this.selected?.segments[this.step]?.instruction ?? 'No route is available for navigation.';
  }

  reset() {
    ++this.revision;
    this.state = 'idle'; this.destination = null; this.options = null; this.selected = null; this.step = 0;
  }
}
