import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
  type AudioStreamBuffer,
} from 'expo-audio';

import { calculateDbfs, classifyDbfs, dbfsToProgress, type NoiseBand } from './noiseLevel';

type PermissionState = 'unknown' | 'requesting' | 'granted' | 'denied';

type NoiseMonitor = {
  enabled: boolean;
  active: boolean;
  permission: PermissionState;
  canAskAgain: boolean;
  dbfs: number | null;
  measuredAtMs: number | null;
  progress: number;
  band: NoiseBand | null;
  error: string | null;
  setEnabled: (enabled: boolean) => Promise<void>;
  requestPermission: () => Promise<boolean>;
  suspend: (reason: string) => void;
  resume: (reason: string) => void;
};

const Context = createContext<NoiseMonitor | null>(null);

export function NoiseMonitorProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(true);
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [suspensionVersion, setSuspensionVersion] = useState(0);
  const [dbfs, setDbfs] = useState<number | null>(null);
  const [measuredAtMs, setMeasuredAtMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const suspended = useRef(new Set<string>());
  const lastUpdateAt = useRef(0);
  const smoothedDbfs = useRef<number | null>(null);

  const onBuffer = useCallback((buffer: AudioStreamBuffer) => {
    const now = Date.now();
    if (now - lastUpdateAt.current < 250 || buffer.data.byteLength < 4) return;
    lastUpdateAt.current = now;
    const current = calculateDbfs(new Float32Array(buffer.data));
    const next = smoothedDbfs.current === null ? current : smoothedDbfs.current * 0.65 + current * 0.35;
    smoothedDbfs.current = next;
    setDbfs(next);
    setMeasuredAtMs(now);
  }, []);

  const { stream, isStreaming } = useAudioStream({
    sampleRate: 16000,
    channels: 1,
    encoding: 'float32',
    onBuffer,
  });

  const requestPermission = useCallback(async () => {
    setPermission('requesting');
    setError(null);
    try {
      const existing = await getRecordingPermissionsAsync();
      const result = existing.granted || !existing.canAskAgain ? existing : await requestRecordingPermissionsAsync();
      setCanAskAgain(result.canAskAgain);
      setPermission(result.granted ? 'granted' : 'denied');
      if (!result.granted) setError('Microphone permission is off. Navigation still works without sound measurement.');
      return result.granted;
    } catch {
      setPermission('denied');
      setError('Microphone permission could not be requested.');
      return false;
    }
  }, []);

  useEffect(() => { void requestPermission(); }, [requestPermission]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  const shouldStream = enabled && permission === 'granted' && appActive && suspended.current.size === 0;
  useEffect(() => {
    let cancelled = false;
    if (!shouldStream) {
      stream.stop();
      return () => { cancelled = true; };
    }
    void setAudioModeAsync({
      allowsRecording: true,
      allowsBackgroundRecording: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    }).then(() => { if (!cancelled) return stream.start(); }).then(() => {
      if (cancelled) return;
      else setError(null);
    }).catch(() => {
      if (!cancelled) setError('Live sound measurement could not start on this device.');
    });
    return () => { cancelled = true; };
  }, [shouldStream, stream.id, suspensionVersion]);

  // useAudioStream owns native disposal; its deinit already stops capture.
  // Calling stop in a later unmount cleanup can target a released shared object.

  const suspend = useCallback((reason: string) => {
    if (!suspended.current.has(reason)) {
      stream.stop();
      suspended.current.add(reason);
      setSuspensionVersion(value => value + 1);
    }
  }, [stream]);
  const resume = useCallback((reason: string) => {
    if (suspended.current.delete(reason)) setSuspensionVersion(value => value + 1);
  }, []);
  const setEnabled = useCallback(async (next: boolean) => {
    setEnabledState(next);
    setError(null);
    if (!next) {
      setDbfs(null);
      setMeasuredAtMs(null);
      smoothedDbfs.current = null;
      return;
    }
    if (permission !== 'granted') await requestPermission();
  }, [permission, requestPermission]);

  const value = useMemo<NoiseMonitor>(() => ({
    enabled,
    active: isStreaming && shouldStream,
    permission,
    canAskAgain,
    dbfs,
    measuredAtMs,
    progress: dbfs === null ? 0 : dbfsToProgress(dbfs),
    band: dbfs === null ? null : classifyDbfs(dbfs),
    error,
    setEnabled,
    requestPermission,
    suspend,
    resume,
  }), [enabled, isStreaming, shouldStream, permission, canAskAgain, dbfs, measuredAtMs, error, setEnabled, requestPermission, suspend, resume]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useNoiseMonitor() {
  const value = useContext(Context);
  if (!value) throw new Error('NoiseMonitorProvider missing');
  return value;
}
