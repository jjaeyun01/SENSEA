# SENSEA 모바일 안내와 카메라

현재 앱은 **fr2 디자인의 Expo Router 화면**을 사용합니다. `JourneyProvider`가 목적지·경로·음성·GPS 상태를, `CameraProvider`가 단일 카메라 세션을 공유합니다. 홈의 Demo destination data를 켜면 fr1/fr_num2의 3개 경로 시뮬레이션을 서버 없이 확인할 수 있습니다. [통합 내역](../docs/branch-integration.md)을 참고하세요.

Android와 iPhone에서 후면 카메라 → 로컬 품질 검사 → EfficientDet Lite0 객체 탐지 → 한국어 음성 안내를 연결한 Expo/React Native 앱입니다. 카메라를 켜면 분석을 시작하고, 끄거나 앱이 백그라운드로 이동하면 입력과 음성을 중지하고 네이티브 자원을 반환합니다.

최대 초당 5회만 분석하며 처리 중 들어오는 프레임은 네이티브에서 버립니다. 이미지 파일·base64·영상 기록을 만들거나 서버로 전송하지 않습니다. 모델은 앱에 포함되므로 설치 후 분석에 네트워크가 필요하지 않습니다.

현재 모델은 사람·차량 등 COCO 객체를 분류합니다. 차도/인도 영역 분할, 거리·충돌 시간 계산, OCR은 아직 연결하지 않았습니다. GPS 안내는 아래 Google Routes 프로토타입을 사용합니다. 신호등 객체 인식은 신호 색이나 횡단 가능 판정이 아닙니다.

## 실행

Node.js 22를 사용합니다. Android는 8.0(API 26) 이상이며, GPU 프레임 변환의 기기 호환성은 실기기에서 확인해야 합니다. 네이티브 카메라 모듈이 있으므로 **Expo Go에서는 실행할 수 없습니다**.

```sh
cd mobile
npm ci
npm run models:download
# Android SDK/JDK가 있는 컴퓨터 + USB 디버깅 휴대폰
npm run android -- --device
# macOS + Xcode + 개발용 서명 설정 + 연결된 iPhone
npm run ios -- --device
```

최초 모델 다운로드는 SHA-256과 파일 크기를 검증합니다. 모델을 지웠으면 다시 다운로드한 뒤 빌드합니다. 개발 빌드를 설치한 후에는 `npm start`로 Metro에 연결합니다. Google Drive 같은 동기화 폴더에서 npm 설치 오류가 나면 저장소를 일반 로컬 디스크에 복제해 실행하세요.

GitHub Actions의 **SENSEA native camera**는 두 OS의 네이티브 컴파일을 수행합니다. Android 성공 실행의 `sensea-android-arm64-demo` 아티팩트는 개발 키로 서명된 테스트 APK이며 앱스토어 배포용이 아닙니다. iOS 아티팩트는 시뮬레이터용으로, 별도 iPhone test package 워크플로는 개인 서명용 IPA를 만듭니다. [Windows 설치 안내](../docs/iphone-testing.md)를 확인하세요.

## 개인정보와 접근성 (v0.4)

처음 카메라를 켜기 전에 앱 내 이용 안내를 확인합니다. 안내 확인 상태는 앱 세션에만 유지하며 권한 승인은 별도 OS 창에서 받습니다. 안내를 취소하면 카메라를 열지 않습니다.

- **개인정보와 이용 안내 / 오픈소스 안내**를 열면 카메라와 음성이 정지합니다.
- **분석 종료·현재 결과 지우기**는 진행 중 입력·음성을 멈추고 표시 결과를 지웁니다. 저장된 사진이나 분석 기록은 만들지 않습니다.
- TalkBack/VoiceOver가 켜져 있으면 안내를 화면 읽기 시스템으로 전달합니다. 카메라·경로 안내는 공유 음성 출력과 진동을 사용합니다.
- 카메라·마이크·음성 인식·앱 사용 중 위치 권한은 기능 사용 시 요청합니다. 백그라운드 위치와 사진 라이브러리 권한은 차단합니다.
- 실제 기기에서 초점 이동·모달 닫기·큰 글씨·음성 겹침 검증은 [접근성 시험 계획](../docs/accessibility-test-plan.md)에 남아 있습니다.

## 조작

- **카메라 켜기**: 권한 요청 후 기기에서 분석합니다.
- **음성 안내**: 같은 결과가 연속 확인된 경우, 최소 4초 간격으로 달라진 내용을 읽습니다.
- **다시 듣기**: 1초 이내의 현재 결과만 읽습니다.
- **카메라 끄기**: 처리 중인 프레임의 사용이 끝난 뒤 카메라·모델·변환 자원을 반환합니다. 앱 복귀 후 자동으로 카메라를 다시 켜지 않습니다.
- **오픈소스 안내**: 사용 모델과 직접 의존 라이브러리의 라이선스를 확인합니다.

## 검증

```sh
npm run typecheck
npm test
npm run export:check
# Linux/macOS에서 실제 모델 계약 확인 (CI에도 포함)
python -m pip install ai-edge-litert==1.4.0 numpy==2.2.6
python scripts/check-model.py
```

