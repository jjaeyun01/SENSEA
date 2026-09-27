import { useMemo } from 'react';
import { Platform, Text } from 'react-native';
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { decodePolyline } from '../navigation/guidance.mjs';
import type { Route, Point } from '../navigation/campusApi';
import { colors, radii } from '../theme';
import type { NoiseCell, NoiseReading } from '../noise/NoiseProvider';

function heatColor(value: number, alpha: number) {
  if (value < 0.35) return `rgba(8,216,189,${alpha})`;
  if (value < 0.65) return `rgba(255,170,23,${alpha})`;
  return `rgba(255,81,75,${alpha})`;
}

export function RouteMap({ route, position, noiseCells = [], latestNoise = null }: { route: Route; position: Point | null; noiseCells?: NoiseCell[]; latestNoise?: NoiseReading | null }) {
  const key = Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY : process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY;
  const points = useMemo(() => { try { return decodePolyline(route.encoded_polyline); } catch { return []; } }, [route]);
  if (route.source === 'demo') return null;
  if (!key || !points.length) return <Text style={{ color: colors.muted }}>Map display needs a platform Maps SDK key. Google Maps route instructions remain in SENSEA.</Text>;
  return <MapView style={{ height: 210, borderRadius: radii.lg }} provider={PROVIDER_GOOGLE}
    initialRegion={{ ...points[0], latitudeDelta: 0.01, longitudeDelta: 0.01 }} accessibilityLabel="Google Maps walking route">
    <Polyline coordinates={points} strokeWidth={5} strokeColor={colors.primary} />
    {noiseCells.map(cell => <Circle key={cell.grid_cell_id} center={{ latitude: cell.grid_latitude, longitude: cell.grid_longitude }} radius={28} fillColor={heatColor(cell.average_relative_noise, 0.3)} strokeColor={heatColor(cell.average_relative_noise, 0.85)} strokeWidth={2} />)}
    {latestNoise && <Circle center={{ latitude: latestNoise.latitude, longitude: latestNoise.longitude }} radius={22} fillColor={heatColor(latestNoise.relativeNoise, 0.42)} strokeColor={colors.white} strokeWidth={2} />}
    {position && <Marker coordinate={position} title="Current position" />}
    <Marker coordinate={points[points.length - 1]} title="Destination" />
  </MapView>;
}
