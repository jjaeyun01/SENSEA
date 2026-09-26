import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo, AppState, Linking, Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { NativePreviewView, useCameraDevice, useCameraPermission } from "react-native-vision-camera";
import * as Speech from "expo-speech";
import { createNativeSession } from "./src/vision/createNativeSession";
import { AnnouncementGate, describeResult, isFreshResult, labelInKorean } from "./src/vision/detection.mjs";
import type { LiveResult, NativeSession } from "./src/vision/types";
import notices from "./assets/third-party-notices.json";

type Phase = "closed" | "opening" | "live" | "closing";

function CameraScreen() {
  const permission = useCameraPermission();
  const device = useCameraDevice("back");
  const [phase, setPhase] = useState<Phase>("closed");
  const [session, setSession] = useState<NativeSession | null>(null);
  const [result, setResult] = useState<LiveResult | null>(null);
  const [message, setMessage] = useState("카메라를 켜면 주변 사물 분석을 시작합니다.");
  const [voice, setVoice] = useState(true);
  const [sheet, setSheet] = useState<"privacy" | "licenses" | null>(null);
  const [screenReader, setScreenReader] = useState<boolean | null>(null);
  const screenReaderEnabled = useRef(true);
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
  const speechBusy = useRef(false);
  const speechGeneration = useRef(0);
  const announcement = useRef(new AnnouncementGate());

  const silence = useCallback(() => {
    speechGeneration.current++;
    void Speech.stop().catch(() => {});
  }, []);

  useEffect(() => {
    let subscribed = true;
    let changed = false;
    const update = (enabled: boolean) => {
      if (!subscribed) return;
      screenReaderEnabled.current = enabled;
      setScreenReader(enabled);
      announcement.current.reset();
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
  }, [silence]);

  const say = useCallback((text: string, receivedAt: number, manual = false) => {
    if (speechBusy.current || !wanted.current ||
        (!manual && (!voiceEnabled.current || screenReaderEnabled.current))) return;
    speechBusy.current = true;
    const generation = speechGeneration.current;
    void Speech.stop().then(() => {
      if (mounted.current && wanted.current &&
          (manual || (voiceEnabled.current && !screenReaderEnabled.current)) &&
          generation === speechGeneration.current && isFreshResult({ receivedAt }, Date.now())) {
        if (screenReaderEnabled.current) {
          AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: false });
        } else {
          Speech.speak(text, { language: "ko-KR", rate: 0.95 });
        }
      }
    }).catch(() => {}).finally(() => { speechBusy.current = false; });
  }, []);

  const close = useCallback(() => {
    wanted.current = false;
    current.current?.pause();
    latest.current = null;
    announcement.current.reset();
    silence();
    if (mounted.current) { setResult(null); setPhase("closing"); }
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
  }, [silence]);

  const receive = useCallback((next: LiveResult) => {
    if (!mounted.current || !wanted.current || !isFreshResult(next, Date.now())) return;
    latest.current = next;
    setResult(next);
    const text = announcement.current.offer(next, Date.now());
    if (text && !screenReaderEnabled.current) say(text, next.receivedAt);
  }, [say]);

  const fail = useCallback((text: string) => {
    if (!mounted.current || !wanted.current) return;
    setMessage(text);
    if (screenReaderEnabled.current) AccessibilityInfo.announceForAccessibility(text);
    close();
  }, [close]);

  const open = async () => {
    if (!reviewedNotice.current) {
      sheetOrigin.current = "camera";
      setSheet("privacy");
      return;
    }
    if (AppState.currentState !== "active") return;
    if (opening.current || closing.current || current.current) return;
    if (!device) { setMessage("사용할 수 있는 후면 카메라를 찾지 못했습니다."); return; }
    opening.current = true;
    wanted.current = true;
    setPhase("opening");
    setMessage("카메라와 사물 인식 모델을 준비하고 있습니다.");
    announcement.current.reset();
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
      if (!wanted.current || !mounted.current) return;
      const created = await createNativeSession(receive, fail);
      if (!mounted.current || !wanted.current) { await created.dispose(); return; }
      current.current = created;
      setSession(created);
      setPhase("live");
      setMessage("새 영상을 기다리고 있습니다.");
    } catch {
      wanted.current = false;
      if (mounted.current) setMessage("분석을 시작하지 못했습니다. 카메라를 다시 열어 주세요.");
    } finally {
      opening.current = false;
      if (mounted.current && !wanted.current) setPhase("closed");
    }
  };

  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener("change", state => {
      // iOS permission sheets briefly make the app inactive. A real background
      // transition still cancels opening, including during permission requests.
      if (state === "background" || (state === "inactive" && !requestingPermission.current)) close();
    });
    // Latest result only. If the camera stalls, remove stale observations.
    const timer = setInterval(() => {
      if (latest.current && !isFreshResult(latest.current, Date.now())) {
        latest.current = null;
        setResult(null);
        setMessage("새 영상을 기다리고 있습니다.");
        silence();
      }
    }, 250);
    return () => {
      mounted.current = false;
      listener.remove();
      clearInterval(timer);
      close();
    };
  }, [close, silence]);

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
      if (origin.current) AccessibilityInfo.sendAccessibilityEvent(origin.current, "focus");
    });
  };
  const busy = phase === "opening" || phase === "closing";
  const live = phase === "live";

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.brand} accessibilityRole="header">SENSEA</Text>
        <Text style={styles.subtitle}>주변 살펴보기</Text>
      </View>
      <View style={styles.preview}>
        {session && device ? (
          <View style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <NativePreviewView
            style={StyleSheet.absoluteFill}
            previewOutput={session.preview}
            implementationMode="compatible"
            resizeMode="cover"
          />
          </View>
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderTitle}>주변을 듣는 카메라</Text>
            <Text style={styles.placeholderText}>사람·차량 등 주변 사물을 기기에서 살펴봅니다.</Text>
          </View>
        )}
        <View style={styles.badge}>
          <Text style={styles.badgeText} accessibilityLiveRegion="polite">{live ? "● 분석 중" : busy ? "준비·정리 중" : "카메라 꺼짐"}</Text>
        </View>
        <View style={styles.caption}>
          <Text style={styles.captionText}>{result ? describeResult(result) : message}</Text>
        </View>
      </View>
      <View style={styles.summary}>
        <Text style={styles.sectionLabel}>현재 보이는 사물</Text>
        <Text style={styles.objects}>
          {result?.detections.length
            ? [...new Set(result.detections.map(item => labelInKorean(item.label)))].join(" · ")
            : "사물을 식별하지 못했습니다. 주변에 사물이 없다는 뜻은 아닙니다."}
        </Text>
        <Text style={styles.note}>영상은 저장하거나 서버로 전송하지 않습니다.</Text>
      </View>
      <Text style={styles.note} accessibilityLiveRegion="polite">{!live ? message : ""}</Text>
      <Pressable
        ref={cameraButton}
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
      <View style={styles.controls}>
        <Pressable style={styles.secondary} accessibilityRole="switch"
          accessibilityLabel="자동 음성 안내"
          accessibilityHint="화면 읽기 기능을 사용 중이면 다시 듣기 버튼으로 결과를 확인합니다."
          accessibilityState={{ checked: voice && screenReader === false, disabled: screenReader !== false }}
          disabled={screenReader !== false}
          onPress={() => {
            const next = !voice;
            voiceEnabled.current = next;
            setVoice(next);
            announcement.current.reset();
            if (!next) silence();
          }}>
          <Text style={styles.secondaryText}>{screenReader === false ? `자동 음성 ${voice ? "켜짐" : "꺼짐"}` : "화면 읽기 사용"}</Text>
        </Pressable>
        <Pressable style={styles.secondary} accessibilityRole="button"
          accessibilityLabel="현재 분석 결과 다시 듣기"
          accessibilityState={{ disabled: !live }}
          disabled={!live}
          onPress={() => {
            const latestResult = latest.current;
            if (latestResult && isFreshResult(latestResult, Date.now())) {
              say(describeResult(latestResult), latestResult.receivedAt, true);
            } else {
              setMessage("최신 결과가 없습니다. 새 영상 분석을 기다려 주세요.");
              if (screenReaderEnabled.current) AccessibilityInfo.announceForAccessibility("최신 결과가 없습니다.");
            }
          }}>
          <Text style={styles.secondaryText}>다시 듣기</Text>
        </Pressable>
      </View>
      {screenReader !== false && <Text style={styles.note}>화면 읽기와 겹치지 않도록 자동 음성은 쉬고 있습니다. 다시 듣기로 결과를 확인하세요.</Text>}
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
      <Text style={styles.footer}>인식 결과는 이동·횡단의 안전을 판단하지 않습니다.</Text>
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
              <Text style={styles.privacyText}>인식이 틀리거나 사물을 놓칠 수 있습니다. 사물을 찾지 못해도 길이 비어 있다는 뜻은 아닙니다. 거리·충돌 위험·횡단 가능 여부는 판단하지 않습니다.</Text>
              <Text style={styles.privacyText}>현재는 카메라 시험판입니다. 실제 GPS 길안내와 마이크 소음 측정은 연결하지 않았습니다.</Text>
              <Text style={styles.privacyText}>이 안내를 닫고 카메라 켜기를 눌러 시작하세요. 외부 AI 사진 전송은 현재 앱에 연결되어 있지 않습니다.</Text>
              <Pressable style={styles.primary} accessibilityRole="button" onPress={() => { reviewedNotice.current = true; dismissSheet(); }}>
                <Text style={styles.primaryText}>안내 확인·닫기</Text>
              </Pressable>
            </> : <Text style={styles.licenseText}>{notices.text}</Text>}
            <Pressable style={styles.secondary} accessibilityRole="button" onPress={dismissSheet}>
              <Text style={styles.secondaryText}>{sheet === "privacy" ? "카메라를 켜지 않고 닫기" : "안내 닫기"}</Text>
            </Pressable>
          </ScrollView>
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
  preview: { flex: 1, minHeight: 170, backgroundColor: "#162333", borderRadius: 24, overflow: "hidden" },
  placeholder: { flex: 1, justifyContent: "center", padding: 28 },
  placeholderTitle: { color: "#F4F7FA", fontSize: 24, fontWeight: "700", marginBottom: 12 },
  placeholderText: { color: "#B8C6D7", fontSize: 17, lineHeight: 26 },
  badge: { position: "absolute", top: 16, left: 16, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#0A1220DD" },
  badgeText: { color: "#7DE8CA", fontSize: 15, fontWeight: "600" },
  caption: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#06101CDB", padding: 20 },
  captionText: { color: "#FFFFFF", fontSize: 19, lineHeight: 28 },
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