단위 검사는 오류·스킵·1만 프레임 유입 시 메모리 반환, 작은 출력만 전달, 음성 반복 제한을 확인합니다. 번들·컴파일 성공은 실기기 성능 검증을 대체하지 않습니다. 실제 Android/iPhone에서 권한 거절·재허용, 카메라 50회 열기/닫기, 앱 전환, 20분 연속 실행, VoiceOver/TalkBack과 큰 글꼴, 지연·발열·메모리 추이를 확인해야 합니다.

구조와 한계: [실시간 처리](../docs/realtime-camera.md), [모델 출처](assets/models/README.md).

## UW 검색과 앱 내부 길안내

`.env.example`을 `.env`로 복사해 설정하세요.

- `EXPO_PUBLIC_API_BASE_URL`: 실행 중인 SENSEA 백엔드 주소. 휴대폰에서는 컴퓨터의 LAN IP를 사용하고 운영에서는 HTTPS를 사용합니다.
- `EXPO_PUBLIC_API_TOKEN`: 서버 `SENSEA_WRITE_TOKEN`과 같은 프로토타입 토큰입니다. 앱에서 읽을 수 있으므로 프로덕션 비밀 키로 취급하지 마세요.
- `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` / `EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY`: 해당 Google Maps SDK가 활성화된 플랫폼별 제한 키입니다. 서버용 Routes 키와 다릅니다.

백엔드에는 `GOOGLE_ROUTES_API_KEY`를 설정합니다. 네이티브 모듈과 권한이 추가되었으므로 새 개발 빌드가 필요하며, 지도 키 변경 후에도 네이티브 앱을 다시 빌드하세요.

실행 후 영어 건물명을 말하거나 입력 → 후보 선택 → 도로명 주소 확인 → 현재 위치에서 도보 경로 선택 → 카메라 준비 → 앱 안에서 지도·음성·진동 안내 순서입니다. 외부 지도 앱을 열지 않습니다. 지도 키가 없으면 앱 내부 경로 카드만 표시합니다. 영어 명령은 `option one`, `yes`, `prepare camera`, `start`, `pause`, `resume`, `repeat`, `back`입니다. 처음에는 음성 버튼으로 권한을 허용하며, 이후 실행 시 시작 멘트 뒤 자동으로 듣습니다. 화면 읽기 사용 중에는 운영체제 발화 종료 시점을 알 수 없어 음성 버튼을 사용합니다.

검색어는 UW로, 경로 요청의 현재 위치·목적지는 Google로 전달됩니다. 음성 인식은 OS 제공자의 네트워크 서비스를 사용할 수 있습니다. 원본 음성·영상이나 GPS 이동 이력은 저장하지 않습니다. 인식 텍스트·주요 버튼·터치 이벤트·안내 이벤트 종류는 로컬 SQLite에 최대 2,000개 기록합니다. 앱 사용 시 7일 지난 이벤트를 정리하며, 기록 끄기·삭제가 가능합니다. Google 경로 지시문은 기록에 저장하지 않습니다.

[구현 범위와 실기기 검증 항목](../docs/in-app-navigation.md)을 확인하세요. 보수적인 경로 이탈 감지·자동 재탐색·관성 기반 GPS 튐 제거·조사된 출입구 근접 판정과 전경 상대 소음 센싱은 구현되어 있습니다. 실제 VPS 공급자 정합, 보행 안전 판정, 정확한 장애물 거리와 검증된 무계단 경로는 아직 제공하지 않습니다.

## Integrated foundation camera (0.4.6)

Production still uses Expo Router and the main UI, account, noise, and UW/Google routes providers. CameraProvider now starts preview before model analysis and uses bounded HazardTracker observations with shared voice and vibration priorities. Android uses the pinned fast-tflite CPU/XNNPACK patch and local expo-asset model loading; preview remains available if analysis fails. CameraSmokeApp and index.smoke are a separate camera-only emulator harness, never the production entrypoint. Hazard observations cannot establish real distance, collision risk, stairs, or safe passage. Native device performance and the combined navigation/camera flow still require device validation.

## Source layout

The server lives in ../backend; all mobile UI and TypeScript code lives here. The former frontend directory has been removed. Its independent simulation/API and wake-word prototypes are preserved in [src/legacy](src/legacy/README.md), with their tests included in npm run test:ui. Production screens and providers continue using their current implementations. No native wake-word engine was added by this reorganization.

## backend-foundation v0.4.12 병합

Expo Router 진입점과 로그인·길찾기·로고를 유지합니다. 근접 장애물 정책과 영어 관찰 안내는 공용 CameraProvider에 적용하고 Android 내비게이션 화면에 UrbanVisionPanel을 연결했습니다. ONNX/ML Kit 확장 분석은 Android 전용이며 iOS는 기존 TFLite 분석을 유지합니다. 카메라 단독 앱 작업 기록은 README1.md를 참고하세요. 신호 카운트다운 최종 흐름은 아직 검증되지 않았습니다.
