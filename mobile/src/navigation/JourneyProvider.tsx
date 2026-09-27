import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import { ExpoSpeechRecognitionModule as Recognition, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { announce, stopFeedback, isFeedbackActive } from './feedback';
import { clearEvents, eventStatus, recordEvent, setRecording, getRecording } from './audit';
import { Guidance } from './guidance.mjs';
import { request, type Place, type Point, type Route } from './campusApi';
import { searchDirectory, directoryPlace } from './uwDirectory';
import { useCamera } from '../camera/CameraProvider';
import { useAuth } from '../auth/AuthProvider';
import { useNoise } from '../noise/NoiseProvider';
import { routeNoiseSummary } from '../noise/routeNoise.mjs';
import { rankWalkingRoutes } from './routeRanking.mjs';
import { useAppPreferences } from '../state/AppPreferences';
import { useNoiseMonitor } from '../noise/NoiseMonitorProvider';
import { PositionFusion } from './positionFusion.mjs';
import type { NavigationPosition, VerifiedVisualAlignment } from './positionFusion.mjs';
import { loadRouteCache, saveRouteCache } from './offlineCache';
import { parseVoiceCommand } from '../voice/commands';
import { directionCue, spokenDirection, type DirectionHaptic } from './direction';
type Stage = 'search' | 'routes' | 'setup' | 'navigating' | 'paused' | 'arrived';
type ArrivalStatus = 'none' | 'verified_entrance_nearby' | 'building_nearby';
function useJourneyController({ cameraReady, requestCamera, stopCamera, cameraAlignment }: {
  cameraReady: boolean; requestCamera: () => void; stopCamera: () => void;
  cameraAlignment: VerifiedVisualAlignment | null;
}) {
  const auth = useAuth();
  const noise = useNoise();
  const routePreferences = useAppPreferences();
  const { suspend: suspendNoiseMonitor, resume: resumeNoiseMonitor } = useNoiseMonitor();
  const [searchVersion, setSearchVersion] = useState(0);
  const [recentPlaces, setRecentPlaces] = useState<Place[]>([]);
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
  const [rerouting, setRerouting] = useState(false);
  const [arrivalStatus, setArrivalStatus] = useState<ArrivalStatus>('none');
  const [recording, setRecordingState] = useState(true);
  const [position, setPosition] = useState<NavigationPosition | null>(null);
  const revision = useRef(0);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const speechWanted = useRef(false);
  const speechStarting = useRef(false);
  const speechRevision = useRef(0);
  const watcher = useRef<Location.LocationSubscription | null>(null);
  const motionWatcher = useRef<{ remove(): void } | null>(null);
  const fusion = useRef(new PositionFusion());
  const guidance = useRef<Guidance | null>(null);
  const watchGeneration = useRef(0);
  const lastFixAt = useRef(0);
  const uncertain = useRef(false);
  const lastMessage = useRef("");
  const routeRecorded = useRef(false);
  const routeHistoryWrite = useRef<Promise<string | null> | null>(null);
  const rerouteInFlight = useRef(false);
  const lastRerouteAt = useRef(0);
  const rerouteController = useRef<AbortController | null>(null);
  const rerouteGeneration = useRef(0);
  const cameraAlignmentRef = useRef(cameraAlignment);
  cameraAlignmentRef.current = cameraAlignment;
  const stageRef = useRef(stage);
  stageRef.current = stage;

  useEffect(() => {
    if (!auth.user) { setRecentPlaces([]); return; }
    const cloudRecent: Place[] = auth.places.filter(place => place.last_visited_at).slice(0, 3).map(place => ({
      id: place.external_place_id.split(':', 1)[0], name: place.name, address: place.address,
      ...(place.latitude == null ? {} : { latitude: place.latitude }),
      ...(place.longitude == null ? {} : { longitude: place.longitude }),
    }));
    setRecentPlaces(cloudRecent);
  }, [auth.places, auth.user]);

  const say = useCallback((text: string, priority = 3, done?: () => void, haptic?: DirectionHaptic) => {
    noise.suspendForSpeech();
    setMessage(text); lastMessage.current = text;
    speechWanted.current = false; speechRevision.current++;
    Recognition.abort();
    announce(text, priority, "en-US", done, true, undefined, { haptic });
  }, [noise.suspendForSpeech]);
  const stopTracking = useCallback(() => {
    watchGeneration.current++;
    rerouteGeneration.current++;
    rerouteController.current?.abort(); rerouteController.current = null;
    rerouteInFlight.current = false;
    if (mounted.current) setRerouting(false);
    watcher.current?.remove(); watcher.current = null;
    motionWatcher.current?.remove(); motionWatcher.current = null;
    fusion.current.reset();
  }, []);
  const pause = useCallback(() => {
    speechRevision.current++; stopTracking(); stopFeedback(); Recognition.abort(); speechWanted.current = false;
    stopCamera();
    if (stageRef.current === "navigating") {
      setStage("paused"); setMessage("Navigation paused. Resume when you are ready.");
      recordEvent("navigation_paused");
    }
  }, [stopTracking, stopCamera]);

  const listen = useCallback(async () => {
    if (speechStarting.current || speechWanted.current) return;
    speechStarting.current = true;
    const request = ++speechRevision.current;
    recordEvent("touch", "microphone");
    stopFeedback();
    noise.suspendForSpeech();
    try {
      suspendNoiseMonitor('speech-recognition');
      // Allow pending native abort and microphone release to finish on iOS.
      await new Promise(resolve => setTimeout(resolve, Platform.OS === 'ios' ? 350 : 100));
      const permission = await Recognition.requestPermissionsAsync();
      if (request !== speechRevision.current) { resumeNoiseMonitor('speech-recognition'); return; }
      if (!permission.granted || !mounted.current || AppState.currentState !== "active") {
        if (mounted.current) setMessage("Microphone and speech recognition permission are needed. You can also type or tap.");
        resumeNoiseMonitor('speech-recognition');
        return;
      }
      speechWanted.current = true;
      Recognition.start({ lang: "en-US", interimResults: true, continuous: false,
        contextualStrings: ["College Library", "Memorial Library", "Morgridge Hall", "Memorial Union"],
        recordingOptions: { persist: false } });
    } catch {
      resumeNoiseMonitor('speech-recognition');
      speechWanted.current = false;
      if (mounted.current) setMessage("Speech recognition is unavailable. Please type or tap.");
    } finally { speechStarting.current = false; }
  }, [suspendNoiseMonitor, resumeNoiseMonitor, noise.suspendForSpeech]);

  useEffect(() => {
    mounted.current = true;
    void getRecording().then(value => { if (mounted.current) setRecordingState(value); }).catch(() => { if (mounted.current) setMessage("Interaction recording is unavailable."); });
    const timer = setTimeout(() => say("SENSEA is now running. Voice controls are active. Where would you like to go?", 3, () => {
      // Ask once on first launch, then prepare voice input automatically on later launches.
      if (mounted.current && stageRef.current === "search" && AppState.currentState === "active") void listen();
    }), 700);
    return () => { mounted.current = false; clearTimeout(timer); revision.current++; active.current?.abort(); stopTracking(); stopFeedback(); Recognition.abort(); resumeNoiseMonitor('speech-recognition'); };
  }, [listen, say, stopTracking, resumeNoiseMonitor]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state === "background") {
        revision.current++; active.current?.abort(); setBusy(false); pause();
      }
    });
    return () => subscription.remove();
  }, [pause]);
  useEffect(() => {
    if (stage !== "search") return;
    const current = ++revision.current;
    active.current?.abort();
    stopFeedback();
    setPlaces([]);
    if (query.trim().length < 2) return;
    const controller = new AbortController(); active.current = controller;
    let timeout: ReturnType<typeof setTimeout>;
    const timer = setTimeout(() => {
      setBusy(true);
      timeout = setTimeout(() => controller.abort(), 15000);
      void searchDirectory(query, controller.signal).then(foundPlaces => {
        if (current !== revision.current) return;
        if (foundPlaces.length === 1) { selectPlace(foundPlaces[0]); return; }
        setPlaces(foundPlaces);
        say(foundPlaces.length ? `${foundPlaces.length} buildings found. ${foundPlaces.slice(0, 3).map((place: Place, index: number) => `Option ${index + 1}: ${place.name}`).join('. ')}. Select a building or say its option number.` : "No buildings found. Try another English building name.", 3, () => { if (foundPlaces.length) void listen(); });
      }).catch(error => {
        if (current === revision.current && !(error instanceof Error && error.name === 'AbortError')) {
          say(error instanceof Error ? error.message : 'UW building search is unavailable. Please try again.');
        }
      })
        .finally(() => { clearTimeout(timeout); if (current === revision.current) setBusy(false); });
    }, 400);
    return () => { clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
  }, [query, stage, say, listen, searchVersion]);

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
  const orderRoutes = useCallback((priority: string) => {
    setRoutes(previous => {
      const ordered: Route[] = rankWalkingRoutes(previous, { period: auth.currentNoisePreference() === 'active' ? 'night' : 'day',
        priority, avoidStairs: auth.preferences?.avoid_stairs ?? true,
        avoidMixedTraffic: auth.preferences?.avoid_mixed_traffic ?? true,
        preferCrosswalks: auth.preferences?.prefer_crosswalks ?? true,
        avoidConstruction: routePreferences.avoidConstruction, preferWellLit: routePreferences.preferWellLit });
      return ordered.length === previous.length && ordered.every((route, index) => route === previous[index] && route.label === `Walking route ${index + 1}`)
        ? previous : ordered.map((route, index) => ({ ...route, label: `Walking route ${index + 1}` }));
    });
  }, [auth.currentNoisePreference, auth.preferences?.avoid_stairs, auth.preferences?.avoid_mixed_traffic,
    auth.preferences?.prefer_crosswalks, routePreferences.avoidConstruction, routePreferences.preferWellLit]);
  function selectPlace(place: Place) {
    recordEvent("destination_selected", place.id);
    void perform(async signal => {
      const details = await directoryPlace(place.id, place.name, signal);
      if (!details || signal.aborted || !mounted.current) return;
      setDestination(details); setPlaces([]); setStage("routes");
      recordEvent("destination_confirmed", details.id);
      await loadLiveRoutes(details, signal);
    });
  }
  function prepareLiveRoutes(rawRoutes: Route[], arrivalTarget?: { latitude: number; longitude: number; verified_entrance: boolean; kind: 'verified_entrance' | 'building_representative_point'; accuracy_m?: number | null; surveyed_at?: string | null; description?: string | null }) {
    const preference = auth.currentNoisePreference();
    const enriched = rawRoutes.map((route: Route) => {
      const summary = routeNoiseSummary(route.encoded_polyline, noise.cells);
      const credible = summary && summary.coverageRatio >= 0.7 && summary.measurementCount >= 10 && summary.contributorCount >= 3;
      return { ...route, source: 'google' as const,
        ...(arrivalTarget ? { arrivalTarget: { latitude: arrivalTarget.latitude, longitude: arrivalTarget.longitude, verifiedEntrance: arrivalTarget.verified_entrance, kind: arrivalTarget.kind,
          accuracyM: arrivalTarget.accuracy_m, surveyedAt: arrivalTarget.surveyed_at, description: arrivalTarget.description } } : {}),
        noiseStatus: credible ? 'fresh' as const : 'unknown' as const,
        ...(credible ? { relativeNoise: summary.relativeNoise, noiseCellCount: summary.cellCount, noiseMeasurementCount: summary.measurementCount,
          noiseContributorCount: summary.contributorCount, noiseCoverage: summary.coverageRatio } : {}) };
    });
    return rankWalkingRoutes(enriched, { period: preference === 'active' ? 'night' : 'day', priority: routePreferences.routePriority,
      avoidStairs: auth.preferences?.avoid_stairs ?? true, avoidConstruction: routePreferences.avoidConstruction,
      avoidMixedTraffic: auth.preferences?.avoid_mixed_traffic ?? true,
      preferCrosswalks: auth.preferences?.prefer_crosswalks ?? true,
      preferWellLit: routePreferences.preferWellLit }).map((route: Route, index: number) => ({ ...route, label: `Walking route ${index + 1}` }));
  }
  async function loadLiveRoutes(place: Place, signal: AbortSignal) {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (signal.aborted || !mounted.current) return;
      if (!permission.granted) throw new Error("Location permission is needed to route from your current position.");
      say("Finding your current position and walking routes.");
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (signal.aborted || !mounted.current) return;
      if (fix.coords.accuracy == null || fix.coords.accuracy > 30 || Date.now() - fix.timestamp > 10000) throw new Error("Your location is not accurate enough. Please retry outdoors.");
      setPosition({ latitude: fix.coords.latitude, longitude: fix.coords.longitude,
        accuracy: fix.coords.accuracy, timestamp: fix.timestamp, source: 'gps' });
      const preference = auth.currentNoisePreference();
      const origin = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
      let scored: Route[];
      let offline = false;
      try {
        const result = await request<{ routes: Route[]; arrival_target?: { latitude: number; longitude: number; verified_entrance: boolean; kind: 'verified_entrance' | 'building_representative_point'; accuracy_m?: number | null; surveyed_at?: string | null; description?: string | null } }>("/campus/routes", signal, { origin, destination_id: Number(place.id) });
        if (signal.aborted || !mounted.current) return;
        scored = prepareLiveRoutes(result.routes, result.arrival_target);
        const target = scored[0]?.arrivalTarget;
        void saveRouteCache(place, origin, scored, target).catch(() => {});
      } catch (error) {
        if (signal.aborted) throw error;
        const cached = await loadRouteCache(place, origin);
        if (!cached) throw error;
        offline = true;
        scored = cached.routes.map(route => ({
          ...route,
          source: 'offline-cache' as const,
          warnings: ['Offline copy: conditions and closures may have changed.', ...(route.warnings ?? [])],
        }));
      }
      if (!scored.length) throw new Error('No walking route is available for this destination.');
      setRoutes(scored); setStage("routes");
      if (scored.length === 1) { choose(scored[0]); return; }
      say(`${offline ? 'Network unavailable. Using a recent route saved on this device. Conditions may have changed. ' : ''}${scored.map((route: Route, index: number) => `Option ${index + 1}: ${Math.ceil(route.duration_seconds / 60)} minutes, ${route.distance_m} meters${route.relativeNoise == null ? ', noise coverage unavailable' : `, ${preference === 'quiet' ? 'daytime quieter-route' : 'nighttime active-sound-route'} preference applied`}.`).join(" ")} Noise does not prove crowd presence or safety. Stairs, slopes, and route safety have not been verified. Choose a route.`, 3, () => void listen());
  }
  function confirm() {
    if (!destination || busy) return;
    void perform(signal => loadLiveRoutes(destination, signal));
  }
  function choose(route: Route) {
    recordEvent("route_selected", route.id);
    routeRecorded.current = false; routeHistoryWrite.current = null;
    setArrivalStatus('none'); setSelected(route); setStepIndex(0); guidance.current = new Guidance(route); setStage("setup");
    say(route.source === 'offline-cache'
      ? "Using a recent route saved on this device. Network updates and current closures are unavailable. You can start GPS guidance now."
      : "Your route is selected. Say start or start navigating to begin GPS guidance. Camera observations are optional.", 3, () => {
        if (mounted.current && stageRef.current === 'setup') void listen();
      });
  }
  async function rerouteFrom(origin: Point) {
    if (!destination || rerouteInFlight.current) return;
    if (Date.now() - lastRerouteAt.current < 30000) {
      guidance.current?.clearOffRoute();
      pause();
      say('The replacement route also appears unreliable. Guidance is paused. Please stop and choose a route again.', 1);
      recordEvent('reroute_cooldown_pause');
      return;
    }
    rerouteInFlight.current = true; lastRerouteAt.current = Date.now(); setRerouting(true);
    say('You appear to be off route. Stop while SENSEA requests a new walking route.', 1);
    const generation = ++rerouteGeneration.current;
    const controller = new AbortController(); rerouteController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const result = await request<{ routes: Route[]; arrival_target?: { latitude: number; longitude: number; verified_entrance: boolean; kind: 'verified_entrance' | 'building_representative_point'; accuracy_m?: number | null; surveyed_at?: string | null; description?: string | null } }>(
        '/campus/routes', controller.signal,
        { origin: { latitude: origin.latitude, longitude: origin.longitude }, destination_id: Number(destination.id) },
      );
      if (!mounted.current || controller.signal.aborted || generation !== rerouteGeneration.current) return;
      const refreshed = prepareLiveRoutes(result.routes, result.arrival_target);
      const next = refreshed[0];
      if (!next) throw new Error('No replacement walking route is available.');
      setRoutes(refreshed); setSelected(next); setStepIndex(0); setArrivalStatus('none'); guidance.current = new Guidance(next);
      recordEvent('route_recalculated', next.id);
      say(`A new route is ready. ${next.steps[0]?.instruction ?? 'Continue only when you are ready.'}`, 1);
    } catch (error) {
      if (!mounted.current || generation !== rerouteGeneration.current) return;
      guidance.current?.clearOffRoute();
      pause();
      say(error instanceof Error && error.name !== 'AbortError'
        ? `Automatic rerouting failed. Guidance is paused. ${error.message}`
        : 'Automatic rerouting timed out. Guidance is paused. Please retry.', 1);
    } finally {
      clearTimeout(timeout);
      if (rerouteController.current === controller) rerouteController.current = null;
      if (generation === rerouteGeneration.current) {
        rerouteInFlight.current = false;
        if (mounted.current) setRerouting(false);
      }
    }
  }
  async function start() {
    if (!selected || busy) return;
    const recordRoute = () => {
      if (destination && !routeRecorded.current) {
        routeRecorded.current = true;
        routeHistoryWrite.current = auth.recordRouteStart(destination, selected).catch(() => {
          routeRecorded.current = false; return null;
        });
      }
    };
    if (arrivalStatus !== 'none') {
      setArrivalStatus('none');
      guidance.current?.clearArrival();
    }
    recordRoute();
    recordEvent("navigation_start");
    const current = ++watchGeneration.current;
    watcher.current?.remove(); watcher.current = null;
    setBusy(true); uncertain.current = false; lastFixAt.current = Date.now();
    try {
      fusion.current.reset();
      if (await DeviceMotion.isAvailableAsync()) {
        DeviceMotion.setUpdateInterval(250);
        motionWatcher.current = DeviceMotion.addListener(sample => {
          const acceleration = sample.acceleration;
          if (!acceleration) return;
          fusion.current.offerMotion({
            acceleration: Math.hypot(acceleration.x, acceleration.y, acceleration.z),
            timestamp: Date.now(),
          });
        });
      }
      const subscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 }, fix => {
        if (current !== watchGeneration.current) return;
        lastFixAt.current = fix.timestamp;
        const fused = fusion.current.updateGps({ ...fix.coords, accuracy: fix.coords.accuracy ?? Infinity, heading: fix.coords.heading, speed: fix.coords.speed, timestamp: fix.timestamp }, cameraAlignmentRef.current);
        setPosition(fused);
        if (fused.trusted !== false) noise.offerLocation(fused);
        const event = guidance.current?.update(fused);
        if (event?.kind === "uncertain") {
          if (!uncertain.current) { uncertain.current = true; say(event.text, 1); recordEvent("location_uncertain"); }
          return;
        }
        if (uncertain.current) { uncertain.current = false; say("Location signal recovered.", 2); }
        if (event?.kind === 'off_route') {
          recordEvent('off_route_detected', String(Math.round(event.distance)));
          void rerouteFrom(fused);
          return;
        }
        if (event?.kind === 'entrance_reached' || event?.kind === 'near_destination') {
          setArrivalStatus(event.kind === 'entrance_reached' ? 'verified_entrance_nearby' : 'building_nearby');
          stopTracking();
          setStage('paused');
          say(event.text, 1);
          recordEvent('arrival_candidate', event.kind);
          return;
        }
        if (event) {
          // A pre-turn cue describes the segment after the corner. Once the
          // turn is confirmed, event.step already points at that segment.
          const directionStep = event.kind === 'turn' || event.kind === 'approaching'
            ? selected.steps[event.kind === 'approaching' ? event.step + 1 : event.step]
            : undefined;
          const cue = directionCue(fused, directionStep?.end);
          setStepIndex(guidance.current?.step ?? 0);
          say(`${event.text}${cue ? ` ${spokenDirection(cue)}` : ''}`, 2, undefined, cue?.haptic);
          recordEvent("guidance", event.kind);
        }
      }, () => { if (current === watchGeneration.current) { pause(); say("Location tracking failed. Guidance is paused.", 1); } });
      if (current !== watchGeneration.current || !mounted.current) { subscription.remove(); return; }
      watcher.current = subscription; setStage("navigating");
      say(`${cameraReady ? 'Optional camera observations are active.' : 'Camera observations are off.'} GPS guidance will begin when location accuracy is sufficient. ${selected.steps[guidance.current?.step ?? 0]?.instruction ?? ""}`, 2);
    } catch { if (current === watchGeneration.current) say("Could not start location tracking. Please try again."); }
    finally { if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    if (stage !== "navigating") return;
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
    routeHistoryWrite.current = null;
    setStage("search"); setArrivalStatus('none'); setQuery(""); setPlaces([]); setRoutes([]); setSelected(null); setDestination(null);
    recordEvent("navigation_reset"); say("Where would you like to go?");
  }
  useSpeechRecognitionEvent("start", () => { if (speechWanted.current) setListening(true); else Recognition.abort(); });
  useSpeechRecognitionEvent("end", () => { if (speechStarting.current) return; setListening(false); speechWanted.current = false; resumeNoiseMonitor('speech-recognition'); });
  useSpeechRecognitionEvent("error", event => {
    if (speechStarting.current && event.error === 'aborted') return;
    console.warn('[SENSEA] Speech recognition error', event.error, event.message);
    resumeNoiseMonitor('speech-recognition');
    const wanted = speechWanted.current; speechWanted.current = false; setListening(false);
    if (wanted && event.error !== "aborted") setMessage(`Voice input stopped (${event.error}). Tap to try again, or type a destination.`);
  });
  useSpeechRecognitionEvent("result", event => {
    if (!speechWanted.current || isFeedbackActive()) return;
    if (!event.isFinal) {
      const partial = event.results[0]?.transcript?.trim();
      if (partial) setMessage(`Heard: ${partial}`);
      return;
    }
    const text = event.results[0]?.transcript?.trim();
    if (!text) return;
    speechWanted.current = false; Recognition.stop(); recordEvent("voice_transcript", text);
    const command = text.toLowerCase().replace(/[.!?,]+$/g, "").replace(/\s+/g, " ").trim();
    if (/^(stop|pause)$/.test(command)) { pause(); return; }
    if (command === "repeat") { say(lastMessage.current); return; }
    if (command === "back" || command === "no") { reset(); return; }
    if (busy) { say("Please wait for the current request."); return; }
    const choice = command.match(/^(?:(?:option|route|select|choose)(?: (?:route|option))? )?(one|two|three|[1-9]|[12][0-9]|30)$/);
    const index = choice ? (["one", "two", "three"].includes(choice[1]) ? ["one", "two", "three"].indexOf(choice[1]) : Number(choice[1]) - 1) : -1;
    if (stage === "search") {
      if (index >= 0 && places[index]) selectPlace(places[index]);
      else setQuery(text.replace(/^take me to\s+/i, ""));
    } else if (stage === "routes" && routes[index]) choose(routes[index]);
    else if ((stage === "setup" || stage === "paused") && /^(camera|prepare camera|turn on camera)$/.test(command)) requestCamera();
    else if ((stage === "setup" || stage === "paused") && (parseVoiceCommand(command).type === 'START_NAVIGATION' || parseVoiceCommand(command).type === 'RESUME')) void start();
    else say("Please use the available option number or the buttons on screen.");
  });


  function arrive() {
    pause(); setStage('arrived'); recordEvent('arrival_confirmed', arrivalStatus);
    if (destination) void auth.saveRecentPlace(destination).catch(() => {});
    const write = routeHistoryWrite.current; routeHistoryWrite.current = null;
    if (write) void write.then(id => id ? auth.completeRoute(id) : undefined).catch(() => {});
    say('Arrival confirmed. Guidance stopped.');
  }
  return { query, setQuery, recentPlaces, search: (text: string) => { setStage('search'); setQuery(text); setSearchVersion(value => value + 1); }, places, destination, routes, selected, stage, message, busy, rerouting, arrivalStatus, listening, recording,
    position, stepIndex, orderRoutes, selectPlace, confirm, choose, start, pause, reset, arrive,
    reviewRoutes: () => { pause(); setStage('routes'); }, listen, say, repeat: () => say(lastMessage.current),
    stopListening: () => { speechRevision.current++; speechWanted.current = false; setListening(false); Recognition.abort(); resumeNoiseMonitor('speech-recognition'); },
    toggleRecording: async () => { await setRecording(!recording); setRecordingState(!recording); },
    checkRecords: async () => say(await eventStatus()),
    deleteRecords: async () => { await clearEvents(); setMessage('Interaction records deleted.'); announce('Interaction records deleted.', 3, 'en-US', undefined, false); },
  };
}

type Journey = ReturnType<typeof useJourneyController>;
const Context = createContext<Journey | null>(null);
export function JourneyProvider({ children }: { children: ReactNode }) {
  const camera = useCamera();
  const value = useJourneyController({ cameraReady: !!camera.ready, requestCamera: camera.open, stopCamera: camera.close, cameraAlignment: camera.visualAlignment });
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useJourney() { const value = useContext(Context); if (!value) throw new Error('JourneyProvider missing'); return value; }
