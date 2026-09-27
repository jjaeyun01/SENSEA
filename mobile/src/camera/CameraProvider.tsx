import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, Vibration, StyleSheet, Text, View } from 'react-native';
import { NativePreviewView, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { callback } from 'react-native-nitro-modules';
import { HazardTracker, HazardAnnouncementGate } from '../vision/hazards.mjs';
import { projectBoxToPreview } from '../vision/preview-geometry.mjs';
import { createNativeSession } from '../vision/createNativeSession';
import { AnnouncementGate, describeResult, isFreshResult, displayLabel } from '../vision/detection.mjs';
import type { HazardAssessment, LiveResult, NativeSession } from '../vision/types';
import { announce, stopFeedback } from '../navigation/feedback';
import { recordEvent } from '../navigation/audit';
import { CollisionHaptics, hasPriorityObstacle } from '../vision/collision-haptics.mjs';
import { UrbanVisionPanel } from '../vision/UrbanVisionPanel';
import { isFeedbackActive } from '../navigation/feedback';
import { colors } from '../theme';
import { isFreshVisualAlignment, subscribeVisualAlignment, type VpsAlignment } from '../navigation/visualAlignment.mjs';

function useCameraController() {
  const permission = useCameraPermission();
  const device = useCameraDevice('back');
  const [session, setSession] = useState<NativeSession | null>(null);
  const [result, setResult] = useState<LiveResult | null>(null);
  const [phase, setPhase] = useState<'closed' | 'opening' | 'live' | 'closing'>('closed');
  const [message, setMessage] = useState('Camera is off. Images are processed on this device.');
  const [visualAlignment, setVisualAlignment] = useState<VpsAlignment | null>(null);
  const owned = useRef<NativeSession | null>(null);
  const latest = useRef<LiveResult | null>(null);
  const wanted = useRef(false), opening = useRef(false), mounted = useRef(true);
  const closing = useRef<Promise<void> | null>(null);
  const [hazard, setHazard] = useState<HazardAssessment | null>(null);
  const latestAssessment = useRef<HazardAssessment | null>(null);
  const [automaticAnnouncements, setAutomaticAnnouncementsState] = useState(false);
  const automaticSpeech = useRef(false);
  const tracker = useRef(new HazardTracker());
  const hazardGate = useRef(new HazardAnnouncementGate({ includePeople: true }));
  const gate = useRef(new AnnouncementGate());
  const setAutomaticAnnouncements = useCallback((enabled: boolean) => {
    automaticSpeech.current = enabled;
    setAutomaticAnnouncementsState(enabled);
    hazardGate.current.reset();
    gate.current.reset();
  }, []);
  const close = useCallback(() => {
    wanted.current = false; latest.current = null; latestAssessment.current = null; owned.current?.pause(); gate.current.reset(); tracker.current.reset(); hazardGate.current.reset(); stopFeedback();
    if (mounted.current) { setResult(null); setHazard(null); setPhase('closing'); }
    if (opening.current || closing.current) return;
    const active = owned.current; owned.current = null;
    closing.current = (async () => {
      try { await active?.dispose(); }
      catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown cleanup error';
        console.warn('[SENSEA] Camera cleanup failed', reason);
        if (mounted.current) setMessage('Camera cleanup failed. Try opening the camera again.');
      }
      finally { closing.current = null; if (mounted.current) { setSession(null); setPhase('closed'); } }
    })();
    recordEvent('camera', 'closed');
  }, []);
  const fail = useCallback((text: string) => {
    if (!mounted.current || !wanted.current) return;
    setMessage(text); close();
  }, [close]);
  const receive = useCallback((next: LiveResult) => {
    if (!mounted.current || !wanted.current || !isFreshResult(next, Date.now())) return;
    latest.current = next; setResult(next);
    const assessment = tracker.current.update(next, Date.now());
    latestAssessment.current = assessment; setHazard(assessment);
    if (!automaticSpeech.current) return;
    const warning = hazardGate.current.reserve(assessment, Date.now());
    if (warning) {
      announce(warning.text, warning.level === 'priority' ? 0 : 1, 'en-US', undefined, true, () =>
        automaticSpeech.current && wanted.current && !!latest.current && isFreshResult(latest.current, Date.now()) &&
        Date.now() - assessment.observedAt <= 1000 &&
        !!latestAssessment.current?.hazards.some(item => item.trackId === warning.trackId &&
          item.direction === warning.direction && item.level === warning.level), warning);
    }
    else if (next.quality.status !== 'usable') {
      const text = gate.current.offer(next, Date.now());
      if (text) announce(text, 3, 'en-US');
    }
  }, []);
  const open = useCallback(async () => {
    if (closing.current) await closing.current;
    if (opening.current || owned.current || !mounted.current || AppState.currentState !== 'active') return;
    if (!device) { setMessage('No rear camera is available on this device.'); return; }
    opening.current = true; wanted.current = true; setPhase('opening'); setMessage('Preparing camera and on-device model.');
    recordEvent('camera', 'open_requested');
    try {
      const granted = permission.hasPermission || (permission.canRequestPermission && await permission.requestPermission());
      if (!granted) { wanted.current = false; setMessage('Camera permission was denied. Enable it in system settings to retry.'); return; }
      if (!wanted.current || !mounted.current) return;
      const created = await createNativeSession(receive, fail, text => { if (mounted.current && wanted.current) { latest.current = null; latestAssessment.current = null; setResult(null); setHazard(null); tracker.current.reset(); hazardGate.current.reset(); setMessage(text); announce(text, 1, 'en-US'); } });
      if (!wanted.current || !mounted.current) { await created.dispose(); return; }
      owned.current = created; setSession(created);
    } catch (error) {
      wanted.current = false;
      const reason = error instanceof Error ? error.message : 'Unknown native camera error';
      console.warn('[SENSEA] Camera startup failed', reason);
      if (mounted.current) setMessage(`Camera could not start: ${reason}`);
    }
    finally { opening.current = false; if (!wanted.current) { const pending = owned.current; owned.current = null; await pending?.dispose().catch(() => {}); if (mounted.current) { setSession(null); setPhase('closed'); } } }
  }, [device, permission, receive, fail]);
  const previewDidStart = useCallback(() => {
    if (!mounted.current || !wanted.current || !owned.current) return;
    setPhase('live'); setMessage('Camera preview is live. Preparing analysis.');
    void owned.current.startAnalysis().catch(() => { if (mounted.current) setMessage('Analysis unavailable. Camera preview remains available.'); });
  }, []);
  const previewStarted = useMemo(() => callback(previewDidStart), [previewDidStart]);
  useEffect(() => {
    if (phase !== 'opening' || !session) return;
    const timer = setTimeout(() => fail('Camera startup timed out. Please retry.'), 15000);
    return () => clearTimeout(timer);
  }, [phase, session, fail]);
  useEffect(() => {
    if (session && wanted.current) void session.start().catch(() => fail('Camera could not start. Please retry.'));
  }, [session, fail]);
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener('change', value => { if (value === 'background') close(); });
    const timer = setInterval(() => {
      if (latest.current && !isFreshResult(latest.current, Date.now())) {
        latest.current = null; latestAssessment.current = null; setResult(null); setHazard(null); tracker.current.reset(); hazardGate.current.reset(); setMessage('Waiting for a fresh camera frame.');
      }
    }, 250);
    return () => { mounted.current = false; listener.remove(); clearInterval(timer); close(); };
  }, [close]);
  useEffect(() => subscribeVisualAlignment(value => {
    if (mounted.current) setVisualAlignment(value);
  }), []);
  useEffect(() => {
    if (!visualAlignment) return;
    const timer = setInterval(() => {
      if (!isFreshVisualAlignment(visualAlignment)) setVisualAlignment(null);
    }, 250);
    return () => clearInterval(timer);
  }, [visualAlignment]);
  const repeat = () => {
    const current = latest.current;
    if (current && isFreshResult(current, Date.now())) announce(hazard?.hazards.length ? hazard.summary : describeResult(current), 1, 'en-US');
    else announce('No fresh camera observation is available.', 1);
  };
  return { automaticAnnouncements, setAutomaticAnnouncements, device, session, result, hazard, previewStarted, phase, message: hazard?.hazards.length ? hazard.summary : result ? describeResult(result) : message, open, close, repeat,
    ready: phase === 'live' && result?.quality.status === 'usable',
    // Object detection is not VPS. Only a registered provider tied to a
    // surveyed spatial map may populate this value.
    visualAlignment,
    alignmentStatus: visualAlignment ? 'verified' as const : 'unavailable' as const };
}
type CameraState = ReturnType<typeof useCameraController>;
const Context = createContext<CameraState | null>(null);
export function CameraProvider({ children }: { children: ReactNode }) {
  const value = useCameraController();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useCamera() { const value = useContext(Context); if (!value) throw new Error('CameraProvider is missing'); return value; }
export function UrbanCameraGuidance() {
  const camera = useCamera();
  const live = useRef(false); live.current = camera.phase === 'live' && camera.automaticAnnouncements;
  const haptics = useRef(new CollisionHaptics({ vibrate: Vibration.vibrate, cancel: Vibration.cancel, isAllowed: () => live.current }));
  useEffect(() => {
    const timer = setInterval(() => haptics.current.tick(), 200);
    return () => { clearInterval(timer); haptics.current.reset(); };
  }, []);
  useEffect(() => {
    if (camera.hazard) haptics.current.offer('base', camera.hazard.observedAt, hasPriorityObstacle(camera.hazard.hazards));
    else haptics.current.clear('base');
  }, [camera.hazard]);
  if (Platform.OS !== 'android') return null;
  return <UrbanVisionPanel live={camera.phase === 'live'} enabled={camera.ready} voice={camera.automaticAnnouncements}
    baseResult={camera.result} onResult={value => { if (value) haptics.current.offer('urban', value.receivedAt, hasPriorityObstacle(value.detections)); else haptics.current.clear('urban'); }}
    say={(text, at, manual, priority, onDropped) => {
      announce(text, priority ? 0 : 2, 'en-US', undefined, true,
        () => live.current && Date.now() - at <= 1000, { onDropped });
      return true;
    }} canAnnounce={() => !isFeedbackActive()} cancel={stopFeedback} />;
}
export function CameraPreview() {
  const camera = useCamera();
  const [size, setSize] = useState({ width: 0, height: 0 });
  return camera.session && camera.device ? <View onLayout={event => setSize(event.nativeEvent.layout)} style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <NativePreviewView style={StyleSheet.absoluteFill} onPreviewStarted={camera.previewStarted} previewOutput={camera.session.preview} implementationMode="compatible" resizeMode="cover" />
    {camera.result?.imageSize && camera.result.detections.slice(0, 6).map((item, index) => {
      const box = projectBoxToPreview(item.box, camera.result!.imageSize!, size);
      return box ? <View key={`detection-${index}`} pointerEvents="none" style={{ position: 'absolute', left: box.left, top: box.top, width: box.width, height: box.height, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.white }}>
        <Text style={{ alignSelf: 'flex-start', backgroundColor: '#101820DD', color: colors.white, fontSize: 12, paddingHorizontal: 4 }}>{displayLabel(item.label)}</Text>
      </View> : null;
    })}
    <View pointerEvents="none" style={{ position: 'absolute', top: 8, left: 8, right: 8 }}><Text style={{ alignSelf: 'flex-start', backgroundColor: '#101820DD', color: colors.white, fontSize: 12, padding: 6 }}>{camera.result ? `분석 중 · 사물 ${camera.result.detections.length}개 · 주의 요소 ${camera.hazard?.hazards.length ?? 0}개` : camera.message}</Text></View>
    {camera.result?.imageSize && camera.hazard?.hazards.map(item => {
      const box = projectBoxToPreview(item.box, camera.result!.imageSize!, size);
      const warningColor = item.level === 'priority' ? '#D72638' : item.level === 'caution' ? '#E65100' : colors.primary;
      const label = item.level === 'priority' ? '우선 주의' : item.level === 'caution' ? '주의' : '참고';
      return box ? <View key={item.trackId} pointerEvents="none" style={{ position: 'absolute', left: box.left, top: box.top, width: box.width, height: box.height, borderWidth: 3, borderColor: warningColor }}>
        <Text style={{ alignSelf: 'flex-start', backgroundColor: warningColor, color: colors.white, fontSize: 14, fontWeight: '800', paddingHorizontal: 5 }}>{label} · {displayLabel(item.label)}</Text>
      </View> : null;
    })}
  </View> : <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}><Text style={{ color: colors.muted, textAlign: 'center' }}>{Platform.OS === 'web' ? 'Camera analysis is available in the native app.' : camera.message}</Text></View>;
}
