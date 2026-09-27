import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo, AppState, Linking, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View, Vibration,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { NativePreviewView, useCameraPermission } from "react-native-vision-camera";
import * as Speech from "expo-speech";
import { callback } from "react-native-nitro-modules";
import { createNativeSession } from "./src/vision/createNativeSession";
import { AnnouncementGate, describeResult, isFreshResult, displayLabel } from "./src/vision/detection.mjs";
import { CollisionHaptics, hasPriorityObstacle } from "./src/vision/collision-haptics.mjs";
import { HazardTracker, HazardAnnouncementGate } from "./src/vision/hazards.mjs";
import { HAZARD_COVERAGE, hazardLabel, describeScreenRelation, describeHazardKind } from "./src/vision/hazard-policy.mjs";
import { buildObjectOverlays } from "./src/vision/overlay.mjs";
import { UrbanVisionPanel } from "./src/vision/UrbanVisionPanel";
import urbanLabels from "./assets/models/urban-labels.json";
import { AnalysisBudget } from "./src/vision/analysis-budget.mjs";
import { automaticWarnings, isAutomaticSpeechTarget } from "./src/vision/automatic-speech.mjs";
import { englishSpeechOptions } from "./src/vision/english-speech.mjs";
import { LatestSpeechChannel } from "./src/vision/speech-channel.mjs";
import type { HazardAssessment, LiveResult, NativeSession, UrbanResult } from "./src/vision/types";
import notices from "./assets/third-party-notices.json";

type Phase = "closed" | "opening" | "live" | "closing";

