import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/src/theme';

type Props = {
  destination: string;
  compact?: boolean;
  remainingMeters?: number;
};

export function CampusMapPreview({ destination, compact = false, remainingMeters }: Props) {
  const accessibilityLabel = remainingMeters === undefined
    ? `${destination} 목적지가 표시된 캠퍼스 미니맵`
    : `${destination}까지 남은 거리 ${remainingMeters}미터인 모의 경로 미니맵`;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[styles.map, compact && styles.compactMap]}
    >
      <View style={styles.parkOne} />
      <View style={styles.parkTwo} />
      <View style={styles.buildingOne} />
      <View style={styles.buildingTwo} />
      <View style={styles.buildingThree} />
      <View style={[styles.road, styles.horizontalRoad]} />
      <View style={[styles.road, styles.verticalRoad]} />
      <View style={[styles.road, styles.branchRoad]} />
      <View style={styles.minorRoad} />
      <View style={styles.routeLine} />
      <View style={styles.routePulse} />
      <View style={styles.startMarker}>
        <Text style={styles.markerText}>●</Text>
      </View>
      <View style={styles.destinationMarker}>
        <Text style={styles.pin}>●</Text>
      </View>
      <Text numberOfLines={1} style={styles.destinationLabel}>{destination}</Text>
      <View style={styles.mapControl}>
        <Text style={styles.mapControlText}>＋</Text>
        <View style={styles.controlDivider} />
        <Text style={styles.mapControlText}>−</Text>
      </View>
      <View style={styles.mapCaption}>
        <View style={styles.liveDot} />
        <Text style={styles.mapCaptionText}>SENSEA CAMPUS MAP</Text>
      </View>
      {remainingMeters !== undefined && (
        <View style={styles.distanceBadge}>
          <Text style={styles.distanceText}>{remainingMeters < 1609 ? `${remainingMeters}m` : `${(remainingMeters / 1609).toFixed(1)}mi`}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    height: 230,
    overflow: 'hidden',
    borderRadius: 20,
    backgroundColor: '#DDE9DF',
    borderWidth: 1,
    borderColor: '#5D7890',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.28,
    shadowRadius: 22,
    elevation: 7,
  },
  compactMap: { height: 190 },
  road: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderColor: '#B8C3B5',
    borderWidth: 1,
  },
  horizontalRoad: { height: 42, left: -20, right: -20, top: 95, transform: [{ rotate: '-2deg' }] },
  verticalRoad: { width: 46, top: -20, bottom: -20, left: '58%', transform: [{ rotate: '5deg' }] },
  branchRoad: { width: 34, height: 180, top: 85, left: 56, transform: [{ rotate: '48deg' }] },
  minorRoad: { position: 'absolute', width: 22, height: 260, right: 34, top: -24, backgroundColor: '#F8FBF7', transform: [{ rotate: '-28deg' }] },
  parkOne: { position: 'absolute', width: 112, height: 84, left: 10, top: 8, borderRadius: 22, backgroundColor: '#C4DDBF' },
  parkTwo: { position: 'absolute', width: 125, height: 80, right: 12, bottom: 6, borderRadius: 20, backgroundColor: '#BDD8B9' },
  buildingOne: { position: 'absolute', width: 66, height: 48, left: 22, bottom: 26, borderRadius: 6, backgroundColor: '#A9B7BA', borderWidth: 2, borderColor: '#8E9EA2' },
  buildingTwo: { position: 'absolute', width: 74, height: 44, right: 24, top: 20, borderRadius: 6, backgroundColor: '#B5C1C3', borderWidth: 2, borderColor: '#96A5A8' },
  buildingThree: { position: 'absolute', width: 54, height: 38, left: '42%', bottom: 18, borderRadius: 5, backgroundColor: '#B8C4C6' },
  routeLine: {
    position: 'absolute',
    width: 150,
    height: 82,
    left: 54,
    top: 92,
    borderLeftWidth: 6,
    borderBottomWidth: 6,
    borderColor: '#2B7FFF',
    borderBottomLeftRadius: 22,
  },
  routePulse: { position: 'absolute', width: 14, height: 14, borderRadius: 7, left: 47, top: 87, backgroundColor: '#75B5FF', borderWidth: 3, borderColor: '#FFFFFF' },
  startMarker: { position: 'absolute', left: 43, top: 79 },
  markerText: { color: '#2B7FFF', fontSize: 30 },
  destinationMarker: {
    position: 'absolute',
    right: 42,
    top: 56,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#EF4444',
  },
  pin: { color: '#EF4444', fontSize: 17, lineHeight: 20 },
  destinationLabel: {
    position: 'absolute',
    right: 16,
    top: 15,
    maxWidth: '60%',
    color: '#172033',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 16,
    fontWeight: '800',
  },
  mapControl: { position: 'absolute', right: 12, bottom: 12, width: 38, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.94)', alignItems: 'center', overflow: 'hidden' },
  mapControlText: { color: '#172033', fontSize: 22, lineHeight: 31, fontWeight: '700' },
  controlDivider: { width: '100%', height: 1, backgroundColor: '#D1D9DB' },
  mapCaption: { position: 'absolute', left: 13, top: 13, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, backgroundColor: 'rgba(15, 31, 48, 0.88)', paddingHorizontal: 9, paddingVertical: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  mapCaptionText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  distanceBadge: {
    position: 'absolute',
    left: 14,
    bottom: 12,
    borderRadius: 10,
    backgroundColor: '#172033',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  distanceText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
});
