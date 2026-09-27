import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { ExpoSpeechRecognitionModule as Recognition, useSpeechRecognitionEvent } from "expo-speech-recognition";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { announce, stopFeedback, isFeedbackActive } from "./feedback";
import { clearEvents, eventStatus, recordEvent, setRecording, getRecording } from "./audit";
import { decodePolyline, Guidance } from "./guidance.mjs";

type Point = { latitude: number; longitude: number };
type Place = { id: string; name: string; address?: string | null } & Partial<Point>;
type Route = { id: string; distance_m: number; duration_seconds: number; encoded_polyline: string;
  warnings: string[]; steps: { instruction: string; start: Point; end: Point }[] };
type Stage = "search" | "confirm" | "routes" | "setup" | "navigating" | "paused" | "arrived";
const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, "");
const mapKey = Platform.OS === "ios" ? process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY : process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY;

async function request(path: string, signal: AbortSignal, body?: unknown) {
  if (!baseUrl) throw new Error("Set the SENSEA server address first.");
  const response = await fetch(`${baseUrl}${path}`, { signal,
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-Sensea-Token": process.env.EXPO_PUBLIC_API_TOKEN ?? "" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "The request failed. Please try again.");
  return result;
}

export function CampusSearch({ cameraReady, requestCamera, stopCamera }: {
  cameraReady: boolean; requestCamera: () => void; stopCamera: () => void;
}) {
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
  const stageRef = useRef(stage);
  stageRef.current = stage;

  const say = useCallback((text: string, priority = 3, done?: () => void) => {
    setMessage(text); lastMessage.current = text;
    speechWanted.current = false;
    Recognition.abort();
    announce(text, priority, "en-US", done);
  }, []);
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
  useEffect(() => { if (!cameraReady && stage === "navigating") pause(); }, [cameraReady, stage, pause]);

  useEffect(() => {
    if (stage !== "search") return;
    const current = ++revision.current;
    active.current?.abort();
    stopFeedback();
    setPlaces([]);
    if (query.trim().length < 2 || !baseUrl) return;
    const controller = new AbortController(); active.current = controller;
    let timeout: ReturnType<typeof setTimeout>;
    const timer = setTimeout(() => {
      setBusy(true);
      timeout = setTimeout(() => controller.abort(), 15000);
      void request(`/campus/places?q=${encodeURIComponent(query.trim())}`, controller.signal).then(body => {
        if (current !== revision.current) return;
        setPlaces(body.places);
        say(body.places.length ? `${body.places.length} buildings found. ${body.places.slice(0, 3).map((place: Place, index: number) => `Option ${index + 1}: ${place.name}`).join('. ')}. Select a building or say its option number.` : "No buildings found. Try another English building name.", 3, () => { if (body.places.length) void listen(); });
      }).catch(() => { if (current === revision.current) say("UW search is unavailable. Change the query to try again."); })
        .finally(() => { clearTimeout(timeout); if (current === revision.current) setBusy(false); });
    }, 400);
    return () => { clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
  }, [query, stage, say, listen]);

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
      const details = await request(`/campus/places/${place.id}`, signal);
      if (signal.aborted || !mounted.current) return;
      setDestination(details); setStage("confirm");
      say(`${details.name}. ${details.address ? `The street address is ${details.address}.` : "The street address is not available."} Is this your destination? Say yes or tap Confirm.`, 3, () => void listen());
    });
  }
  function confirm() {
    if (!destination || busy) return;
    recordEvent("destination_confirmed", destination.id);
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
      setRoutes(result.routes); setStage("routes");
      say(result.routes.map((route: Route, index: number) => `Option ${index + 1}: ${Math.ceil(route.duration_seconds / 60)} minutes, ${route.distance_m} meters.`).join(" ") + " Stairs, slopes, and route safety have not been verified. Choose a route.", 3, () => void listen());
    });
  }
  function choose(route: Route) {
    recordEvent("route_selected", route.id);
    setSelected(route); guidance.current = new Guidance(route); setStage("setup");
    say("Hold your phone upright at chest level, facing forward. Turn on the camera below, then start guidance when it is ready.");
  }
  async function start() {
    if (!selected || busy) return;
    if (!cameraReady) { say("Prepare the camera first using the button below."); return; }
    recordEvent("navigation_start");
    const current = ++watchGeneration.current;
    watcher.current?.remove(); watcher.current = null;
    setBusy(true); uncertain.current = false; lastFixAt.current = Date.now();
    try {
      const subscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 1 }, fix => {
        if (current !== watchGeneration.current) return;
        lastFixAt.current = fix.timestamp;
        setPosition(fix.coords);
        const event = guidance.current?.update({ ...fix.coords, timestamp: fix.timestamp });
        if (event?.kind === "uncertain") {
          if (!uncertain.current) { uncertain.current = true; say(event.text, 1); recordEvent("location_uncertain"); }
          return;
        }
        if (uncertain.current) { uncertain.current = false; say("Location signal recovered.", 2); }
        if (event) { say(event.text, 2); recordEvent("guidance", event.kind); }
      }, () => { if (current === watchGeneration.current) { pause(); say("Location tracking failed. Guidance is paused.", 1); } });
      if (current !== watchGeneration.current || !mounted.current) { subscription.remove(); return; }
      watcher.current = subscription; setStage("navigating");
      say(`Camera feed is ready. Guidance will begin when location accuracy is sufficient. ${selected.steps[guidance.current?.step ?? 0]?.instruction ?? ""}`, 2);
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
  }, [stage, say]);

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

  const points = useMemo(() => { try { return selected ? decodePolyline(selected.encoded_polyline) : []; } catch { return []; } }, [selected]);
  const button = (label: string, action: () => void, disabled = false) => <Pressable style={[styles.button, disabled && { opacity: 0.5 }]} accessibilityRole="button"
    accessibilityState={{ disabled }} disabled={disabled} onPress={() => { recordEvent("touch", label); action(); }}><Text style={styles.name}>{label}</Text></Pressable>;
  return <View style={styles.container}>
    <Text style={styles.title} accessibilityRole="header">Campus navigation</Text>
    <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text>
    {!baseUrl && <Text style={styles.note}>Configure the SENSEA server address to search.</Text>}
    {stage === "search" && <>
      <TextInput style={styles.input} value={query} onChangeText={value => { recordEvent("text_input", "destination edited"); setQuery(value); }}
        accessibilityLabel="UW building name" placeholder="Memorial Union" placeholderTextColor="#AFC0D2" autoCorrect={false} maxLength={100} />
      {places.map((place, index) => <View key={place.id}>{button(`${index + 1}. ${place.name}`, () => selectPlace(place), busy)}</View>)}
      <Text style={styles.note}>Building search: UW–Madison</Text>
    </>}
    {stage === "confirm" && <>
      <Text style={styles.name}>{destination?.name}</Text><Text style={styles.note}>{destination?.address ?? "Street address unavailable"}</Text>
      {button("Confirm destination", confirm, busy)}
    </>}
    {stage === "routes" && <View style={styles.google}>
      {routes.map((route, index) => <View key={route.id}>
        {button(`Option ${index + 1}: ${Math.ceil(route.duration_seconds / 60)} min · ${route.distance_m} m`, () => choose(route))}
        {route.warnings.map((warning, i) => <Text key={i} style={styles.note}>{warning}</Text>)}
      </View>)}
      <Text style={styles.note}>Stairs, slopes, and accessible entrances: not verified.</Text>
      <Text style={styles.attribution}>Google Maps</Text>
    </View>}
    {selected && <View style={styles.google}>
      {mapKey && points.length > 0 && <MapView style={{ height: 220 }} provider={PROVIDER_GOOGLE}
        initialRegion={{ ...points[0], latitudeDelta: 0.01, longitudeDelta: 0.01 }}
        accessibilityLabel="Selected walking route on Google Maps">
        <Polyline coordinates={points} strokeWidth={5} strokeColor="#167966" />
        {position && <Marker coordinate={position} title="Current position" />}
        <Marker coordinate={points[points.length - 1]} title={destination?.name} />
      </MapView>}
      {!mapKey && <Text style={styles.note}>Map display needs a Google Maps SDK key. Route instructions remain inside SENSEA.</Text>}
      <Text style={styles.note}>{selected.distance_m} m · {Math.ceil(selected.duration_seconds / 60)} min</Text>
      {selected.warnings.map((warning, index) => <Text key={index} style={styles.note}>{warning}</Text>)}
      <Text style={styles.attribution}>Google Maps</Text>
    </View>}
    {(stage === "setup" || stage === "paused") && <>
      {button(cameraReady ? "Camera ready" : "Prepare camera", requestCamera, cameraReady)}
      {button(stage === "paused" ? "Resume guidance" : "Start guidance", () => void start(), !cameraReady || busy)}
      <Text style={styles.note}>A ready camera feed does not verify your position or a clear path.</Text>
    </>}
    {stage === "navigating" && <>
      {button("Pause guidance", pause)}
      {button("Confirm arrival", () => { pause(); setStage("arrived"); recordEvent("arrival_confirmed"); say("Arrival confirmed. Guidance stopped."); })}
    </>}
    {button(listening ? "Stop listening" : "Speak destination or command", () => { if (listening) { speechWanted.current = false; Recognition.abort(); } else void listen(); })}
    {button("Repeat", () => say(lastMessage.current))}
    {stage !== "search" && button("Choose another destination", reset)}
    <Text style={styles.note}>Speech recognition may use Apple or Google services. SENSEA does not store recordings. Search goes to UW; route requests send your position and destination to Google.</Text>
    <Text style={styles.note}>Interaction records: {recording ? "on" : "off"}. Recognized words and button actions stay on this device (2,000 events maximum). Records older than 7 days are removed when the app is used. No camera video or GPS trail is saved.</Text>
    {button(recording ? "Turn off interaction records" : "Turn on interaction records", () => { void setRecording(!recording).then(() => setRecordingState(!recording)).catch(() => say("Could not save recording preference.")); })}
    {button("Check records", () => { void eventStatus().then(text => say(text)).catch(() => say("Records are unavailable.")); })}
    {button("Delete interaction records", () => { void clearEvents().then(() => { setMessage("Interaction records deleted."); announce("Interaction records deleted.", 3, "en-US", undefined, false); }).catch(() => say("Could not delete records. Please try again.")); })}
  </View>;
}
const styles = StyleSheet.create({
  container: { marginBottom: 24, gap: 10 },
  title: { color: "#F4F7FA", fontSize: 23, fontWeight: "700" },
  message: { color: "#FFFFFF", fontSize: 18, lineHeight: 26 },
  note: { color: "#AFC0D2", fontSize: 14, lineHeight: 21 },
  input: { color: "#FFFFFF", backgroundColor: "#1A2B40", borderRadius: 12, padding: 16, fontSize: 18, minHeight: 56 },
  button: { backgroundColor: "#1A2B40", borderRadius: 12, padding: 16, minHeight: 56, marginVertical: 3 },
  name: { color: "#67E3C8", fontSize: 18, fontWeight: "600" },
  google: { backgroundColor: "#112638", padding: 12, borderRadius: 12, gap: 10 },
  attribution: { color: "#FFFFFF", fontSize: 14, fontWeight: "400" },
});
