import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import type { Place, Route } from '@/src/navigation/campusApi';
import { isSupabaseConfigured, supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

export type Profile = {
  id: string;
  name: string;
  phone_number: string | null;
  emergency_contact: string | null;
  timezone: string;
};

export type UserPreferences = {
  user_id: string;
  route_priority: 'fastest' | 'flat' | 'safety' | 'balanced';
  avoid_stairs: boolean;
  avoid_mixed_traffic: boolean;
  prefer_crosswalks: boolean;
  avoid_construction: boolean;
  noise_policy: 'automatic_day_night';
  daytime_noise_preference: 'quiet';
  nighttime_noise_preference: 'active';
  day_starts_at: string;
  night_starts_at: string;
};

export type UserPlace = {
  id: string;
  external_place_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  is_saved: boolean;
  is_favorite: boolean;
  last_visited_at: string | null;
  visit_count: number;
};

type SignUpDetails = { email: string; password: string; name: string; phoneNumber: string; emergencyContact: string };
type AuthResult = { needsEmailConfirmation?: boolean };
type PlaceFlag = 'is_saved' | 'is_favorite';

// Multiple destinations can share one building coordinate (for example a library
// and café). Keep their visit history separate while routing by the numeric ID.
const historyKey = (place: Place) => place.buildingName ? `${place.id}:${place.name}` : place.id;

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  preferences: UserPreferences | null;
  places: UserPlace[];
  signUp: (details: SignUpDetails) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshUserData: () => Promise<void>;
  updateProfile: (value: Pick<Profile, 'name' | 'phone_number' | 'emergency_contact' | 'timezone'>) => Promise<void>;
  updatePreferences: (value: Partial<UserPreferences>) => Promise<void>;
  saveRecentPlace: (place: Place) => Promise<void>;
  setPlaceFlag: (place: UserPlace, flag: PlaceFlag, value: boolean) => Promise<void>;
  recordRouteStart: (destination: Place, route: Route) => Promise<void>;
  currentNoisePreference: () => 'quiet' | 'active';
};

const Context = createContext<AuthContextValue | null>(null);

function requireConfigured() {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured. Add the two EXPO_PUBLIC_SUPABASE variables to mobile/.env.');
}

function localTimeParts(timeZone: string) {
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()); }
  catch { parts = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()); }
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? new Date().getHours()) % 24;
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? new Date().getMinutes());
  return hour * 60 + minute;
}

