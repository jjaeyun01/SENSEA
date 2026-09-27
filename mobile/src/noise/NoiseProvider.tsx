import { useNoiseMonitor } from './NoiseMonitorProvider';
import Constants from 'expo-constants';
import { File } from 'expo-file-system';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { isFeedbackActive } from '@/src/navigation/feedback';
import { supabase } from '@/src/auth/supabase';
import { gridForLocation, noiseLabel, summarizeDbfs } from './noiseMath.mjs';

const CONSENT_VERSION = 'noise-map-v1';
const SAMPLE_DURATION_MS = 5000;
const SAMPLE_INTERVAL_MS = 30000;

export type NoiseReading = {
  relativeNoise: number;
  averageDbfs: number;
  label: string;
  measuredAt: string;
  latitude: number;
  longitude: number;
  privatePreview: boolean;
};

export type NoiseCell = {
  grid_cell_id: string;
  grid_latitude: number;
  grid_longitude: number;
  average_relative_noise: number;
  measurement_count: number;
  contributing_users: number;
  hour_bucket: string;
};

type Position = { latitude: number; longitude: number; accuracy?: number | null };
type NoiseContextValue = {
  consentEnabled: boolean;
  collecting: boolean;
  latest: NoiseReading | null;
  cells: NoiseCell[];
  status: string;
  uploadedCount: number;
  setConsent: (enabled: boolean) => Promise<void>;
  offerLocation: (position: Position) => void;
  suspendForSpeech: () => void;
  deleteMyMeasurements: () => Promise<void>;
  refreshMap: () => Promise<void>;
};

const Context = createContext<NoiseContextValue | null>(null);

