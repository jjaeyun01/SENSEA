import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useNoise } from '@/src/noise/NoiseProvider';
import { BottomNav } from '@/src/components/BottomNav';
import { BrandMark } from '@/src/components/BrandMark';
import { colors, radii, spacing, typography } from '@/src/theme';
import { useNoiseMonitor } from '@/src/noise/NoiseMonitorProvider';

const CENTER = { latitude: 43.0753, longitude: -89.3992, latitudeDelta: 0.018, longitudeDelta: 0.018 };


export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const contributions = useNoise();
  const [noiseVisible, setNoiseVisible] = useState(true);
  const noise = useNoiseMonitor();
  return <View style={styles.root}>
    <MapView
      style={StyleSheet.absoluteFill}
      provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
      initialRegion={CENTER}
      showsUserLocation
      showsCompass
      accessibilityLabel="Campus map"
      userInterfaceStyle="dark"
    >
      <Marker coordinate={{ latitude: 43.0752, longitude: -89.3971 }} title="Memorial Library" description="Campus destination" pinColor={colors.primary} />
      <Marker coordinate={{ latitude: 43.0766, longitude: -89.4001 }} title="Memorial Union" description="Campus destination" pinColor={colors.primary} />
      {noiseVisible && contributions.cells.map(cell => { const color = cell.average_relative_noise < 0.33 ? '#24C875' : cell.average_relative_noise < 0.66 ? '#FFAA17' : '#FF514B'; return <Circle key={cell.grid_cell_id} center={{ latitude: cell.grid_latitude, longitude: cell.grid_longitude }} radius={25} fillColor={`${color}52`} strokeColor={color} strokeWidth={2} />; })}
    </MapView>

    <View style={[styles.topBar, { top: insets.top + 12 }]}>
      <View style={styles.brandCard}><BrandMark compact /></View>
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: noiseVisible }} accessibilityLabel="Noise level map overlay" onPress={() => setNoiseVisible(value => !value)} style={[styles.noiseButton, noiseVisible && styles.noiseButtonActive]}>
        <Text style={[styles.wave, noiseVisible && styles.waveActive]}>≋</Text>
        <View><Text style={[styles.noiseTitle, noiseVisible && styles.noiseTitleActive]}>Noise map</Text><Text style={styles.noiseStatus}>{noiseVisible ? 'ON' : 'OFF'}</Text></View>
      </Pressable>
    </View>

    {noiseVisible && <View style={[styles.legend, { bottom: insets.bottom + 104 }]}>
      <View style={styles.liveRow}><Text style={styles.legendTitle}>LIVE DEVICE LEVEL</Text><Text style={styles.liveReading}>{!noise.active || noise.dbfs === null ? 'PAUSED' : `${Math.round(noise.dbfs)} dBFS`}</Text></View>
      <View style={styles.meterTrack}><View style={[styles.meterFill, { width: `${noise.active ? Math.round(noise.progress * 100) : 0}%` }, noise.band === 'moderate' && styles.meterModerate, noise.band === 'loud' && styles.meterLoud]} /></View>
      <View style={styles.legendRow}><LegendDot color="#24C875" label="Quiet" /><LegendDot color="#FFAA17" label="Moderate" /><LegendDot color="#FF514B" label="Loud" /></View>
      <Text style={styles.legendNote}>Microphone reading is device-relative, not calibrated dB SPL. Map zones use crowdsourced relative readings; no zones appear until aggregate data is available.</Text>
    </View>}
    <BottomNav active="map" />
  </View>;
}

function LegendDot({ color, label }: { color: string; label: string }) { return <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: color }]} /><Text style={styles.legendText}>{label}</Text></View>; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  topBar: { position: 'absolute', left: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  brandCard: { height: 50, paddingHorizontal: 15, borderRadius: 25, justifyContent: 'center', backgroundColor: '#FFFFFFF2', borderWidth: 1, borderColor: colors.border },
  noiseButton: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 25, backgroundColor: '#FFFFFFF2', borderWidth: 1, borderColor: colors.border },
  noiseButtonActive: { borderColor: colors.primary, backgroundColor: '#DDF6F1F2' }, wave: { color: colors.muted, fontSize: 23, fontWeight: '900' }, waveActive: { color: colors.primary },
  noiseTitle: { color: colors.textSoft, fontFamily: typography.family, fontSize: 12, fontWeight: '800' }, noiseTitleActive: { color: colors.text }, noiseStatus: { color: colors.muted, fontFamily: typography.family, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  legend: { position: 'absolute', left: spacing.md, right: spacing.md, borderRadius: radii.md, padding: 14, backgroundColor: '#FFFFFFF2', borderWidth: 1, borderColor: colors.border, gap: 9 }, liveRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }, legendTitle: { color: colors.muted, fontFamily: typography.family, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 }, liveReading: { color: colors.text, fontFamily: typography.family, fontSize: 22, fontWeight: '900' }, meterTrack: { height: 7, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.surfaceHighlight }, meterFill: { height: '100%', borderRadius: 4, backgroundColor: '#24C875' }, meterModerate: { backgroundColor: '#FFAA17' }, meterLoud: { backgroundColor: '#FF514B' }, legendRow: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' }, legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 }, dot: { width: 9, height: 9, borderRadius: 5 }, legendText: { color: colors.textSoft, fontFamily: typography.family, fontSize: 12, fontWeight: '700' }, legendNote: { color: colors.mutedDark, fontFamily: typography.family, fontSize: 10, lineHeight: 14 },
});
