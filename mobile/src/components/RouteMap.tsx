import { useMemo } from 'react';
import { Platform, Text } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { decodePolyline } from '../navigation/guidance.mjs';
import type { Route, Point } from '../navigation/campusApi';
import { colors, radii } from '../theme';
export function RouteMap({ route, position }: { route: Route; position: Point | null }) {
  const key = Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY : process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY;
  const points = useMemo(() => { try { return decodePolyline(route.encoded_polyline); } catch { return []; } }, [route]);
  if (route.source === 'demo') return null;
  if (!key || !points.length) return <Text style={{ color: colors.muted }}>Map display needs a platform Maps SDK key. Google Maps route instructions remain in SENSEA.</Text>;
  return <MapView style={{ height: 210, borderRadius: radii.lg }} provider={PROVIDER_GOOGLE}
    initialRegion={{ ...points[0], latitudeDelta: 0.01, longitudeDelta: 0.01 }} accessibilityLabel="Google Maps walking route">
    <Polyline coordinates={points} strokeWidth={5} strokeColor={colors.primary} />
    {position && <Marker coordinate={position} title="Current position" />}
    <Marker coordinate={points[points.length - 1]} title="Destination" />
  </MapView>;
}
