import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState, Linking, Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { NativePreviewView, useCameraDevice, useCameraPermission } from "react-native-vision-camera";
import * as Speech from "expo-speech";
import { createNativeSession } from "./src/vision/createNativeSession";
import { AnnouncementGate, describeResult, labelInKorean } from "./src/vision/detection.mjs";
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
  const [showNotices, setShowNotices] = useState(false);
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

  const say = useCallback((text: string, receivedAt: number) => {
    if (speechBusy.current || !wanted.current || !voiceEnabled.current) return;
    speechBusy.current = true;
    const generation = speechGeneration.current;
    void Speech.stop().then(() => {
      if (mounted.current && wanted.current && voiceEnabled.current &&
          generation === speechGeneration.current &&
          Date.now() - receivedAt >= 0 && Date.now() - receivedAt <= 1000) {
        Speech.speak(text, { language: "ko-KR", rate: 0.95 });
      }
    }).catch(() => {}).finally(() => { speechBusy.current = false; });
  }, []);

  const close = useCallback(() => {
    wanted.current = false;
    current.current?.pause();
    latest.current = null;
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
    if (!mounted.current || !wanted.current) return;
    latest.current = next;
    setResult(next);
    const text = announcement.current.offer(next, Date.now());
    if (text) say(text, next.receivedAt);
  }, [say]);

  const fail = useCallback((text: string) => {
    if (!mounted.current || !wanted.current) return;
    setMessage(text);
    close();
  }, [close]);

  const open = async () => {
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
      if (latest.current && Date.now() - latest.current.receivedAt > 1000) {
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
          <NativePreviewView
            style={StyleSheet.absoluteFill}
            previewOutput={session.preview}
            implementationMode="compatible"
            resizeMode="cover"
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderTitle}>주변을 듣는 카메라</Text>
            <Text style={styles.placeholderText}>사람·차량 등 주변 사물을 기기에서 살펴봅니다.</Text>
          </View>
        )}
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{live ? "● 분석 중" : busy ? "준비·정리 중" : "카메라 꺼짐"}</Text>
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
            : "아직 식별된 사물이 없습니다"}
        </Text>
        <Text style={styles.note}>영상은 저장하거나 서버로 전송하지 않습니다.</Text>
      </View>
      <Pressable
        style={[styles.primary, phase === "closing" && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel={live || phase === "opening" ? "카메라 끄기" : "카메라 켜고 분석 시작"}
        disabled={phase === "closing"}
        onPress={() => {
          if (live || phase === "opening") {
            setMessage("카메라를 켜면 주변 사물 분석을 시작합니다.");
            close();
          } else void open();
        }}
      >
        <Text style={styles.primaryText}>{live || phase === "opening" ? "카메라 끄기" : phase === "closing" ? "카메라 정리 중" : "카메라 켜기"}</Text>
      </Pressable>
      <View style={styles.controls}>
        <Pressable style={styles.secondary} accessibilityRole="switch"
          accessibilityLabel="자동 음성 안내" accessibilityState={{ checked: voice }}
          onPress={() => {
            const next = !voice;
            voiceEnabled.current = next;
            setVoice(next);
            announcement.current.reset();
            if (!next) silence();
          }}>
          <Text style={styles.secondaryText}>음성 안내 {voice ? "켜짐" : "꺼짐"}</Text>
        </Pressable>
        <Pressable style={styles.secondary} accessibilityRole="button"
          accessibilityLabel="현재 분석 결과 다시 듣기"
          accessibilityState={{ disabled: !live || !voice }}
          disabled={!live || !voice}
          onPress={() => {
            const latestResult = latest.current;
            if (latestResult) say(describeResult(latestResult), latestResult.receivedAt);
          }}>
          <Text style={styles.secondaryText}>다시 듣기</Text>
        </Pressable>
      </View>
      {!permission.hasPermission && !permission.canRequestPermission && (
        <Pressable style={styles.linkButton} accessibilityRole="button" onPress={() => void Linking.openSettings()}>
          <Text style={styles.linkText}>설정에서 카메라 권한 허용</Text>
        </Pressable>
      )}
      <Text style={styles.footer}>인식 결과는 이동·횡단의 안전을 판단하지 않습니다.</Text>
      <Pressable style={styles.linkButton} accessibilityRole="button" onPress={() => setShowNotices(true)}>
        <Text style={styles.linkText}>오픈소스 안내</Text>
      </Pressable>
      </ScrollView>
      <Modal visible={showNotices} onRequestClose={() => setShowNotices(false)} animationType="slide">
        <SafeAreaView style={styles.root}>
          <Pressable style={styles.primary} accessibilityRole="button" onPress={() => setShowNotices(false)}>
            <Text style={styles.primaryText}>안내 닫기</Text>
          </Pressable>
          <ScrollView>
            <Text style={styles.licenseTitle}>공개 모델 및 라이브러리</Text>
            <Text style={styles.licenseText}>{notices.text}</Text>
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
  controls: { flexDirection: "row", gap: 12 },
  secondary: { flex: 1, backgroundColor: "#1A2B40", borderRadius: 14, minHeight: 56, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: "#F4F7FA", fontSize: 17, fontWeight: "600" },
  footer: { color: "#ADC0D2", fontSize: 12, textAlign: "center", marginTop: 16 },
  linkButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  linkText: { color: "#86C7FC", fontSize: 14 },
  licenseTitle: { color: "#F4F7FA", fontSize: 24, marginVertical: 20 },
  licenseText: { color: "#D2DCEA", fontSize: 13, lineHeight: 20 },
});