function CameraScreen() {
  const permission = useCameraPermission();
  const [phase, setPhase] = useState<Phase>("closed");
  const [session, setSession] = useState<NativeSession | null>(null);
  const [result, setResult] = useState<LiveResult | null>(null);
  const [hazard, setHazard] = useState<HazardAssessment | null>(null);
  const [urban, setUrban] = useState<UrbanResult | null>(null);
  const [urbanEnabled, setUrbanEnabled] = useState(false);
  const analysisBudget = useRef(new AnalysisBudget());
  useEffect(() => { console.info(`[SENSEA] Expanded analysis budget: ${urbanEnabled ? "ready" : "waiting"}`); }, [urbanEnabled]);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [message, setMessage] = useState("Turn on the camera to see the live view.");
  const [voice, setVoice] = useState(true);
  const [haptics, setHaptics] = useState(true);
  const hapticsEnabled = useRef(true);
  const [analysisMessage, setAnalysisMessage] = useState("");
  const resumeAfterNotice = useRef(false);
  const startupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sheet, setSheet] = useState<"privacy" | "licenses" | null>(null);
  const [screenReader, setScreenReader] = useState<boolean | null>(null);
  const screenReaderEnabled = useRef(true);
  const screenReaderReady = useRef(false);
  const reviewedNotice = useRef(false);
  const sheetTitle = useRef<Text>(null);
  const cameraButton = useRef<View>(null);
  const privacyButton = useRef<View>(null);
  const licensesButton = useRef<View>(null);
  const sheetOrigin = useRef<"camera" | "privacy" | "licenses">("privacy");
  const mounted = useRef(true);
  const wanted = useRef(false);
  const opening = useRef(false);
  const requestingPermission = useRef(false);
  const closing = useRef<Promise<void> | null>(null);
  const current = useRef<NativeSession | null>(null);
  const latest = useRef<LiveResult | null>(null);
  const voiceEnabled = useRef(true);
  const announcement = useRef(new AnnouncementGate());
  const announcementRevision = useRef(0);
  const hazardTracker = useRef(new HazardTracker());
  const hazardAnnouncement = useRef(new HazardAnnouncementGate());
  const latestHazard = useRef<HazardAssessment | null>(null);
  const hazardSpeechRevision = useRef(0);
  const unavailableSpeech = useRef(false);
  const hapticChannel = useRef<CollisionHaptics | null>(null);
  if (!hapticChannel.current) {
    hapticChannel.current = new CollisionHaptics({
      vibrate: (pattern: number[], repeat: boolean) => Vibration.vibrate(pattern, repeat),
      cancel: () => Vibration.cancel(),
      isAllowed: () => mounted.current && wanted.current && hapticsEnabled.current && AppState.currentState === "active",
    });
  }
  const receiveUrban = useCallback((next: UrbanResult | null) => {
    if (!mounted.current || !wanted.current) { hapticChannel.current?.clear("urban"); return; }
    setUrban(next);
    if (!next) { hapticChannel.current?.clear("urban"); return; }
    hapticChannel.current?.offer("urban", next.receivedAt,
      next.quality === "usable" && hasPriorityObstacle(next.detections));
  }, []);
  const englishVoice = useRef<Speech.SpeechOptions>(englishSpeechOptions([], Platform.OS));
  useEffect(() => {
    let active = true;
    void Speech.getAvailableVoicesAsync().then(voices => {
      if (active) englishVoice.current = englishSpeechOptions(voices, Platform.OS);
    }).catch(() => { /* Keep the English language fallback if enumeration fails. */ });
    return () => { active = false; };
  }, []);
  const speech = useRef<LatestSpeechChannel | null>(null);
  if (!speech.current) {
    speech.current = new LatestSpeechChannel({
      stop: () => Speech.stop(),
      speak: (text: string) => {
        if (screenReaderEnabled.current) AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: false });
        else {
          const options = englishVoice.current;
          Speech.speak(text, { ...options, onError: () => {
            // Some engines list voices that they cannot actually synthesize.
            // Use the default English voice for the next fresh announcement;
            // never retry an old hazard after its frame has expired.
            if (options.voice && englishVoice.current.voice === options.voice) {
              englishVoice.current = englishSpeechOptions([], Platform.OS);
              console.warn("[SENSEA] English voice unavailable; using English language fallback");
            }
          } });
        }
      },
      isAllowed: (manual: boolean) => mounted.current && wanted.current &&
        screenReaderReady.current && (manual || voiceEnabled.current),
    });
  }
  const silence = useCallback(() => { speech.current?.cancel(); }, []);
  const resetAnnouncement = useCallback(() => {
    announcementRevision.current++;
    announcement.current.reset();
  }, []);
  const resetHazards = useCallback(() => {
    unavailableSpeech.current = false;
    hazardSpeechRevision.current++;
    hazardTracker.current.reset();
    hazardAnnouncement.current.reset();
    latestHazard.current = null;
    hapticChannel.current?.clear("base");
    if (mounted.current) setHazard(null);
  }, []);

  useEffect(() => {
    let subscribed = true;
    let changed = false;
    const update = (enabled: boolean) => {
      if (!subscribed) return;
      screenReaderEnabled.current = enabled;
      screenReaderReady.current = true;
      setScreenReader(enabled);
      resetAnnouncement();
      hazardAnnouncement.current.reset();
      silence();
    };
    const listener = AccessibilityInfo.addEventListener("screenReaderChanged", enabled => {
      changed = true;
      update(enabled);
    });
    void AccessibilityInfo.isScreenReaderEnabled().then(enabled => {
      if (!changed) update(enabled);
    }).catch(() => { if (!changed) update(true); });
    return () => { subscribed = false; listener.remove(); };
  }, [resetAnnouncement, silence]);

  const say = useCallback((text: string, receivedAt: number, manual = false, priority = false, onDropped?: () => void) => {
    return speech.current?.offer({ text, receivedAt, manual, priority, onDropped }) ?? false;
  }, []);

  const close = useCallback(() => {
    wanted.current = false;
    analysisBudget.current.reset();
    if (mounted.current) setUrbanEnabled(false);
    hapticChannel.current?.reset();
    resumeAfterNotice.current = false;
    if (startupTimer.current) clearTimeout(startupTimer.current);
    startupTimer.current = null;
    current.current?.pause();
    latest.current = null;
    resetAnnouncement();
    resetHazards();
    silence();
    if (mounted.current) { setResult(null); setUrban(null); setAnalysisMessage(""); setPhase("closing"); }
    if (opening.current) return;
    if (closing.current) return;
    const owned = current.current;
    current.current = null;
    closing.current = (async () => {
      try { await owned?.dispose(); }
      catch { if (mounted.current) setMessage("Could not release the camera. Please restart the app."); }
      finally {
        closing.current = null;
        if (mounted.current) { setSession(null); setPhase("closed"); }
      }
    })();
  }, [resetAnnouncement, resetHazards, silence]);

  const receive = useCallback((next: LiveResult) => {
    if (!mounted.current || !wanted.current || !isFreshResult(next, Date.now())) return;
    if (unavailableSpeech.current) {
      unavailableSpeech.current = false;
      silence();
    }
    if (latest.current && (latest.current.quality.status !== next.quality.status ||
        latest.current.quality.reason !== next.quality.reason)) {
      // A recovered camera cancels obsolete quality speech and rearms a later lapse.
      resetAnnouncement();
      silence();
    }
    setUrbanEnabled(analysisBudget.current.observe(next, Date.now()));
    const assessment = hazardTracker.current.update(next, Date.now());
    // Dispatch touch feedback immediately, independently of speech availability.
    hapticChannel.current?.offer("base", assessment.observedAt, hasPriorityObstacle(assessment.hazards));
    const previousWarning = automaticWarnings(latestHazard.current)[0];
    const nextWarning = automaticWarnings(assessment)[0];
    if (previousWarning && (!nextWarning || previousWarning.trackId !== nextWarning.trackId ||
        previousWarning.direction !== nextWarning.direction ||
        (previousWarning.level === "priority" && nextWarning.level !== "priority"))) silence();
    latest.current = next;
    latestHazard.current = assessment;
    setResult(next);
    setHazard(assessment);
    setAnalysisMessage("Analyzing objects");
    if (voiceEnabled.current && screenReaderReady.current) {
      const warning = hazardAnnouncement.current.offer(assessment, Date.now());
      if (warning) {
        // Warnings take precedence, including while a prior stop() is awaiting completion.
        const revision = ++hazardSpeechRevision.current;
        const retryIfUndelivered = () => {
          if (revision === hazardSpeechRevision.current && wanted.current && voiceEnabled.current)
            hazardAnnouncement.current.reset();
        };
        if (!say(warning, assessment.observedAt, false, true, retryIfUndelivered)) retryIfUndelivered();
      } else if (!assessment.hazards.some(isAutomaticSpeechTarget) &&
          (!screenReaderEnabled.current || next.quality.status !== "usable")) {
        // Screen readers still need dark/obscured-camera status; only ordinary
        // object lists are kept manual while TalkBack/VoiceOver is enabled.
        const text = announcement.current.offer(next, Date.now());
        if (text) {
          const revision = ++announcementRevision.current;
          const retryIfUndelivered = () => {
            if (revision === announcementRevision.current && wanted.current && voiceEnabled.current)
              resetAnnouncement();
          };
          if (!say(text, next.receivedAt, false, false, retryIfUndelivered)) retryIfUndelivered();
        }
      }
    }
  }, [resetAnnouncement, say, silence]);

  const fail = useCallback((text: string) => {
    if (!mounted.current || !wanted.current) return;
    setMessage(text);
    if (screenReaderEnabled.current) AccessibilityInfo.announceForAccessibility(text);
    close();
  }, [close]);

  const analysisFailed = useCallback((text: string) => {
    if (!mounted.current || !wanted.current) return;
    analysisBudget.current.suspend(Date.now());
    setUrbanEnabled(false);
    latest.current = null;
    setResult(null);
    setAnalysisMessage(text);
    resetHazards();
    silence();
    if (voiceEnabled.current && screenReaderReady.current) {
      unavailableSpeech.current = true;
      say(text, Date.now(), false, true);
    }
  }, [resetHazards, say, silence]);

  const previewDidStart = useCallback(() => {
    if (!mounted.current || !wanted.current || !current.current) return;
    if (startupTimer.current) clearTimeout(startupTimer.current);
    startupTimer.current = null;
    setPhase("live");
    setMessage("The live camera view is active.");
    void current.current.startAnalysis().catch(() => analysisFailed("Object analysis is unavailable. The camera view will stay on."));
  }, [analysisFailed]);
  const previewStartedCallback = useMemo(() => callback(previewDidStart), [previewDidStart]);

  const open = async () => {
    if (!reviewedNotice.current) {
      sheetOrigin.current = "camera";
      setSheet("privacy");
      return;
    }
    if (AppState.currentState === "background") {
      setMessage("Return to the app, then turn on the camera again.");
      return;
    }
    if (opening.current || closing.current || current.current) return;
    opening.current = true;
    wanted.current = true;
    hapticChannel.current?.reset();
    setPhase("opening");
    setMessage("Checking camera permission.");
    setAnalysisMessage("");
    resetAnnouncement();
    resetHazards();
    try {
      let granted = permission.hasPermission;
      if (!granted && permission.canRequestPermission) {
        requestingPermission.current = true;
        try { granted = await permission.requestPermission(); }
        finally { requestingPermission.current = false; }
      }
      if (!granted) {
        wanted.current = false;
        setMessage("Camera permission is required. Allow it in your phone settings.");
        return;
      }
      // Android permission dialogs can temporarily background the Activity.
      // Wait briefly for the granting dialog to close; never open in background.
      const waitUntil = Date.now() + 1500;
      while (AppState.currentState !== "active" && Date.now() < waitUntil && wanted.current) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!wanted.current || !mounted.current) return;
      if (AppState.currentState !== "active") {
        wanted.current = false;
        setMessage("Camera permission confirmed. Return to the app and turn it on again.");
        return;
      }
      setMessage("Connecting the live camera.");
      const created = await createNativeSession(receive, fail, analysisFailed);
      if (!mounted.current || !wanted.current) { await created.dispose(); return; }
      current.current = created;
      setSession(created);
      setAnalysisMessage("Object analysis will start once the camera view is ready.");
      startupTimer.current = setTimeout(() => {
        if (wanted.current && mounted.current) fail("No camera frames received. Check permission and whether another app is using the camera.");
      }, 12000);
    } catch {
      wanted.current = false;
      if (mounted.current) setMessage("Could not prepare the camera. Check permission, then try again.");
    } finally {
      opening.current = false;
      if (mounted.current && !wanted.current) setPhase("closed");
    }
  };

  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener("change", state => {
      // Permission dialogs can temporarily pause the Activity. Startup checks
      // active state again before accessing the camera after the dialog closes.
      if ((state === "background" || state === "inactive") && !requestingPermission.current) close();
    });
    // Latest result only. If the camera stalls, remove stale observations.
    const timer = setInterval(() => {
      hapticChannel.current?.tick();
      setUrbanEnabled(analysisBudget.current.tick(Date.now()));
      if (latest.current && !isFreshResult(latest.current, Date.now())) {
        latest.current = null;
        setResult(null);
        resetHazards();
        setAnalysisMessage("Waiting for a fresh analysis. Hazards cannot be assessed yet.");
        silence();
        // latest is cleared above, so this status is announced once per lapse.
        if (voiceEnabled.current && screenReaderReady.current) {
          unavailableSpeech.current = true;
          say("No fresh analysis is available to assess hazards.", Date.now(), false, true);
        }
      }
    }, 250);
    return () => {
      mounted.current = false;
      listener.remove();
      clearInterval(timer);
      close();
    };
  }, [close, resetHazards, say, silence]);

  useEffect(() => {
    if (session && wanted.current) {
      void session.start().catch(() => fail("Could not start the camera. Please try again."));
    }
  }, [session, fail]);
  const showSheet = (kind: "privacy" | "licenses") => {
    close();
    setMessage("Camera off. Current analysis results cleared.");
    sheetOrigin.current = kind;
    setSheet(kind);
  };
  const dismissSheet = () => {
    setSheet(null);
    requestAnimationFrame(() => {
      const origin = sheetOrigin.current === "camera" ? cameraButton :
        sheetOrigin.current === "privacy" ? privacyButton : licensesButton;
      if (resumeAfterNotice.current) {
        resumeAfterNotice.current = false;
        if (mounted.current) void open();
      } else if (origin.current) AccessibilityInfo.sendAccessibilityEvent(origin.current, "focus");
    });
  };
  const busy = phase === "opening" || phase === "closing";
  const live = phase === "live";
  const hasWarning = hazard?.status === "caution" || hazard?.status === "priority";
  const overlayBoxes = useMemo(() => buildObjectOverlays(result, hazard, urban, previewSize), [result, hazard, urban, previewSize]);
  const canAnnounceUrban = useCallback(() => wanted.current && screenReaderReady.current &&
    !(automaticWarnings(latestHazard.current).some(item => item.level === "priority") &&
      isFreshResult({ receivedAt: latestHazard.current?.observedAt }, Date.now())), []);
  const overlayName = (label: string) => urbanLabels.find(item => item.label === label)?.name ?? displayLabel(label);


  return (
    <SafeAreaView style={styles.root} accessibilityLanguage="en-US">
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.brand} accessibilityRole="header">SENSEA</Text>
        <Text style={styles.subtitle}>Explore nearby hazards</Text>
      </View>
      <View style={styles.preview} testID="camera-preview-area" collapsable={false}
        onLayout={({ nativeEvent: { layout } }) => setPreviewSize(previous =>
          previous.width === layout.width && previous.height === layout.height ? previous : { width: layout.width, height: layout.height })}>
        {session ? (
          <View style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <NativePreviewView
            style={StyleSheet.absoluteFill}
            previewOutput={session.preview}
            onPreviewStarted={previewStartedCallback}
            implementationMode="compatible"
            resizeMode="cover"
          />
          </View>
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderTitle}>Hear your surroundings</Text>
            <Text style={styles.placeholderText}>Detect people, vehicles and possible obstacles, with priority alerts for hazards.</Text>
          </View>
        )}
        <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {overlayBoxes.map(item => <View key={item.key} testID={`object-box-${item.key}`}
            style={[styles.objectBox, { left: item.left, top: item.top, width: item.width, height: item.height,
              borderColor: item.level === "priority" ? "#FF8D94" : item.level === "caution" ? "#FFCA80" : item.level === "notice" ? "#73E0AC" : item.level === "candidate" ? "#90C7FF" : "#E4EAF0" }]}>
            <Text numberOfLines={1} style={styles.objectBoxLabel}>
              {item.level === "priority" ? "High alert" : item.level === "caution" ? "Caution" : item.level === "notice" ? "Notice" : item.level === "candidate" ? "Candidate" : "Detected"} · {overlayName(item.label)}
            </Text>
          </View>)}
        </View>
        <View style={styles.badge}>
          <Text testID="camera-state" style={styles.badgeText} accessibilityLiveRegion="polite">{live ? "● Live camera on" : busy ? "Preparing camera" : "Camera off"}</Text>
        </View>
        <View style={styles.caption}>
          <Text style={styles.captionText}>{hazard?.hazards.length ? hazard.summary : result ? describeResult(result) : message}</Text>
        </View>
      </View>
      <View style={{ height: 16 }} />
      <Pressable
        ref={cameraButton}
        testID="camera-toggle"
        style={[styles.primary, phase === "closing" && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel={live || phase === "opening" ? "Turn off camera" : "Turn on camera and start analysis"}
        accessibilityState={{ disabled: phase === "closing", busy }}
        accessibilityHint="Turning off the camera stops analysis, speech and vibration, and clears current results."
        disabled={phase === "closing"}
        onPress={() => {
          if (live || phase === "opening") {
            setMessage("Camera off. Current analysis results cleared.");
            close();
          } else void open();
        }}
      >
        <Text style={styles.primaryText}>{live || phase === "opening" ? "Turn off camera" : phase === "closing" ? "Closing camera" : "Turn on camera"}</Text>
      </Pressable>
      {!!analysisMessage && <Text testID="analysis-state" style={styles.note}>{analysisMessage}</Text>}
      <View testID="hazard-panel" style={[styles.hazardPanel, hasWarning && styles.hazardWarning, hazard?.status === "priority" && styles.hazardPriority]}>
        <Text style={styles.sectionLabel}>Hazard alerts · Experimental</Text>
        <Text testID="hazard-level" style={styles.hazardLevel}>
          {hazard?.status === "priority" ? "High alert" : hazard?.status === "caution" ? "Hazard detected" : hazard?.status === "notice" ? "Nearby observations" :
            hazard?.status === "observing" ? "Observing" : "Unavailable"}
        </Text>
        <Text testID="hazard-summary" style={styles.hazardText}>
          {hazard?.summary ?? (live ? "No fresh analysis is available to assess hazards." : "Turn on the camera to check current frames for hazards.")}
        </Text>
        {!!hazard && <Text testID="hazard-guidance" style={styles.note}>{hazard.guidance}</Text>}
        {!!hazard?.hazards.length && <Text style={styles.note}>Repeated detections: {hazard.confirmedCount} · Alerts: {hazard.warningCount} · Showing: {hazard.hazards.length}</Text>}
        {hazard?.hazards.map(item => <View key={item.trackId} style={styles.hazardDetail}>
          <Text style={styles.hazardDetailTitle}>{hazardLabel(item.label)} · {item.level === "priority" ? "High alert" : item.level === "caution" ? "Caution" : "Notice"}</Text>
          <Text style={styles.note}>{describeHazardKind(item.kind)} · {describeScreenRelation(item.screenRelation)}</Text>
          <Text style={styles.note}>Actual distance and walking path are unknown.</Text>
        </View>)}
        <Text style={styles.note}>Positions and motion refer to the camera image. Distance, time to collision and whether a path is clear are not determined.</Text>
      </View>
      <View style={styles.summary}>
        <Text style={styles.sectionLabel}>Other detected objects</Text>
        <Text style={styles.objects}>
          {result?.detections.length
            ? [...new Set(result.detections.map(item => displayLabel(item.label)))].slice(0, 5).join(" · ")
            : "No objects identified. Objects may still be present."}
        </Text>
        <Text style={styles.note}>Camera images are not saved or sent to a server.</Text>
      </View>
      <Text style={styles.note} accessibilityLiveRegion="polite">{!live ? message : ""}</Text>
      <View style={styles.controls}>
        <Pressable testID="collision-haptics-toggle" style={styles.secondary} accessibilityRole="switch"
          accessibilityLabel="Nearby hazard vibration"
          accessibilityHint="Vibrates twice when repeated image cues suggest a nearby obstacle. Works even when automatic speech is off."
          accessibilityState={{ checked: haptics }}
          onPress={() => {
            const next = !hapticsEnabled.current;
            hapticsEnabled.current = next;
            setHaptics(next);
            hapticChannel.current?.reset();
          }}>
          <Text style={styles.secondaryText}>Nearby hazard vibration {haptics ? "On" : "Off"}</Text>
        </Pressable>
        <Text style={styles.note}>Two pulses alert you to repeatedly detected large central objects or obstacles low in the image. Alerts repeat at least 1.2 seconds apart while the cues remain. Actual distance is not measured.</Text>
        <Pressable style={styles.secondary} accessibilityRole="switch"
          accessibilityLabel="Automatic voice guidance"
          accessibilityHint="Prioritizes hazards other than people. People are still detected and can trigger nearby hazard vibration."
          accessibilityState={{ checked: voice, disabled: screenReader === null }}
          disabled={screenReader === null}
          onPress={() => {
            const next = !voice;
            voiceEnabled.current = next;
            setVoice(next);
            resetAnnouncement();
            hazardAnnouncement.current.reset();
            if (!next) silence();
          }}>
          <Text style={styles.secondaryText}>{screenReader === null ? "Checking voice settings" : `${screenReader ? "Screen reader alerts" : "Automatic speech"} ${voice ? "On" : "Off"}`}</Text>
        </Pressable>
        <Text style={styles.note}>People are detected and displayed without automatic speech. Nearby hazard vibration remains active. Replay includes people.</Text>
        <Pressable style={styles.secondary} accessibilityRole="button"
          accessibilityLabel="Replay current analysis"
          accessibilityState={{ disabled: !live }}
          disabled={!live}
          onPress={() => {
            const latestResult = latest.current;
            if (latestResult && isFreshResult(latestResult, Date.now())) {
              const warning = latestHazard.current;
              const text = warning?.hazards.length && isFreshResult({ receivedAt: warning.observedAt }, Date.now())
                ? warning.summary : describeResult(latestResult);
              say(text, latestResult.receivedAt, true, !!warning?.hazards.length);
            } else {
              setMessage("No fresh results. Please wait for the next frame analysis.");
              if (screenReaderEnabled.current) AccessibilityInfo.announceForAccessibility("No fresh results.");
            }
          }}>
          <Text style={styles.secondaryText}>Replay</Text>
        </Pressable>
      </View>
      {screenReader === true && <Text style={styles.note}>Hazard alerts use your screen reader. Use Replay to hear other detected objects.</Text>}
      <Pressable style={styles.linkButton} accessibilityRole="button"
        accessibilityLabel="Stop analysis and clear current results"
        onPress={() => {
          close();
          setMessage("Analysis, speech and vibration stopped. Current results cleared. No photos or videos were saved.");
        }}>
        <Text style={styles.linkText}>Stop analysis and clear results</Text>
      </Pressable>
      {!permission.hasPermission && !permission.canRequestPermission && (
        <Pressable style={styles.linkButton} accessibilityRole="button" onPress={() => void Linking.openSettings()}>
          <Text style={styles.linkText}>Allow camera access in settings</Text>
        </Pressable>
      )}
      <UrbanVisionPanel live={live} enabled={urbanEnabled} voice={voice} onResult={receiveUrban} say={say} canAnnounce={canAnnounceUrban} cancel={silence} />
      <View style={styles.coveragePanel}>
        <Text style={styles.sectionLabel}>Base detection coverage</Text>
        <Text style={styles.note}>Additional candidates appear in the street object and signal panel above. An undetected object may still be present.</Text>
        {HAZARD_COVERAGE.map(group => <View key={group.kind} style={styles.hazardDetail}>
          <Text style={styles.hazardDetailTitle}>{group.title}</Text>
          {!!group.supported && <Text style={styles.note}>Detects: {group.supported}</Text>}
          {!!group.unavailable && <Text style={styles.note}>Outside base model coverage: {group.unavailable}</Text>}
        </View>)}
      </View>
      <Text style={styles.footer}>Hazard alerts are experimental. They do not determine whether walking or crossing is safe.</Text>
      <Pressable ref={privacyButton} style={styles.linkButton} accessibilityRole="button" onPress={() => showSheet("privacy")}>
        <Text style={styles.linkText}>Privacy and usage</Text>
      </Pressable>
      <Pressable ref={licensesButton} style={styles.linkButton} accessibilityRole="button" onPress={() => showSheet("licenses")}>
        <Text style={styles.linkText}>Open-source notices</Text>
      </Pressable>
      </ScrollView>
      <Modal visible={sheet !== null} onRequestClose={dismissSheet} animationType="none"
        onShow={() => { if (sheetTitle.current) AccessibilityInfo.sendAccessibilityEvent(sheetTitle.current, "focus"); }}>
        <SafeAreaView style={styles.root} accessibilityLanguage="en-US" accessibilityViewIsModal onAccessibilityEscape={dismissSheet}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text ref={sheetTitle} accessible accessibilityRole="header" style={styles.licenseTitle}>
              {sheet === "privacy" ? "Privacy and usage" : "Public models and libraries"}
            </Text>
            {sheet === "privacy" ? <>
              <Text style={styles.privacyText}>Camera frames are analyzed on this phone. Photos, videos and analysis history are not saved to files or sent to a server. Only the additional public model files are stored on the device.</Text>
              <Text style={styles.privacyText}>Google ML Kit reads text and numbers on the device. Images and recognition results are processed locally; SDK performance and usage statistics may be sent to Google. See the ML Kit terms and privacy links in Open-source notices.</Text>
              <Text style={styles.privacyText}>The app does not collect microphone audio or GPS location. STOP scans use the phone orientation sensor without saving orientation history. Camera permission is requested when you turn on the camera and can be revoked in phone settings.</Text>
              <Text style={styles.privacyText}>Turning off the camera, clearing results, switching apps or opening this notice stops analysis, automatic speech and vibration. The camera does not restart automatically when you return.</Text>
              <Text style={styles.privacyText}>Alerts use repeated object positions and sizes in the image. Phone movement or recognition errors can cause false alerts or missed hazards. Actual distance, collision probability and crossing clearance are not calculated. The expanded model finds possible street objects, stairs, curbs and branches, but cannot determine height, depth or the actual walking path. Signal symbols and numbers may also be misread; the app never gives permission to cross.</Text>
              <Text style={styles.privacyText}>This is a camera prototype. GPS navigation and microphone noise measurement are not connected.</Text>
              <Text style={styles.privacyText}>Use the start button below to check permission and open the live camera. Sending photos to external AI services is not connected in this app.</Text>
            </> : <Text style={styles.licenseText}>{notices.text}</Text>}
          </ScrollView>
          {sheet === "privacy" && <Pressable testID="privacy-start" style={styles.primary} accessibilityRole="button"
            onPress={() => {
              reviewedNotice.current = true;
              resumeAfterNotice.current = sheetOrigin.current === "camera";
              dismissSheet();
            }}>
            <Text style={styles.primaryText}>{sheetOrigin.current === "camera" ? "Accept and start camera" : "Close notice"}</Text>
          </Pressable>}
          <Pressable testID="notice-close" style={styles.secondary} accessibilityRole="button" onPress={() => { resumeAfterNotice.current = false; dismissSheet(); }}>
            <Text style={styles.secondaryText}>{sheet === "privacy" ? "Close without starting camera" : "Close notice"}</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

export default function App() {
  return <SafeAreaProvider><CameraScreen /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A1220", padding: 20 },
  content: { flexGrow: 1 },
  header: { marginBottom: 18 },
  brand: { color: "#63DCC6", fontSize: 18, fontWeight: "800", letterSpacing: 3 },
  subtitle: { color: "#F4F7FA", fontSize: 28, fontWeight: "700", marginTop: 5 },
  preview: { height: 300, minHeight: 260, backgroundColor: "#162333", borderRadius: 24, overflow: "hidden" },
  placeholder: { flex: 1, justifyContent: "center", padding: 28 },
  placeholderTitle: { color: "#F4F7FA", fontSize: 24, fontWeight: "700", marginBottom: 12 },
  placeholderText: { color: "#B8C6D7", fontSize: 17, lineHeight: 26 },
  badge: { position: "absolute", top: 16, left: 16, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#0A1220DD" },
  badgeText: { color: "#7DE8CA", fontSize: 15, fontWeight: "600" },
  caption: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#06101CDB", padding: 20 },
  captionText: { color: "#FFFFFF", fontSize: 19, lineHeight: 28 },
  hazardPanel: { marginTop: 16, padding: 18, borderRadius: 16, backgroundColor: "#182638", borderWidth: 1, borderColor: "#456079" },
  hazardPriority: { backgroundColor: "#38202A", borderColor: "#FF8D94" },
  hazardDetail: { paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderTopColor: "#456079" },
  hazardDetailTitle: { color: "#F4F7FA", fontSize: 16, fontWeight: "700" },
  coveragePanel: { marginBottom: 18 },
  objectBox: { position: "absolute", borderWidth: 2, borderRadius: 4 },
  objectBoxLabel: { color: "#FFFFFF", backgroundColor: "#0A1220DD", fontSize: 12, padding: 3, alignSelf: "flex-start", maxWidth: "100%" },
  hazardWarning: { backgroundColor: "#342713", borderColor: "#FFCA80" },
  hazardLevel: { color: "#FFDAA2", fontSize: 22, fontWeight: "800", marginTop: 8 },
  hazardText: { color: "#FFFFFF", fontSize: 20, lineHeight: 30, marginTop: 8 },
  summary: { paddingVertical: 18 },
  sectionLabel: { color: "#99ADC4", fontSize: 14 },
  objects: { color: "#F4F7FA", fontSize: 19, marginTop: 6, fontWeight: "600" },
  note: { color: "#AFC0D2", fontSize: 13, marginTop: 10 },
  primary: { backgroundColor: "#67E3C8", borderRadius: 16, minHeight: 60, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  primaryText: { color: "#062D26", fontSize: 20, fontWeight: "800", textAlign: "center" },
  disabled: { opacity: 0.6 },
  controls: { gap: 12 },
  secondary: { backgroundColor: "#1A2B40", borderRadius: 14, minHeight: 56, paddingHorizontal: 16, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: "#F4F7FA", fontSize: 17, fontWeight: "600", textAlign: "center" },
  footer: { color: "#ADC0D2", fontSize: 12, textAlign: "center", marginTop: 16 },
  linkButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  linkText: { color: "#86C7FC", fontSize: 14 },
  licenseTitle: { color: "#F4F7FA", fontSize: 24, marginVertical: 20 },
  privacyText: { color: "#D2DCEA", fontSize: 18, lineHeight: 29, marginBottom: 20 },
  licenseText: { color: "#D2DCEA", fontSize: 13, lineHeight: 20 },
});