function delay(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

export function NoiseProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { suspend: suspendMonitor, resume: resumeMonitor } = useNoiseMonitor();
  const samples = useRef<number[]>([]);
  const lastAttemptAt = useRef(0);
  const busy = useRef(false);
  const contaminated = useRef(false);
  const suspendedUntil = useRef(0);
  const recorder = useAudioRecorder({ ...RecordingPresets.LOW_QUALITY, numberOfChannels: 1, isMeteringEnabled: true, directory: 'cache' });
  const recorderState = useAudioRecorderState(recorder, 250);
  const [consentEnabled, setConsentEnabled] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [latest, setLatest] = useState<NoiseReading | null>(null);
  const [cells, setCells] = useState<NoiseCell[]>([]);
  const [status, setStatus] = useState('Noise contribution is off.');
  const [uploadedCount, setUploadedCount] = useState(0);

  useEffect(() => {
    if (collecting && Number.isFinite(recorderState.metering)) samples.current.push(recorderState.metering as number);
  }, [collecting, recorderState.metering]);

  const refreshMap = useCallback(async () => {
    if (!auth.user) { setCells([]); return; }
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.from('noise_grid_hourly')
      .select('grid_cell_id,grid_latitude,grid_longitude,average_relative_noise,measurement_count,contributing_users,hour_bucket')
      .gte('hour_bucket', since).order('hour_bucket', { ascending: false }).limit(300);
    if (error) throw error;
    const newest = new Map<string, NoiseCell>();
    for (const row of (data ?? []) as NoiseCell[]) if (!newest.has(row.grid_cell_id)) newest.set(row.grid_cell_id, row);
    setCells([...newest.values()]);
  }, [auth.user]);

  useEffect(() => {
    if (!auth.user) { setConsentEnabled(false); setCells([]); setLatest(null); return; }
    void (async () => {
      try {
        const { data, error } = await supabase.from('noise_collection_consents').select('revoked_at').eq('user_id', auth.user!.id).maybeSingle();
        if (error) throw error;
        const enabled = Boolean(data && !data.revoked_at);
        setConsentEnabled(enabled);
        setStatus(enabled ? 'Ready to measure during active navigation.' : 'Noise contribution is off.');
      } catch { setStatus('Could not load noise contribution preference.'); }
    })();
    void refreshMap().catch(() => {});
  }, [auth.user, refreshMap]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active' && busy.current) {
        contaminated.current = true;
        setStatus('Measurement stopped because SENSEA left the foreground.');
      }
    });
    return () => subscription.remove();
  }, []);

  const setConsent = useCallback(async (enabled: boolean) => {
    if (!auth.user) throw new Error('Sign in before contributing noise measurements.');
    if (Platform.OS === 'web') throw new Error('Noise contribution is available in the iOS and Android app.');
    if (enabled) {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone permission was not granted. Noise contribution remains off.');
      const { error } = await supabase.from('noise_collection_consents').upsert({
        user_id: auth.user.id, consent_version: CONSENT_VERSION, foreground_only: true,
        granted_at: new Date().toISOString(), revoked_at: null,
      }, { onConflict: 'user_id' });
      if (error) throw error;
      setConsentEnabled(true);
      setStatus('Ready to measure during active navigation.');
    } else {
      contaminated.current = true;
      const { error } = await supabase.from('noise_collection_consents').update({ revoked_at: new Date().toISOString() }).eq('user_id', auth.user.id);
      if (error) throw error;
      setConsentEnabled(false);
      setStatus('Noise contribution is off.');
    }
  }, [auth.user]);

  const capture = useCallback(async (position: Position) => {
    if (!auth.user || busy.current || !consentEnabled || AppState.currentState !== 'active') return;
    if (position.accuracy == null || position.accuracy > 30 || isFeedbackActive() || Date.now() < suspendedUntil.current) return;
    suspendMonitor('noise-contribution');
    busy.current = true; contaminated.current = false; samples.current = []; setCollecting(true);
    setStatus('Measuring environmental sound. No audio will be uploaded.');
    let temporaryUri: string | null = null;
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
      await recorder.prepareToRecordAsync();
      recorder.record();
      await delay(SAMPLE_DURATION_MS);
      await recorder.stop();
      temporaryUri = recorder.uri;
      if (contaminated.current || isFeedbackActive() || AppState.currentState !== 'active') {
        setStatus('Measurement discarded because speech played or the app left the foreground.');
        return;
      }
      const summary = summarizeDbfs(samples.current);
      const grid = gridForLocation(position.latitude, position.longitude);
      const measuredAt = new Date().toISOString();
      const reading: NoiseReading = {
        relativeNoise: summary.relativeNoise, averageDbfs: summary.averageDbfs,
        label: noiseLabel(summary.relativeNoise), measuredAt,
        latitude: grid.latitude, longitude: grid.longitude, privatePreview: true,
      };
      setLatest(reading);
      const { error } = await supabase.from('noise_measurements').insert({
        user_id: auth.user.id,
        grid_cell_id: grid.id,
        grid_latitude: grid.latitude,
        grid_longitude: grid.longitude,
        average_dbfs: summary.averageDbfs,
        peak_dbfs: summary.peakDbfs,
        relative_noise: summary.relativeNoise,
        sample_duration_ms: SAMPLE_DURATION_MS,
        sample_count: summary.sampleCount,
        location_accuracy_m: position.accuracy,
        platform: Platform.OS,
        app_version: Constants.expoConfig?.version ?? 'development',
        calibration_version: 'relative-v1',
        consent_version: CONSENT_VERSION,
        measured_at: measuredAt,
      });
      if (error) throw error;
      setUploadedCount(value => value + 1);
      setStatus(`${reading.label} relative sound reading contributed.`);
      void refreshMap().catch(() => {});
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Noise measurement failed.');
    } finally {
      temporaryUri = temporaryUri || recorder.uri;
      if (temporaryUri) { try { new File(temporaryUri).delete(); } catch {} }
      try { await setAudioModeAsync({ allowsRecording: false }); } catch {}
      samples.current = []; busy.current = false; setCollecting(false);
      resumeMonitor('noise-contribution');
    }
  }, [auth.user, consentEnabled, recorder, refreshMap, suspendMonitor, resumeMonitor]);

  const offerLocation = useCallback((position: Position) => {
    if (!consentEnabled || Date.now() - lastAttemptAt.current < SAMPLE_INTERVAL_MS) return;
    lastAttemptAt.current = Date.now();
    void capture(position);
  }, [capture, consentEnabled]);

  const suspendForSpeech = useCallback(() => {
    suspendedUntil.current = Date.now() + 7000;
    if (busy.current) {
      contaminated.current = true;
      try { recorder.pause(); } catch {}
      void recorder.stop().catch(() => {}).finally(() => { void setAudioModeAsync({ allowsRecording: false }).catch(() => {}); });
    }
  }, [recorder]);

  const deleteMyMeasurements = useCallback(async () => {
    if (!auth.user) throw new Error('Sign in first.');
    contaminated.current = true;
    const { error } = await supabase.from('noise_measurements').delete().eq('user_id', auth.user.id);
    if (error) throw error;
    setLatest(null); setUploadedCount(0); setStatus('Your contributed noise measurements were deleted.');
    await refreshMap();
  }, [auth.user, refreshMap]);

  const value = useMemo<NoiseContextValue>(() => ({ consentEnabled, collecting, latest, cells, status, uploadedCount, setConsent, offerLocation, suspendForSpeech, deleteMyMeasurements, refreshMap }), [cells, collecting, consentEnabled, deleteMyMeasurements, latest, offerLocation, refreshMap, setConsent, status, suspendForSpeech, uploadedCount]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useNoise() {
  const value = useContext(Context);
  if (!value) throw new Error('NoiseProvider missing');
  return value;
}
