import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { LargeActionButton } from '@/src/components/LargeActionButton';
import { CampusMapPreview } from '@/src/components/CampusMapPreview';
import { AppBackdrop } from '@/src/components/AppBackdrop';
import { colors } from '@/src/theme';
import { speak, stopSpeaking } from '@/src/voice/speak';

function firstParam(value: string | string[] | undefined, fallback: string): string {
  return Array.isArray(value) ? (value[0] ?? fallback) : (value ?? fallback);
}

export default function DestinationScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 820;
  const params = useLocalSearchParams<{ destination?: string | string[] }>();
  const destination = firstParam(params.destination, '선택한 목적지');

  useEffect(() => {
    void speak(`${destination} 목적지 후보를 찾았습니다. 캠퍼스 미니맵 아래의 목적지 선택 버튼을 눌러 확인하세요.`);
    return () => {
      void stopSpeaking();
    };
  }, [destination]);

  return (
    <View style={styles.root}>
      <AppBackdrop />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.progressRow} accessible accessibilityLabel="목적지 확인 단계, 전체 네 단계 중 두 번째 단계">
          <View style={[styles.progressItem, styles.progressDone]}><Text style={styles.progressDoneText}>✓</Text></View>
          <View style={[styles.progressLine, styles.progressLineActive]} />
          <View style={[styles.progressItem, styles.progressActive]}><Text style={styles.progressActiveText}>2</Text></View>
          <View style={styles.progressLine} />
          <View style={styles.progressItem}><Text style={styles.progressText}>3</Text></View>
          <View style={styles.progressLine} />
          <View style={styles.progressItem}><Text style={styles.progressText}>4</Text></View>
        </View>

        <View style={styles.headingBlock}>
          <View style={styles.eyebrowRow}><View style={styles.eyebrowDot} /><Text style={styles.eyebrow}>DESTINATION MATCH</Text></View>
          <Text accessibilityRole="header" style={styles.title}>목적지를 찾았습니다.</Text>
          <Text style={styles.subtitle}>선택하기 전에 건물 이름과 지도 위치를 확인하세요.</Text>
        </View>

        <View style={[styles.contentGrid, isWide && styles.contentGridWide]}>
          <View style={styles.mapPanel}>
            <View style={styles.panelTopRow}>
              <Text style={styles.panelLabel}>CAMPUS POSITION</Text>
              <View style={styles.verifiedPill}><View style={styles.verifiedDot} /><Text style={styles.verifiedText}>VERIFIED DEMO</Text></View>
            </View>
            <CampusMapPreview destination={destination} />
            <View style={styles.mapLegend} accessible={false}>
              <View style={styles.legendItem}><View style={[styles.legendMark, styles.legendStart]} /><Text style={styles.legendText}>현재 위치</Text></View>
              <View style={styles.legendItem}><View style={[styles.legendMark, styles.legendRoute]} /><Text style={styles.legendText}>보행 경로</Text></View>
              <View style={styles.legendItem}><View style={[styles.legendMark, styles.legendEnd]} /><Text style={styles.legendText}>목적지</Text></View>
            </View>
          </View>

          <View style={styles.detailPanel}>
            <View style={styles.resultCard}>
              <View style={styles.numberBadge} accessible={false}><Text style={styles.numberText}>01</Text></View>
              <View style={styles.resultCopy}>
                <Text style={styles.resultMeta}>BEST MATCH</Text>
                <Text style={styles.resultTitle}>{destination}</Text>
                <Text style={styles.resultHint}>캠퍼스 내 사전 검토된 데모 목적지</Text>
              </View>
            </View>

            <View style={styles.infoGrid}>
              <View style={styles.infoCard}><Text style={styles.infoIcon}>⌖</Text><Text style={styles.infoLabel}>구역</Text><Text style={styles.infoValue}>Campus Core</Text></View>
              <View style={styles.infoCard}><Text style={styles.infoIcon}>◎</Text><Text style={styles.infoLabel}>랜드마크</Text><Text style={styles.infoValue}>Main Entrance</Text></View>
              <View style={styles.infoCard}><Text style={styles.infoIcon}>↗</Text><Text style={styles.infoLabel}>경로 선택</Text><Text style={styles.infoValue}>3 options</Text></View>
              <View style={styles.infoCard}><Text style={styles.infoIcon}>◉</Text><Text style={styles.infoLabel}>접근성</Text><Text style={styles.infoValue}>Voice ready</Text></View>
            </View>

            <View style={styles.confirmNote}>
              <Text style={styles.confirmNoteTitle}>음성 확인</Text>
              <Text style={styles.confirmNoteText}>“{destination} 목적지 후보를 찾았습니다.”</Text>
            </View>

            <View style={styles.actions}>
              <LargeActionButton label={`${destination} 선택`} accessibilityHint="시간, 평지, 안전 우선 경로를 비교합니다" onPress={() => router.push({ pathname: '/routes', params: { destination } })} />
              <LargeActionButton label="목적지 다시 검색" onPress={() => router.back()} variant="secondary" />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { width: '100%', maxWidth: 1180, alignSelf: 'center', padding: 24, gap: 24, paddingBottom: 56 },
  progressRow: { flexDirection: 'row', alignItems: 'center', width: '100%', maxWidth: 430, alignSelf: 'center', paddingVertical: 4 },
  progressItem: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundSoft },
  progressActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  progressDone: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  progressText: { color: colors.subtle, fontSize: 12, fontWeight: '800' },
  progressActiveText: { color: '#07111F', fontSize: 13, fontWeight: '900' },
  progressDoneText: { color: colors.primary, fontSize: 14, fontWeight: '900' },
  progressLine: { flex: 1, height: 2, backgroundColor: colors.borderSoft },
  progressLineActive: { backgroundColor: colors.primarySoft },
  headingBlock: { gap: 8, alignItems: 'center' },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  title: { color: colors.text, fontSize: 36, fontWeight: '900', textAlign: 'center' },
  subtitle: { color: colors.muted, fontSize: 17, lineHeight: 25, textAlign: 'center' },
  contentGrid: { gap: 20 },
  contentGridWide: { flexDirection: 'row', alignItems: 'stretch' },
  mapPanel: { flex: 1.25, gap: 16, padding: 20, borderRadius: 26, backgroundColor: colors.surfaceGlass, borderWidth: 1, borderColor: colors.border },
  detailPanel: { flex: 0.9, gap: 16, padding: 20, borderRadius: 26, backgroundColor: 'rgba(12,25,43,0.88)', borderWidth: 1, borderColor: colors.borderSoft },
  panelTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  panelLabel: { color: colors.subtle, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  verifiedPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.primarySoft },
  verifiedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  verifiedText: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  mapLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  legendMark: { width: 10, height: 10, borderRadius: 5 },
  legendStart: { backgroundColor: colors.accent },
  legendRoute: { width: 20, height: 5, borderRadius: 3, backgroundColor: '#2B7FFF' },
  legendEnd: { backgroundColor: '#EF4444' },
  legendText: { color: colors.muted, fontSize: 12 },
  resultCard: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    padding: 18,
    borderRadius: 20,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.primarySoft,
  },
  numberBadge: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  numberText: { color: colors.primaryText, fontSize: 16, fontWeight: '900' },
  resultCopy: { flex: 1, gap: 4 },
  resultTitle: { color: colors.text, fontSize: 24, fontWeight: '900' },
  resultMeta: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  resultHint: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  infoCard: { width: '48%', flexGrow: 1, minWidth: 130, gap: 4, padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft },
  infoIcon: { color: colors.accent, fontSize: 18, fontWeight: '900' },
  infoLabel: { color: colors.subtle, fontSize: 11, fontWeight: '800' },
  infoValue: { color: colors.text, fontSize: 14, fontWeight: '800' },
  confirmNote: { gap: 5, padding: 15, borderRadius: 16, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent },
  confirmNoteTitle: { color: colors.accent, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  confirmNoteText: { color: colors.text, fontSize: 15, lineHeight: 22 },
  actions: { gap: 11 },
});
