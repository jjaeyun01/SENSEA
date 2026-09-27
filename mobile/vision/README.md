# 카메라 분석 연결 모듈

정지 사진 요청과 소유권 있는 Y8 입력을 위한 독립 모듈입니다. 실제 Android/iPhone 카메라 앱은 [상위 README](../README.md)와 src/vision에 있습니다. 움직임 감지는 아직 구현하지 않았습니다. Node 테스트로 비동기 순서 처리를 검증하며 실제 기기의 카메라와 음성 출력은 별도로 확인해야 합니다.

## 실시간 로컬 처리

카메라의 작은 밝기 프레임을 초당 최대 5회 검사하는 `RealtimeFrameProcessor`와 `analyzeLumaFrame`을 추가했습니다. 분석 중 1장 + 최신 대기 1장만 보관하며 교체되는 프레임은 해제합니다. 서버 호출과 음성 출력을 자동 반복하지 않습니다.

[실시간 처리·버퍼 소유권·카메라 어댑터 연결 방법](../../docs/realtime-camera.md)을 확인하세요. 네이티브 앱은 별도 worklet 경로로 객체 탐지를 수행합니다. 차도/인도 영역 분할은 아직 구현하지 않았습니다.

## 정지 사진 설명 동작

1. 외부 서비스로 사진이 전송됨을 알리고 동의를 받은 다음, 사용자가 멈췄음을 확인한 뒤 촬영 버튼에서 `request()`를 호출합니다. 카메라 호출 전에 이전 요청을 무효화하고 기존 음성을 중지합니다.
2. 카메라 호출은 하나씩 실행합니다. 촬영 중 여러 요청이 쌓이면 이전 대기 요청을 건너뛰고 가장 최근 요청만 촬영합니다.
3. 사진마다 새로운 UUID를 보내고 서버 응답의 `request_id`를 확인합니다. 이전 HTTP 요청에는 abort를 전달하되, 취소가 무시되어도 이전 결과·오류를 버립니다.
4. 음성 출력을 시작하기 직전에도 요청 세대와 경과 시간을 검사합니다. 기본 유효 시간은 촬영 버튼을 누른 시점부터 15초이며 기기 평가 후 조정할 값입니다.
5. `status=retake`면 `quality.guidance`, `status=described`면 `description`을 읽습니다. `navigation_safe`가 false가 아닌 응답은 거부합니다.

서버는 요청 ID를 돌려줄 뿐 요청 순서를 저장하거나 오래된 분석을 취소하지 않습니다. 최신 여부는 사용자 동작을 알고 있는 이 모듈이 판단합니다. HTTP abort가 공급자 분석 중단이나 비용 취소를 보장하지는 않습니다. 자동 연속 촬영·자동 재시도는 하지 않습니다.

## Expo 연결 예

실제 Expo 앱에서 `expo-camera`, `expo-crypto`, `expo-speech`를 구성한 뒤 사용하는 연결 예입니다. 이 예제는 별도 정지 사진 UI를 위한 것으로, 현재 카메라 앱에는 expo-camera·expo-crypto·expo-file-system과 서버 업로드를 연결하지 않았습니다.

