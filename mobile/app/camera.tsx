import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { requestSceneDescription } from '@/src/api/client';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { colors } from '@/src/theme';
import { speak, stopSpeaking } from '@/src/voice/speak';

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [description, setDescription] = useState('휴대폰을 가슴 높이에서 정면을 향하도록 들어주세요.');
  const [isDescribing, setIsDescribing] = useState(false);

  useEffect(() => {
    void speak('카메라 주변 확인 화면입니다. 휴대폰을 가슴 높이에서 정면을 향하도록 들어주세요.');
    return () => {
      void stopSpeaking();
    };
  }, []);

  const describeScene = async () => {
    setIsDescribing(true);
    setDescription('주변 정보를 확인하고 있습니다.');
    const result = await requestSceneDescription();
    setDescription(result);
    setIsDescribing(false);
    void speak(result);
  };

  if (!permission) {
    return (
      <View style={styles.centered}>
        <Text accessibilityLiveRegion="polite" style={styles.message}>카메라 권한 상태를 확인하고 있습니다.</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text accessibilityRole="header" style={styles.title}>카메라 권한이 필요합니다</Text>
        <Text style={styles.message}>주변 설명을 요청할 때만 카메라를 사용합니다. 녹화하거나 백그라운드에서 실행하지 않습니다.</Text>
        <LargeActionButton
          label="카메라 권한 요청"
          accessibilityHint="기기의 카메라 권한 대화상자를 엽니다"
          onPress={() => void requestPermission()}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        facing="back"
        style={styles.camera}
      />
      <View style={styles.controls}>
        <Text accessibilityRole="header" style={styles.title}>주변 설명</Text>
        <Text accessibilityLiveRegion="assertive" style={styles.description}>{description}</Text>
        <LargeActionButton
          label="현재 장면 설명하기"
          accessibilityHint="현재는 데모 장면 설명을 음성으로 들려줍니다"
          onPress={() => void describeScene()}
          loading={isDescribing}
        />
        <Text style={styles.safety}>현재 버전은 카메라 프레임을 분석하지 않는 데모입니다. 설명만으로 장애물 회피나 횡단 여부를 판단하지 마세요.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: 24, gap: 20 },
  camera: { flex: 1, minHeight: 260 },
  controls: { backgroundColor: colors.background, padding: 20, gap: 16 },
  title: { color: colors.text, fontSize: 27, fontWeight: '800' },
  message: { color: colors.text, fontSize: 19, lineHeight: 29 },
  description: { color: colors.text, fontSize: 20, lineHeight: 30, minHeight: 60 },
  safety: { color: colors.warning, fontSize: 15, lineHeight: 23 },
});

