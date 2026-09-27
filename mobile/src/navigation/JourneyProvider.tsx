import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { ExpoSpeechRecognitionModule as Recognition, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { announce, stopFeedback, isFeedbackActive } from './feedback';
import { clearEvents, eventStatus, recordEvent, setRecording, getRecording } from './audit';
import { Guidance } from './guidance.mjs';
import { baseUrl, request, type Place, type Point, type Route } from './campusApi';
import { demoRoutes, searchDemo } from './demo';
import { useCamera } from '../camera/CameraProvider';
import { useAuth } from '../auth/AuthProvider';
import { useNoise } from '../noise/NoiseProvider';
import { routeNoiseSummary } from '../noise/routeNoise.mjs';
type Stage = 'search' | 'confirm' | 'routes' | 'setup' | 'navigating' | 'paused' | 'arrived';
function useJourneyController({ cameraReady, requestCamera, stopCamera }: {
  cameraReady: boolean; requestCamera: () => void; stopCamera: () => void;
}) {
  const auth = useAuth();
  const noise = useNoise();
  const [searchVersion, setSearchVersion] = useState(0);
  const [recentPlaces, setRecentPlaces] = useState<Place[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [destination, setDestination] = useState<Place | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selected, setSelected] = useState<Route | null>(null);
  const [stage, setStage] = useState<Stage>("search");
  const [message, setMessage] = useState("Where would you like to go?");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [recording, setRecordingState] = useState(true);
  const [position, setPosition] = useState<Point | null>(null);
  const revision = useRef(0);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const speechWanted = useRef(false);
  const watcher = useRef<Location.LocationSubscription | null>(null);
  const guidance = useRef<Guidance | null>(null);
  const watchGeneration = useRef(0);
  const lastFixAt = useRef(0);
  const uncertain = useRef(false);
  const lastMessage = useRef("");
  const routeRecorded = useRef(false);
  const stageRef = useRef(stage);
  stageRef.current = stage;

  useEffect(() => {
    if (!auth.user) return;
    const cloudRecent: Place[] = auth.places.filter(place => place.last_visited_at).slice(0, 3).map(place => ({
      id: place.external_place_id, name: place.name, address: place.address,
      ...(place.latitude == null ? {} : { latitude: place.latitude }),
      ...(place.longitude == null ? {} : { longitude: place.longitude }),
    }));
    setRecentPlaces(cloudRecent);
  }, [auth.places, auth.user]);

  const say = useCallback((text: string, priority = 3, done?: () => void) => {
    noise.suspendForSpeech();
    setMessage(text); lastMessage.current = text;
    speechWanted.current = false;
    Recognition.abort();
    announce(text, priority, "en-US", done);
  }, [noise.suspendForSpeech]);
  const stopTracking = useCallback(() => {
    watchGeneration.current++;
    watcher.current?.remove(); watcher.current = null;
  }, []);
  const pause = useCallback(() => {
    stopTracking(); stopFeedback(); Recognition.abort(); speechWanted.current = false;
    stopCamera();
    if (stageRef.current === "navigating") {
      setStage("paused"); setMessage("Navigation paused. Resume when you are ready.");
      recordEvent("navigation_paused");
    }
  }, [stopTracking, stopCamera]);

  const listen = useCallback(async () => {
    recordEvent("touch", "microphone");
    stopFeedback();
    try {
      const permission = await Recognition.requestPermissionsAsync();
      if (!permission.granted || !mounted.current || AppState.currentState !== "active") {
        if (mounted.current) setMessage("Microphone and speech recognition permission are needed. You can also type or tap.");
        return;
      }
      speechWanted.current = true;
      Recognition.start({ lang: "en-US", interimResults: false, continuous: false,
        recordingOptions: { persist: false } });
    } catch { if (mounted.current) say("Speech recognition is unavailable. Please type or tap."); }
  }, [say]);

  useEffect(() => {
    mounted.current = true;
    void getRecording().then(value => { if (mounted.current) setRecordingState(value); }).catch(() => { if (mounted.current) setMessage("Interaction recording is unavailable."); });
    const timer = setTimeout(() => say("SENSEA is now running. Where would you like to go?", 3, () => {
      // Automatically listen only after the user has previously granted OS permissions.
      void Recognition.getPermissionsAsync().then(result => {
        if (mounted.current && stageRef.current === "search" && result.granted && AppState.currentState === "active") void listen();
      }).catch(() => {});
    }), 700);
    return () => { mounted.current = false; clearTimeout(timer); revision.current++; active.current?.abort(); stopTracking(); stopFeedback(); Recognition.abort(); };
  }, [listen, say, stopTracking]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state === "background") {
        revision.current++; active.current?.abort(); setBusy(false); pause();
      }
    });
    return () => subscription.remove();
  }, [pause]);
  useEffect(() => { if (!cameraReady && stage === "navigating" && selected?.source !== "demo") pause(); }, [cameraReady, stage, pause, selected]);

  useEffect(() => {
    if (stage !== "search") return;
    const current = ++revision.current;
    active.current?.abort();
    stopFeedback();
    setPlaces([]);
    if (query.trim().length < 2 || (!demoMode && !baseUrl)) return;
    const controller = new AbortController(); active.current = controller;
    let timeout: ReturnType<typeof setTimeout>;
    const timer = setTimeout(() => {
      setBusy(true);
      timeout = setTimeout(() => controller.abort(), 15000);
      void (demoMode ? Promise.resolve({ places: searchDemo(query) }) : request(`/campus/places?q=${encodeURIComponent(query.trim())}`, controller.signal)).then(body => {
        if (current !== revision.current) return;
        setPlaces(body.places);
        say(body.places.length ? `${body.places.length} buildings found. ${body.places.slice(0, 3).map((place: Place, index: number) => `Option ${index + 1}: ${place.name}`).join('. ')}. Select a building or say its option number.` : "No buildings found. Try another English building name.", 3, () => { if (body.places.length) void listen(); });
      }).catch(() => { if (current === revision.current) say("UW search is unavailable. Change the query to try again."); })
        .finally(() => { clearTimeout(timeout); if (current === revision.current) setBusy(false); });
    }, 400);
    return () => { clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
  }, [query, stage, say, listen, demoMode, searchVersion]);

  async function perform(action: (signal: AbortSignal) => Promise<void>) {
    const current = ++revision.current;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 35000);
    setBusy(true);
    let onAbort: () => void = () => {};
    try {
      await Promise.race([
        action(controller.signal),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error("The request timed out or was cancelled. Please try again."));
          controller.signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    }
    catch (error) { if (current === revision.current && mounted.current) say(error instanceof Error ? error.message : "Please try again."); }
    finally { controller.signal.removeEventListener("abort", onAbort); clearTimeout(timeout); if (current === revision.current && mounted.current) setBusy(false); }
  }
  function selectPlace(place: Place) {
    if (busy) return;
    recordEvent("destination_selected", place.id);
    void perform(async signal => {
      const details = place.source === 'demo' ? place : await request(`/campus/places/${place.id}`, signal);
      if (signal.aborted || !mounted.current) return;
      setDestination(details); setRecentPlaces(previous => [details, ...previous.filter(place => place.id !== details.id)].slice(0, 3)); setStage("confirm");
      void auth.saveRecentPlace(details).catch(() => {});
      say(`${details.name}. ${details.address ? `The street address is ${details.address}.` : "The street address is not available."} Is this your destination? Say yes or tap Confirm.`, 3, () => void listen());
    });
  }
  function confirm() {
    if (!destination || busy) return;
    recordEvent("destination_confirmed", destination.id);
    if (destination.source === 'demo') {
      const options = demoRoutes(destination); setRoutes(options); setStage('routes');
      say('Simulation only. Three route fixtures are available: flat, shortest, and reviewed. Choose an option.', 3, () => void listen());
      return;
    }
    void perform(async signal => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (signal.aborted || !mounted.current) return;
      if (!permission.granted) throw new Error("Location permission is needed to route from your current position.");
      say("Finding your current position and walking routes.");
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (signal.aborted || !mounted.current) return;
      if (fix.coords.accuracy == null || fix.coords.accuracy > 30 || Date.now() - fix.timestamp > 10000) throw new Error("Your location is not accurate enough. Please retry outdoors.");
      setPosition(fix.coords);
      const result = await request("/campus/routes", signal, { origin: { latitude: fix.coords.latitude, longitude: fix.coords.longitude }, destination_id: Number(destination.id) });
      if (signal.aborted || !mounted.current) return;
      const preference = auth.currentNoisePreference();
      const scored = result.routes.map((route: Route) => {
        const summary = routeNoiseSummary(route.encoded_polyline, noise.cells);
        return { ...route, source: 'google' as const, noiseStatus: summary ? 'fresh' as const : 'unknown' as const,
          ...(summary ? { relativeNoise: summary.relativeNoise, noiseCellCount: summary.cellCount, noiseMeasurementCount: summary.measurementCount } : {}) };
      }).sort((a: Route, b: Route) => {
        if (a.relativeNoise == null && b.relativeNoise == null) return a.duration_seconds - b.duration_seconds;
        if (a.relativeNoise == null) return 1;
        if (b.relativeNoise == null) return -1;
        return preference === 'quiet' ? a.relativeNoise - b.relativeNoise : b.relativeNoise - a.relativeNoise;
      }).map((route: Route, index: number) => ({ ...route, label: `Walking route ${index + 1}` }));
      setRoutes(scored); setStage("routes");
      say(scored.map((route: Route, index: number) => `Option ${index + 1}: ${Math.ceil(route.duration_seconds / 60)} minutes, ${route.distance_m} meters${route.relativeNoise == null ? ', noise coverage unavailable' : `, ${preference === 'quiet' ? 'daytime quieter-route' : 'nighttime active-sound-route'} preference applied`}.`).join(" ") + " Noise does not prove crowd presence or safety. Stairs, slopes, and route safety have not been verified. Choose a route.", 3, () => void listen());
    });
  }
  function choose(route: Route) {
    recordEvent("route_selected", route.id);
    routeRecorded.current = false; setSelected(route); setStepIndex(0); guidance.current = new Guidance(route); setStage("setup");
    say("Hold your phone upright at chest level, facing forward. Turn on the camera below, then start guidance when it is ready.");
  }
  async function start() {
    if (!selected || busy) return;
    const recordRoute = () => {
      if (destination && !routeRecorded.current) {
        routeRecorded.current = true;
        void auth.recordRouteStart(destination, selected).catch(() => { routeRecorded.current = false; });
      }
    };
    if (selected.source === 'demo') { recordRoute(); setStage('navigating'); say(selected.steps[stepIndex]?.instruction ?? 'Simulation complete.', 2); return; }
    if (!cameraReady) { say("Prepare the camera first using the button below."); return; }
    recordRoute();
    recordEvent("navigation_start");
    const current = ++watchGeneration.current;
    watcher.current?.remove(); watcher.current = null;
    setBusy(true); uncertain.current = false; lastFixAt.current = Date.now();
    try {
      const subscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 }, fix => {
        if (current !== watchGeneration.current) return;
        lastFixAt.current = fix.timestamp;
        setPosition(fix.coords);
        noise.offerLocation(fix.coords);
        const event = guidance.current?.update({ ...fix.coords, timestamp: fix.timestamp });
        if (event?.kind === "uncertain") {
          if (!uncertain.current) { uncertain.current = true; say(event.text, 1); recordEvent("location_uncertain"); }
          return;
        }
        if (uncertain.current) { uncertain.current = false; say("Location signal recovered.", 2); }
        if (event) { setStepIndex(guidance.current?.step ?? 0); say(event.text, 2); recordEvent("guidance", event.kind); }
      }, () => { if (current === watchGeneration.current) { pause(); say("Location tracking failed. Guidance is paused.", 1); } });
      if (current !== watchGeneration.current || !mounted.current) { subscription.remove(); return; }
      watcher.current = subscription; setStage("navigating");
      say(`Camera feed is ready. Guidance will begin when location accuracy is sufficient. ${selected.steps[guidance.current?.step ?? 0]?.instruction ?? ""}`, 2);
    } catch { if (current === watchGeneration.current) say("Could not start location tracking. Please try again."); }
    finally { if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    if (stage !== "navigating" || selected?.source === "demo") return;
    const timer = setInterval(() => {
      if (Date.now() - lastFixAt.current > 5000 && !uncertain.current) {
        uncertain.current = true; say("Location signal is stale. Guidance is paused. Please stop and check your surroundings.", 1);
        recordEvent("location_stale");
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [stage, say, selected]);

  function reset() {
    revision.current++; active.current?.abort(); setBusy(false); pause();
    setStage("search"); setQuery(""); setPlaces([]); setRoutes([]); setSelected(null); setDestination(null);
    recordEvent("navigation_reset"); say("Where would you like to go?");
  }
  useSpeechRecognitionEvent("start", () => setListening(true));
  useSpeechRecognitionEvent("end", () => { setListening(false); speechWanted.current = false; });
  useSpeechRecognitionEvent("error", event => {
    if (speechWanted.current && event.error !== "aborted") say("I could not hear you. Tap the microphone to try again, or use the buttons.");
  });
  useSpeechRecognitionEvent("result", event => {
    if (!event.isFinal || !speechWanted.current || isFeedbackActive()) return;
    const text = event.results[0]?.transcript?.trim();
    if (!text) return;
    speechWanted.current = false; Recognition.stop(); recordEvent("voice_transcript", text);
    const command = text.toLowerCase().replace(/[.!?,]+$/g, "");
    if (/^(stop|pause)$/.test(command)) { pause(); return; }
    if (command === "repeat") { say(lastMessage.current); return; }
    if (command === "back" || command === "no") { reset(); return; }
    if (busy) { say("Please wait for the current request."); return; }
    const choice = command.match(/^(?:option )?(one|two|three|[1-9]|[12][0-9]|30)$/);
    const index = choice ? (["one", "two", "three"].includes(choice[1]) ? ["one", "two", "three"].indexOf(choice[1]) : Number(choice[1]) - 1) : -1;
    if (stage === "search") {
      if (index >= 0 && places[index]) selectPlace(places[index]);
      else setQuery(text.replace(/^take me to\s+/i, ""));
    } else if (stage === "confirm" && /^(yes|confirm)$/.test(command)) confirm();
    else if (stage === "routes" && routes[index]) choose(routes[index]);
    else if ((stage === "setup" || stage === "paused") && /^(camera|prepare camera|turn on camera)$/.test(command)) requestCamera();
    else if ((stage === "setup" || stage === "paused") && /^(start|resume|start navigation)$/.test(command)) void start();
    else say("Please use the available option number or the buttons on screen.");
  });


  function nextDemo() {
    if (selected?.source !== 'demo' || stage !== 'navigating') return;
    const next = stepIndex + 1;
    if (next >= selected.steps.length) { arrive(); return; }
    setStepIndex(next); say(selected.steps[next].instruction, 2); recordEvent('demo_step', String(next));
  }
  function arrive() { pause(); setStage('arrived'); recordEvent('arrival_confirmed'); say('Arrival confirmed. Guidance stopped.'); }
  function changeDemo(value: boolean) { reset(); setDemoMode(value); }
  return { query, setQuery, recentPlaces, search: (text: string) => { setStage('search'); setQuery(text); setSearchVersion(value => value + 1); }, places, destination, routes, selected, stage, message, busy, listening, recording,
    position, stepIndex, demoMode, baseUrl, selectPlace, confirm, choose, start, pause, reset, arrive, nextDemo,
    reviewRoutes: () => { pause(); setStage('routes'); }, changeDemo, listen, say, repeat: () => say(lastMessage.current),
    stopListening: () => { speechWanted.current = false; Recognition.abort(); },
    toggleRecording: async () => { await setRecording(!recording); setRecordingState(!recording); },
    checkRecords: async () => say(await eventStatus()),
    deleteRecords: async () => { await clearEvents(); setMessage('Interaction records deleted.'); announce('Interaction records deleted.', 3, 'en-US', undefined, false); },
  };
}

type Journey = ReturnType<typeof useJourneyController>;
const Context = createContext<Journey | null>(null);
export function JourneyProvider({ children }: { children: ReactNode }) {
  const camera = useCamera();
  const value = useJourneyController({ cameraReady: !!camera.ready, requestCamera: camera.open, stopCamera: camera.close });
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useJourney() { const value = useContext(Context); if (!value) throw new Error('JourneyProvider missing'); return value; }