```js
import * as Crypto from "expo-crypto";
import * as Speech from "expo-speech";
import { File } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import { LatestVisionController } from "./vision/LatestVisionController.mjs";
import { createVisionTransport } from "./vision/createVisionTransport.mjs";

// 화면 인스턴스당 한 번 생성하고 React ref 등에 보관합니다.
const assistant = new LatestVisionController({
  capture: async () => {
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
    return { uri: photo.uri, mimeType: "image/jpeg" };
  },
  // Mandatory: delete only the temporary file owned by this capture.
  releasePhoto: async photo => {
    const file = new File(photo.uri);
    if (file.exists) file.delete();
  },
  describe: createVisionTransport({
    baseUrl: "https://YOUR_BACKEND", // 기본 HTTPS만 허용; 키를 URL에 넣지 않습니다.
    fetchImpl: expoFetch, // RN의 기본 XHR fetch는 redirect:error를 보장하지 않습니다.
    apiKey: demoAccessToken, // OpenAI 키를 넣지 않습니다.
  }),
  makeRequestId: () => Crypto.randomUUID(),
  stopSpeech: () => Speech.stop(),
  speak: text => Speech.speak(text, { language: "en-US" }),
  onResult: result => setCameraResult(result),
  onError: error => showAccessibleError(error.message),
});

// 외부 AI 수신자·전송 내용 안내에 대한 사용자의 명시적 동의 뒤:
await assistant.setExternalProcessingConsent(true);
// 사용자의 정지 확인과 촬영 버튼 동작:
await assistant.setStationary(true);
await assistant.request({ expectedPlace: "도서관 입구" });

// 이동을 재개하거나 앱이 inactive/background 상태가 되면:
await assistant.setStationary(false);
setCameraResult(null);

// 화면을 벗어나거나 컴포넌트를 해제할 때:
await assistant.dispose();
```

위 변수와 UI 콜백은 앱에서 제공합니다. 정지 확인은 센서 검증이 아닙니다. 화면 재진입 시 새 인스턴스를 만들고, 백그라운드에서 돌아왔을 때도 정지를 다시 확인하세요. React effect cleanup에서는 `void assistant.dispose().catch(showAccessibleError)`처럼 실패를 처리합니다. 화면 포커스를 잃었지만 unmount되지 않는 경우에도 cancel/dispose를 연결해야 합니다.

`speak`는 동기적으로 발화를 큐에 넣는 함수여야 합니다. 비동기 작업 뒤 발화를 시작하는 콜백을 넣으면 최종 시점 검사가 깨집니다. [Expo Speech](https://docs.expo.dev/versions/latest/sdk/speech/)의 `speak`와 `stop`을 기준으로 구성했습니다. 다른 길안내 TTS도 같은 음성 제어 경로에서 조정하세요. 오류·재촬영 안내를 접근성 스크린 리더와 이중 낭독하지 않도록 실제 앱에서 확인해야 합니다.

카메라 권한, 앱 상태 구독, 정지·외부 전송 동의 UI는 별도 사진 화면을 연결할 때 구현해야 합니다. `releasePhoto`는 필수 콜백이며 성공·오류·취소·늦게 끝난 촬영에서 사진마다 한 번 호출됩니다. 삭제 실패는 알리고 추가 촬영을 차단합니다. 캡처 도중 내부적으로 만든 파일은 `capture`가 반환하지 못할 경우 캡처 어댑터가 정리해야 합니다. `setExternalProcessingConsent(false)`는 진행 중 요청을 취소하고 늦은 결과를 무효화하지만 이미 전송된 사진을 회수하지는 못합니다.

전송 모듈은 HTTPS만 허용하고 리디렉션을 거부하도록 요청합니다. 이를 지원하는 `expo/fetch`를 명시적으로 주입해야 하며, React Native의 기본 XHR fetch로 자동 대체하지 않습니다. 개발 중 사설 IP·loopback HTTP가 필요한 경우에만 `allowInsecureLocalHttp: true`를 명시하세요. HTTP 구간은 암호화되지 않으며 운영용이 아닙니다. 실제 네이티브 fetch의 리디렉션/취소 처리와 파일 삭제는 기기에서도 확인해야 합니다. 공유 데모 토큰은 운영용 사용자 인증이 아닙니다.

## 검증

저장소 루트, Node 22 이상:

```powershell
node --test mobile/vision/tests/*.test.mjs
```

네트워크·기기 권한 없이 지연된 촬영, 응답 순서 역전, 취소 무시, 이동 재개, 화면 종료, 응답 만료, 식별자 불일치, 늦게 끝나는 음성 중지 등을 검증합니다. HTTP transport도 가짜 fetch로 검사합니다.