function minutes(value: string) {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [places, setPlaces] = useState<UserPlace[]>([]);

  const clearUserData = useCallback(() => {
    setProfile(null);
    setPreferences(null);
    setPlaces([]);
  }, []);

  const loadUserData = useCallback(async (userId: string) => {
    const [profileResult, preferenceResult, placesResult] = await Promise.all([
      supabase.from('profiles').select('id,name,phone_number,emergency_contact,timezone').eq('id', userId).maybeSingle(),
      supabase.from('user_preferences').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('user_places').select('id,external_place_id,name,address,latitude,longitude,is_saved,is_favorite,last_visited_at,visit_count').eq('user_id', userId).order('last_visited_at', { ascending: false, nullsFirst: false }).limit(50),
    ]);
    const error = profileResult.error || preferenceResult.error || placesResult.error;
    if (error) throw error;
    setProfile(profileResult.data as Profile | null);
    setPreferences(preferenceResult.data as UserPreferences | null);
    setPlaces((placesResult.data ?? []) as UserPlace[]);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    let mounted = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user.id) return loadUserData(data.session.user.id);
      clearUserData();
    }).catch(() => clearUserData()).finally(() => { if (mounted) setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      if (nextSession?.user.id) void loadUserData(nextSession.user.id).catch(() => clearUserData());
      else clearUserData();
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, [clearUserData, loadUserData]);

  useEffect(() => {
    if (!isSupabaseConfigured || Platform.OS === 'web') return;
    if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    return () => { subscription.remove(); supabase.auth.stopAutoRefresh(); };
  }, []);

  const refreshUserData = useCallback(async () => {
    if (session?.user.id) await loadUserData(session.user.id);
  }, [loadUserData, session?.user.id]);

  const signUp = useCallback(async (details: SignUpDetails): Promise<AuthResult> => {
    requireConfigured();
    if (details.password.length < 8) throw new Error('Password must contain at least 8 characters.');
    if (!details.name.trim()) throw new Error('Please enter your name.');
    const { data, error } = await supabase.auth.signUp({
      email: details.email.trim().toLowerCase(),
      password: details.password,
      options: {
        emailRedirectTo: Linking.createURL('auth/callback'),
        data: { name: details.name.trim(), phone_number: details.phoneNumber.trim(), emergency_contact: details.emergencyContact.trim() },
      },
    });
    if (error) throw error;
    return { needsEmailConfirmation: !data.session };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    requireConfigured();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw error;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    requireConfigured();
    const redirectTo = Linking.createURL('auth/callback');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: Platform.OS !== 'web' },
    });
    if (error) throw error;
    if (Platform.OS === 'web') return;
    if (!data.url) throw new Error('Google sign-in could not be started.');
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') {
      if (result.type === 'cancel' || result.type === 'dismiss') return;
      throw new Error('Google sign-in did not complete.');
    }
    const callback = new URL(result.url);
    const oauthError = callback.searchParams.get('error_description') || callback.searchParams.get('error');
    if (oauthError) throw new Error(oauthError);
    const code = callback.searchParams.get('code');
    if (!code) throw new Error('Google did not return an authorization code.');
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) throw exchangeError;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const updateProfile = useCallback(async (value: Pick<Profile, 'name' | 'phone_number' | 'emergency_contact' | 'timezone'>) => {
    const userId = session?.user.id;
    if (!userId) throw new Error('Please sign in first.');
    const payload = { ...value, name: value.name.trim(), phone_number: value.phone_number?.trim() || null, emergency_contact: value.emergency_contact?.trim() || null };
    if (!payload.name) throw new Error('Please enter your name.');
    const { error } = await supabase.from('profiles').upsert({ id: userId, ...payload }, { onConflict: 'id' });
    if (error) throw error;
    await loadUserData(userId);
  }, [loadUserData, session?.user.id]);

  const updatePreferences = useCallback(async (value: Partial<UserPreferences>) => {
    const userId = session?.user.id;
    if (!userId) throw new Error('Please sign in first.');
    const { user_id: _ignored, ...safeValue } = value;
    const { error } = await supabase.from('user_preferences').upsert({ user_id: userId, ...safeValue }, { onConflict: 'user_id' });
    if (error) throw error;
    await loadUserData(userId);
  }, [loadUserData, session?.user.id]);

  const saveRecentPlace = useCallback(async (place: Place) => {
    const userId = session?.user.id;
    if (!userId) return;
    const externalId = historyKey(place);
    const previous = places.find(item => item.external_place_id === externalId);
    const { error } = await supabase.from('user_places').upsert({
      user_id: userId,
      external_place_id: externalId,
      name: place.name,
      address: place.address ?? null,
      latitude: place.latitude ?? null,
      longitude: place.longitude ?? null,
      is_saved: previous?.is_saved ?? false,
      is_favorite: previous?.is_favorite ?? false,
      last_visited_at: new Date().toISOString(),
      visit_count: (previous?.visit_count ?? 0) + 1,
    }, { onConflict: 'user_id,external_place_id' });
    if (error) throw error;
    await loadUserData(userId);
  }, [loadUserData, places, session?.user.id]);

  const setPlaceFlag = useCallback(async (place: UserPlace, flag: PlaceFlag, value: boolean) => {
    const userId = session?.user.id;
    if (!userId) throw new Error('Please sign in first.');
    const { error } = await supabase.from('user_places').update({ [flag]: value }).eq('id', place.id).eq('user_id', userId);
    if (error) throw error;
    await loadUserData(userId);
  }, [loadUserData, session?.user.id]);

  const currentNoisePreference = useCallback((): 'quiet' | 'active' => {
    const value = preferences;
    const timeZone = profile?.timezone || 'America/Chicago';
    const now = localTimeParts(timeZone);
    const dayStart = minutes(value?.day_starts_at ?? '07:00');
    const nightStart = minutes(value?.night_starts_at ?? '19:00');
    return now >= dayStart && now < nightStart ? 'quiet' : 'active';
  }, [preferences, profile?.timezone]);

  const recordRouteStart = useCallback(async (destination: Place, route: Route) => {
    const userId = session?.user.id;
    if (!userId) return;
    const place = places.find(item => item.external_place_id === historyKey(destination));
    const { error } = await supabase.from('route_history').insert({
      user_id: userId,
      destination_place_id: place?.id ?? null,
      route_external_id: route.id,
      destination_name: destination.name,
      distance_m: route.distance_m,
      duration_seconds: route.duration_seconds,
      has_stairs: route.hasStairs ?? null,
      // Current Google walking alternatives do not verify these properties.
      // User requests remain in user_preferences; history stays unknown until verified.
      avoided_mixed_traffic: null,
      used_crosswalks: null,
      avoided_construction: null,
      applied_noise_preference: currentNoisePreference(),
    });
    if (error) throw error;
  }, [currentNoisePreference, places, preferences, session?.user.id]);

  const value = useMemo<AuthContextValue>(() => ({
    configured: isSupabaseConfigured, loading, session, user: session?.user ?? null, profile, preferences, places,
    signUp, signIn, signInWithGoogle, signOut, refreshUserData, updateProfile, updatePreferences, saveRecentPlace,
    setPlaceFlag, recordRouteStart, currentNoisePreference,
  }), [currentNoisePreference, loading, places, preferences, profile, recordRouteStart, refreshUserData, saveRecentPlace, session, setPlaceFlag, signIn, signInWithGoogle, signOut, signUp, updatePreferences, updateProfile]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('AuthProvider missing');
  return value;
}
