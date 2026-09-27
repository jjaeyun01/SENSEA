import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo, AppState, Linking, Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { NativePreviewView, useCameraPermission } from "react-native-vision-camera";
import * as Speech from "expo-speech";
import { callback } from "react-native-nitro-modules";
import { createNativeSession } from "./src/vision/createNativeSession";
import { AnnouncementGate, describeResult, isFreshResult, labelInKorean } from "./src/vision/detection.mjs";
import { HazardTracker, HazardAnnouncementGate } from "./src/vision/hazards.mjs";
import { HAZARD_COVERAGE, hazardLabel, describeScreenRelation, describeHazardKind } from "./src/vision/hazard-policy.mjs";
import { projectBoxToPreview } from "./src/vision/preview-geometry.mjs";
import { LatestSpeechChannel } from "./src/vision/speech-channel.mjs";
import type { HazardAssessment, LiveResult, NativeSession } from "./src/vision/types";
import notices from "./assets/third-party-notices.json";

type Phase = "closed" | "opening" | "live" | "closing";

function CameraScreen() {
  const permission = useCameraPermission();
  const [phase, setPhase] = useState<Phase>("closed");
  const [session, setSession] = useState<NativeSession | null>(null);
  const [result, setResult] = useState<LiveResult | null>(null);
  const [hazard, setHazard] = useState<HazardAssessment | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [message, setMessage] = useState("카메라를 켜면 실시간 화면을 먼저 표시합니다.");
  const [voice, setVoice] = useState(true);
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
  const speech = useRef<LatestSpeechChannel | null>(null);
  if (!speech.current) {
    speech.current = new LatestSpeechChannel({
      stop: () => Speech.stop(),
      speak: (text: string) => {
        if (screenReaderEnabled.current) AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: false });
        else Speech.speak(text, { language: "ko-KR", rate: 0.95 });
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
    resumeAfterNotice.current = false;
    if (startupTimer.current) clearTimeout(startupTimer.current);
    startupTimer.current = null;
    current.current?.pause();
    latest.current = null;
    resetAnnouncement();
    resetHazards();
    silence();
    if (mounted.current) { setResult(null); setAnalysisMessage(""); setPhase("closing"); }
    if (opening.current) return;
    if (closing.current) return;
    const owned = current.current;
    current.current = null;
    closing.current = (async () => {
      try { await owned?.dispose(); }
      catch { if (mounted.current) setMessage("카메라 정리에 실패했습니다. 앱을 다시 실행해 주세요."); }
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
    const assessment = hazardTracker.current.update(next, Date.now());
    const previousWarning = latestHazard.current?.hazards.find(item => item.level !== "notice");
    const nextWarning = assessment.hazards.find(item => item.level !== "notice");
    if (previousWarning && (!nextWarning || previousWarning.trackId !== nextWarning.trackId ||
        previousWarning.direction !== nextWarning.direction ||
        (previousWarning.level === "priority" && nextWarning.level !== "priority"))) silence();
    latest.current = next;
    latestHazard.current = assessment;
    setResult(next);
    setHazard(assessment);
    setAnalysisMessage("사물 분석 중");
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
      } else if (assessment.hazards.length === 0 &&
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
    setMessage("실시간 카메라 화면이 표시되고 있습니다.");
    void current.current.startAnalysis().catch(() => analysisFailed("사물 분석을 사용할 수 없습니다. 카메라 화면은 계속 표시합니다."));
  }, [analysisFailed]);
  const previewStartedCallback = useMemo(() => callback(previewDidStart), [previewDidStart]);

  const open = async () => {
    if (!reviewedNotice.current) {
      sheetOrigin.current = "camera";
      setSheet("privacy");
      return;
    }
    if (AppState.currentState === "background") {
      setMessage("앱 화면으로 돌아온 뒤 카메라를 다시 켜 주세요.");
      return;
    }
    if (opening.current || closing.current || current.current) return;
    opening.current = true;
    wanted.current = true;
    setPhase("opening");
    setMessage("카메라 권한을 확인하고 있습니다.");
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
        setMessage("카메라 권한이 필요합니다. 휴대폰 설정에서 허용해 주세요.");
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
        setMessage("카메라 권한을 확인했습니다. 앱으로 돌아와 다시 켜 주세요.");
        return;
      }
      setMessage("실시간 카메라를 연결하고 있습니다.");
      const created = await createNativeSession(receive, fail, analysisFailed);
      if (!mounted.current || !wanted.current) { await created.dispose(); return; }
      current.current = created;
      setSession(created);
      setAnalysisMessage("카메라 화면이 표시되면 사물 분석을 준비합니다.");
      startupTimer.current = setTimeout(() => {
        if (wanted.current && mounted.current) fail("카메라 영상을 받지 못했습니다. 카메라 권한과 다른 앱의 사용 여부를 확인해 주세요.");
      }, 12000);
    } catch {
      wanted.current = false;
      if (mounted.current) setMessage("카메라를 준비하지 못했습니다. 카메라 권한을 확인한 뒤 다시 켜 주세요.");
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
      if (latest.current && !isFreshResult(latest.current, Date.now())) {
        latest.current = null;
        setResult(null);
        resetHazards();
        setAnalysisMessage("새 분석 결과를 기다리고 있습니다. 주의 대상을 확인할 수 없습니다.");
        silence();
        // latest is cleared above, so this status is announced once per lapse.
        if (voiceEnabled.current && screenReaderReady.current) {
          unavailableSpeech.current = true;
          say("최신 분석이 없어 주의 대상을 확인할 수 없습니다.", Date.now(), false, true);
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
      void session.start().catch(() => fail("카메라를 시작하지 못했습니다. 다시 열어 주세요."));
    }
  }, [session, fail]);
  const showSheet = (kind: "privacy" | "licenses") => {
    close();
    setMessage("카메라를 끄고 현재 분석 결과를 지웠습니다.");
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
  const overlayBoxes = useMemo(() => {
    const boxes: Array<{ trackId: number; label: string; level: string; left: number; top: number; width: number; height: number }> = [];
    if (!result?.imageSize || !hazard) return boxes;
    for (const item of hazard.hazards) {
      const projected = projectBoxToPreview(item.box, result.imageSize, previewSize);
      if (projected) boxes.push({ ...projected, trackId: item.trackId, label: hazardLabel(item.label), level: item.level });
    }
    return boxes;
  }, [hazard, result, previewSize]);


  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.brand} accessibilityRole="header">SENSEA</Text>
        <Text style={styles.subtitle}>주변 위험 요소 살펴보기</Text>
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
            <Text style={styles.placeholderTitle}>주변을 듣는 카메라</Text>
            <Text style={styles.placeholderText}>사람·차량·장애물 후보를 살펴보고 주의 대상을 먼저 알려드립니다.</Text>
          </View>
        )}
        <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {overlayBoxes.map(item => <View key={item.trackId} testID={`hazard-box-${item.trackId}`}
            style={[styles.objectBox, { left: item.left, top: item.top, width: item.width, height: item.height,
              borderColor: item.level === "priority" ? "#FF8D94" : item.level === "caution" ? "#FFCA80" : "#90C7FF" }]}>
            <Text numberOfLines={1} style={styles.objectBoxLabel}>
              {item.level === "priority" ? "우선 주의" : item.level === "caution" ? "주의" : "참고"} · {item.label}
            </Text>
          </View>)}
        </View>
        <View style={styles.badge}>
          <Text testID="camera-state" style={styles.badgeText} accessibilityLiveRegion="polite">{live ? "● 실시간 카메라 켜짐" : busy ? "카메라 준비·정리 중" : "카메라 꺼짐"}</Text>
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
        accessibilityLabel={live || phase === "opening" ? "카메라 끄기" : "카메라 켜고 분석 시작"}
        accessibilityState={{ disabled: phase === "closing", busy }}
        accessibilityHint="카메라를 끄면 분석과 음성을 중지하고 현재 결과를 지웁니다."
        disabled={phase === "closing"}
        onPress={() => {
          if (live || phase === "opening") {
            setMessage("카메라를 끄고 현재 분석 결과를 지웠습니다.");
            close();
          } else void open();
        }}
      >
        <Text style={styles.primaryText}>{live || phase === "opening" ? "카메라 끄기" : phase === "closing" ? "카메라 정리 중" : "카메라 켜기"}</Text>
      </Pressable>
      {!!analysisMessage && <Text testID="analysis-state" style={styles.note}>{analysisMessage}</Text>}
      <View testID="hazard-panel" style={[styles.hazardPanel, hasWarning && styles.hazardWarning, hazard?.status === "priority" && styles.hazardPriority]}>
        <Text style={styles.sectionLabel}>주의 대상 · 시험 기능</Text>
        <Text testID="hazard-level" style={styles.hazardLevel}>
          {hazard?.status === "priority" ? "우선 주의" : hazard?.status === "caution" ? "주의 대상 감지" : hazard?.status === "notice" ? "주변 참고" :
            hazard?.status === "observing" ? "연속 관찰 중" : "확인할 수 없음"}
        </Text>
        <Text testID="hazard-summary" style={styles.hazardText}>
          {hazard?.summary ?? (live ? "최신 분석이 없어 주의 대상을 확인할 수 없습니다." : "카메라를 켜면 최신 영상에서 주의 대상을 살펴봅니다.")}
        </Text>
        {!!hazard && <Text testID="hazard-guidance" style={styles.note}>{hazard.guidance}</Text>}
        {!!hazard?.hazards.length && <Text style={styles.note}>반복 관찰 {hazard.confirmedCount}개 · 주의 대상 {hazard.warningCount}개 · 주요 {hazard.hazards.length}개 표시</Text>}
        {hazard?.hazards.map(item => <View key={item.trackId} style={styles.hazardDetail}>
          <Text style={styles.hazardDetailTitle}>{hazardLabel(item.label)} · {item.level === "priority" ? "우선 주의" : item.level === "caution" ? "주의" : "참고"}</Text>
          <Text style={styles.note}>{describeHazardKind(item.kind)} · {describeScreenRelation(item.screenRelation)}</Text>
          <Text style={styles.note}>실제 거리 미확인 · 실제 진행 경로 미확인</Text>
        </View>)}
        <Text style={styles.note}>위치와 움직임은 카메라 화면 기준입니다. 거리·충돌 시간·통행 가능 여부를 판단하지 않습니다.</Text>
      </View>
      <View style={styles.summary}>
        <Text style={styles.sectionLabel}>함께 보이는 사물</Text>
        <Text style={styles.objects}>
          {result?.detections.length
            ? [...new Set(result.detections.map(item => labelInKorean(item.label)))].slice(0, 5).join(" · ")
            : "사물을 식별하지 못했습니다. 주변에 사물이 없다는 뜻은 아닙니다."}
        </Text>
        <Text style={styles.note}>영상은 저장하거나 서버로 전송하지 않습니다.</Text>
      </View>
      <Text style={styles.note} accessibilityLiveRegion="polite">{!live ? message : ""}</Text>
      <View style={styles.controls}>
        <Pressable style={styles.secondary} accessibilityRole="switch"
          accessibilityLabel="자동 음성 안내"
          accessibilityHint="주의 알림을 먼저 전달합니다. 화면 읽기 기능 사용 시 해당 기능으로 주의 알림을 전달합니다."
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
          <Text style={styles.secondaryText}>{screenReader === null ? "음성 설정 확인 중" : `${screenReader ? "화면 읽기 주의 알림" : "자동 음성"} ${voice ? "켜짐" : "꺼짐"}`}</Text>
        </Pressable>
        <Pressable style={styles.secondary} accessibilityRole="button"
          accessibilityLabel="현재 분석 결과 다시 듣기"
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
              setMessage("최신 결과가 없습니다. 새 영상 분석을 기다려 주세요.");
              if (screenReaderEnabled.current) AccessibilityInfo.announceForAccessibility("최신 결과가 없습니다.");
            }
          }}>
          <Text style={styles.secondaryText}>다시 듣기</Text>
        </Pressable>
      </View>
      {screenReader === true && <Text style={styles.note}>주의 알림은 화면 읽기 기능으로 전달합니다. 일반 사물 설명은 다시 듣기로 확인하세요.</Text>}
      <Pressable style={styles.linkButton} accessibilityRole="button"
        accessibilityLabel="분석 종료하고 현재 결과 지우기"
        onPress={() => {
          close();
          setMessage("분석과 음성을 중지하고 현재 결과를 지웠습니다. 저장된 사진이나 영상은 없습니다.");
        }}>
        <Text style={styles.linkText}>분석 종료·현재 결과 지우기</Text>
      </Pressable>
      {!permission.hasPermission && !permission.canRequestPermission && (
        <Pressable style={styles.linkButton} accessibilityRole="button" onPress={() => void Linking.openSettings()}>
          <Text style={styles.linkText}>설정에서 카메라 권한 허용</Text>
        </Pressable>
      )}
      <View style={styles.coveragePanel}>
        <Text style={styles.sectionLabel}>감지 범위</Text>
        <Text style={styles.note}>아래의 ‘구분 못함’은 주변에 없다는 뜻이 아닙니다.</Text>
        {HAZARD_COVERAGE.map(group => <View key={group.kind} style={styles.hazardDetail}>
          <Text style={styles.hazardDetailTitle}>{group.title}</Text>
          {!!group.supported && <Text style={styles.note}>감지 대상: {group.supported}</Text>}
          {!!group.unavailable && <Text style={styles.note}>아직 구분 못함: {group.unavailable}</Text>}
        </View>)}
      </View>
      <Text style={styles.footer}>주의 알림은 실험 기능입니다. 이동·횡단의 안전을 판단하지 않습니다.</Text>
      <Pressable ref={privacyButton} style={styles.linkButton} accessibilityRole="button" onPress={() => showSheet("privacy")}>
        <Text style={styles.linkText}>개인정보와 이용 안내</Text>
      </Pressable>
      <Pressable ref={licensesButton} style={styles.linkButton} accessibilityRole="button" onPress={() => showSheet("licenses")}>
        <Text style={styles.linkText}>오픈소스 안내</Text>
      </Pressable>
      </ScrollView>
      <Modal visible={sheet !== null} onRequestClose={dismissSheet} animationType="none"
        onShow={() => { if (sheetTitle.current) AccessibilityInfo.sendAccessibilityEvent(sheetTitle.current, "focus"); }}>
        <SafeAreaView style={styles.root} accessibilityViewIsModal onAccessibilityEscape={dismissSheet}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text ref={sheetTitle} accessible accessibilityRole="header" style={styles.licenseTitle}>
              {sheet === "privacy" ? "개인정보와 이용 안내" : "공개 모델 및 라이브러리"}
            </Text>
            {sheet === "privacy" ? <>
              <Text style={styles.privacyText}>카메라 영상은 이 휴대폰에서 분석합니다. 사진·영상·분석 기록을 파일로 저장하거나 서버로 보내지 않습니다.</Text>
              <Text style={styles.privacyText}>현재 앱은 마이크와 위치를 수집하지 않습니다. 카메라 권한은 카메라를 켤 때 요청하며 휴대폰 설정에서 언제든 취소할 수 있습니다.</Text>
              <Text style={styles.privacyText}>카메라 끄기, 결과 지우기, 다른 앱으로 전환하기, 이 안내 열기로 분석과 자동 음성을 중지합니다. 돌아와도 카메라는 자동으로 켜지지 않습니다.</Text>
              <Text style={styles.privacyText}>연속된 객체 위치와 화면상 크기로 주의 대상을 고릅니다. 휴대폰 움직임이나 오인식으로 잘못 알리거나 위험을 놓칠 수 있습니다. 실제 거리·충돌 확률·횡단 가능 여부는 계산하지 않습니다. 계단·낭떠러지·노면 구멍·차도와 인도 구분은 지원하지 않습니다.</Text>
              <Text style={styles.privacyText}>현재는 카메라 시험판입니다. 실제 GPS 길안내와 마이크 소음 측정은 연결하지 않았습니다.</Text>
              <Text style={styles.privacyText}>아래 시작 버튼을 누르면 권한을 확인한 뒤 실시간 카메라 화면을 표시합니다. 외부 AI 사진 전송은 현재 앱에 연결되어 있지 않습니다.</Text>
            </> : <Text style={styles.licenseText}>{notices.text}</Text>}
          </ScrollView>
          {sheet === "privacy" && <Pressable testID="privacy-start" style={styles.primary} accessibilityRole="button"
            onPress={() => {
              reviewedNotice.current = true;
              resumeAfterNotice.current = sheetOrigin.current === "camera";
              dismissSheet();
            }}>
            <Text style={styles.primaryText}>{sheetOrigin.current === "camera" ? "확인하고 카메라 시작" : "안내 확인·닫기"}</Text>
          </Pressable>}
          <Pressable testID="notice-close" style={styles.secondary} accessibilityRole="button" onPress={() => { resumeAfterNotice.current = false; dismissSheet(); }}>
            <Text style={styles.secondaryText}>{sheet === "privacy" ? "카메라를 켜지 않고 닫기" : "안내 닫기"}</Text>
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
  primary: { backgroundColor: "#67E3C8", borderRadius: 16, minHeight: 60, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  primaryText: { color: "#062D26", fontSize: 20, fontWeight: "800" },
  disabled: { opacity: 0.6 },
  controls: { gap: 12 },
  secondary: { backgroundColor: "#1A2B40", borderRadius: 14, minHeight: 56, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: "#F4F7FA", fontSize: 17, fontWeight: "600" },
  footer: { color: "#ADC0D2", fontSize: 12, textAlign: "center", marginTop: 16 },
  linkButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  linkText: { color: "#86C7FC", fontSize: 14 },
  licenseTitle: { color: "#F4F7FA", fontSize: 24, marginVertical: 20 },
  privacyText: { color: "#D2DCEA", fontSize: 18, lineHeight: 29, marginBottom: 20 },
  licenseText: { color: "#D2DCEA", fontSize: 13, lineHeight: 20 },
});
