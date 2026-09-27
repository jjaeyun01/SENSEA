import type { Point } from './campusApi';

export type DirectionHaptic = 'left' | 'right' | 'straight' | 'uturn';
export type DirectionCue = {
  bearing: number;
  relativeDegrees: number;
  clock: number;
  label: string;
  arrow: string;
  haptic: DirectionHaptic;
};

function normalize(value: number) {
  return ((value % 360) + 360) % 360;
}

export function bearingDegrees(from: Point, to: Point) {
  const lat1 = from.latitude * Math.PI / 180;
  const lat2 = to.latitude * Math.PI / 180;
  const longitude = (to.longitude - from.longitude) * Math.PI / 180;
  const y = Math.sin(longitude) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(longitude);
  return normalize(Math.atan2(y, x) * 180 / Math.PI);
}

export function directionCue(position: Point & { heading?: number | null }, target?: Point | null): DirectionCue | null {
  if (!target || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude) ||
      !Number.isFinite(target.latitude) || !Number.isFinite(target.longitude) ||
      position.heading == null || !Number.isFinite(position.heading) || position.heading < 0) return null;
  const bearing = bearingDegrees(position, target);
  const relative = ((bearing - position.heading + 540) % 360) - 180;
  const absolute = Math.abs(relative);
  const clockValue = Math.round(normalize(relative) / 30) % 12;
  const clock = clockValue === 0 ? 12 : clockValue;
  if (absolute <= 25) return { bearing, relativeDegrees: relative, clock, label: 'straight ahead', arrow: '↑', haptic: 'straight' };
  if (absolute >= 150) return { bearing, relativeDegrees: relative, clock, label: 'behind you', arrow: '↶', haptic: 'uturn' };
  if (relative > 0 && absolute <= 70) return { bearing, relativeDegrees: relative, clock, label: 'ahead and to the right', arrow: '↗', haptic: 'right' };
  if (relative < 0 && absolute <= 70) return { bearing, relativeDegrees: relative, clock, label: 'ahead and to the left', arrow: '↖', haptic: 'left' };
  if (relative > 0) return { bearing, relativeDegrees: relative, clock, label: 'to the right', arrow: '→', haptic: 'right' };
  return { bearing, relativeDegrees: relative, clock, label: 'to the left', arrow: '←', haptic: 'left' };
}

export function spokenDirection(cue: DirectionCue | null) {
  return cue ? `${cue.clock} o'clock, ${cue.label}.` : '';
}
