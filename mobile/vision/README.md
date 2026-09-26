# 정지 사진 설명 연결 모듈

Expo 카메라 화면에 연결할 독립 모듈입니다. 전체 모바일 앱·카메라 화면·움직임 감지는 아직 구현하지 않았습니다. Node 테스트로 비동기 순서 처리를 검증하며 실제 기기의 카메라와 음성 출력은 별도로 확인해야 합니다.

## 동작

1. 사용자가 멈췄음을 확인한 뒤 촬영 버튼에서 `request()`를 호출합니다. 카메라 호출 전에 이전 요청을 무효화하고 기존 음성을 중지합니다.
2. 카메라 호출은 하나씩 실행합니다. 촬영 중 여러 요청이 쌓이면 이전 대기 요청을 건너뛰고 가장 최근 요청만 촬영합니다.
3. 사진마다 새로운 UUID를 보내고 서버 응답의 `request_id`를 확인합니다. 이전 HTTP 요청에는 abort를 전달하되, 취소가 무시되어도 이전 결과·오류를 버립니다.
4. 음성 출력을 시작하기 직전에도 요청 세대와 경과 시간을 검사합니다. 기본 유효 시간은 촬영 버튼을 누른 시점부터 15초이며 기기 평가 후 조정할 값입니다.
5. `status=retake`면 `quality.guidance`, `status=described`면 `description`을 읽습니다. `navigation_safe`가 false가 아닌 응답은 거부합니다.

서버는 요청 ID를 돌려줄 뿐 요청 순서를 저장하거나 오래된 분석을 취소하지 않습니다. 최신 여부는 사용자 동작을 알고 있는 이 모듈이 판단합니다. HTTP abort가 공급자 분석 중단이나 비용 취소를 보장하지는 않습니다. 자동 연속 촬영·자동 재시도는 하지 않습니다.

## Expo 연결 예

실제 Expo 앱에서 `expo-camera`, `expo-crypto`, `expo-speech`를 구성한 뒤 사용하는 연결 예입니다. 이 저장소에는 해당 앱과 패키지를 아직 설치하지 않았습니다.

```js
import * as Crypto from "expo-crypto";
import * as Speech from "expo-speech";
import { LatestVisionController } from "./vision/LatestVisionController.mjs";
import { createVisionTransport } from "./vision/createVisionTransport.mjs";

// 화면 인스턴스당 한 번 생성하고 React ref 등에 보관합니다.
const assistant = new LatestVisionController({
  capture: async () => {
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
    return { uri: photo.uri, mimeType: "image/jpeg" };
  },
  describe: createVisionTransport({
    baseUrl: "http://YOUR_LOCAL_PC:8000", // 로컬 기기 테스트용; 배포는 HTTPS
    apiKey: demoAccessToken, // OpenAI 키를 넣지 않습니다.
  }),
  makeRequestId: () => Crypto.randomUUID(),
  stopSpeech: () => Speech.stop(),
  speak: text => Speech.speak(text, { language: "ko-KR" }),
  onResult: result => setCameraResult(result),
  onError: error => showAccessibleError(error.message),
});

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

카메라 권한, 임시 사진 파일 삭제, 앱 상태 구독, 정지 확인 UI는 앱 연결 시 구현할 부분입니다. 이 모듈은 사진을 저장하거나 기록하지 않지만 `capture`가 만든 기기 캐시 파일은 앱이 소유하고 정리해야 합니다. 공유 데모 토큰은 운영용 사용자 인증이 아닙니다.

## 검증

저장소 루트, Node 22 이상:

```powershell
node --test mobile/vision/tests/*.test.mjs
```

네트워크·기기 권한 없이 지연된 촬영, 응답 순서 역전, 취소 무시, 이동 재개, 화면 종료, 응답 만료, 식별자 불일치, 늦게 끝나는 음성 중지 등을 검증합니다. HTTP transport도 가짜 fetch로 검사합니다.
