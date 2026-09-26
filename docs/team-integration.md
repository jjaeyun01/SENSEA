# 팀 연결 가이드

호출어 정책: 앱 실행 후 음성 조작을 활성화하면 앱 이용 중 **SENSEA**로 명령 입력을 시작합니다. 초기 버전은 포그라운드만 지원 대상으로 하며, 앱 종료·화면 잠금·백그라운드 호출은 포함하지 않습니다. 제어 모듈과 네이티브 연결 작업은 [호출어 가이드](wake-word.md)를 참고하세요.

현재 구현은 **백엔드 + 화면과 독립적인 TypeScript 모듈**입니다. 프론트 담당자는 기존 파일을 유지한 채 `frontend/`에 Expo 앱을 구성하면 됩니다. 실제 마이크 권한·녹음·스피커·GPS 하드웨어 연결은 선택한 Expo SDK에 맞춰 프론트에서 연결해야 합니다.

## 백엔드 실행

Python 3.11 이상, 프로젝트 루트에서:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# .env에서 SENSEA_WRITE_TOKEN을 임의의 긴 값으로 설정
# 음성 전사를 쓸 때만 OPENAI_API_KEY 설정
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --env-file .env
```

API 문서: http://localhost:8000/docs. `/speech/transcribe`는 raw audio body를 받으므로 아래 설명 또는 클라이언트로 호출하세요. 경로 조회는 외부 API 키 없이 실행됩니다. 소음 데이터는 SQLite에 저장되며 재시작 후에도 유지됩니다. Supabase 연결은 아직 구현하지 않았습니다.

실제 휴대폰에서는 `localhost` 대신 같은 Wi-Fi의 개발 컴퓨터 LAN IP를 사용하세요. 이 서버는 팀 내부 데모용입니다. 브라우저 프론트의 CORS 설정은 아직 없으며 React Native 네이티브 연결을 기준으로 합니다. 외부 배포 시 HTTPS, 사용자 인증, 공유 저장소/요청 제한이 필요합니다. 데모 쓰기 토큰은 서버 OpenAI 키와 별개이며 모바일 배포용 인증 체계를 대체하지 않습니다.

## API

| 요청 | 설명 |
|---|---|
| `GET /health` | 상태·시뮬레이션 전용 여부 |
| `GET /places?q=도서관` | 목적지 검색. 응답 `{places: [...]}` |
| `GET /graph` | 경유 지점 ID·구간·시뮬레이션 표시 |
| `POST /routes` | 최단 경로와 소음 가중 경로 계산 |
| `POST /noise` | 동의한 상대 소음 요약 저장, Bearer 토큰 필요 |
| `GET /noise` | 구간별 평균·최신 시각·데이터 상태 |
| `POST /speech/transcribe` | 녹음 → 텍스트, Bearer 토큰 필요 |

```bash
curl http://localhost:8000/routes \
  -H 'Content-Type: application/json' \
  -d '{"start_waypoint":"start","end_waypoint":"library_entrance","noise_preference":"quiet","mode":"simulation"}'
```

`/routes`는 동일한 경로를 중복 반환하지 않습니다. 소음이 없어 두 경로가 같으면 선택지는 하나입니다. 각 경로의 `relative_noise`는 **모든 구간에 최근 측정치가 있을 때만** 숫자이며 그 외에는 null입니다. `noise_coverage`는 최근 데이터가 있는 거리 비율입니다. `noise_data_status`와 구간별 측정 시각도 사용자에게 알려주세요. 두 경로를 모두 측정했을 때만 상대적으로 더 조용한 경로를 추천합니다.

현재 데이터는 **좌표가 없는 가상 캠퍼스**이며 실제 보행 검증을 주장하지 않습니다. `mode: live` 요청은 거부됩니다. 실데이터 사용 시 지점·좌표·양방향 안내·현장 검증 절차를 먼저 마련하고 데이터 및 지도 표시를 확장하세요. `pedestrian_verified` 값을 현장 확인 없이 true로 바꾸지 마세요.

## 프론트 담당자: 음성 연결

`frontend/src/api/client.ts`의 `SenseaApi`를 생성하고, 다음 흐름으로 연결하세요.

1. 접근 가능한 마이크 버튼 → `voice.prepareToListen()` → 녹음 시작. 마이크 권한 거부 시 텍스트 입력 제공.
2. 버튼으로 녹음 종료(최대 15초 권장) → 녹음 파일을 Blob/ArrayBuffer로 읽기.
3. `api.transcribe(bytes, 'audio/mp4')` → `voice.acceptTranscript(result.transcript)`.
4. `VoiceController.onCommand`에서 아래 표에 맞춰 화면/세션 변경.
5. 녹음 파일은 성공·실패와 관계없이 `finally`에서 삭제. 서버는 원본 오디오를 파일로 저장하지 않지만, 전사를 위해 OpenAI로 전송하므로 녹음 전에 이를 알리고 동의를 받으세요.

| 명령 | 프론트 동작 |
|---|---|
| SET_DESTINATION | `api.places(query)`; 여러 결과면 사용자 선택, 없으면 재입력. 선택 후 `session.setDestination(place)` 반환 문장을 읽기 |
| CONFIRM_DESTINATION | `session.confirmDestination()` → 경로 선택 화면과 음성 설명 |
| SELECT_ROUTE | 표시 중인 경로 ID로 `session.selectRoute(id)`; 없는 저소음 대안은 없다고 알리기 |
| START_NAVIGATION | `voice.say(session.start())` |
| PAUSE | `session.pause()` |
| STOP / BACK | `session.reset()` → 목적지 입력 화면 |
| DESCRIBE_SURROUNDINGS | 일시정지 → 멈춰서 촬영하도록 안내 → 카메라 담당 모듈 호출 |
| REPEAT | 컨트롤러가 마지막 안내를 자동 반복 |

텍스트 목적지 입력/버튼도 동일한 세션 메서드로 연결합니다. `NavigationSession`은 명시적 목적지 확인 전 시작을 거부합니다. 시뮬레이션 다음 단계 버튼은 `voice.say(session.advanceSimulation())`를 호출합니다. 실시간 GPS 안내는 구현하지 않았습니다.

`VoiceController` 생성 시 `stopListening`, `stopSpeaking`, `speak`, `onCommand`를 주입하세요. `speak`는 실제 발화가 끝났을 때 resolve하고 취소 시에도 Promise를 정리해야 합니다. Expo의 `Speech.speak`는 바로 반환하므로 완료·중지 콜백을 Promise로 감싸세요. 발화 중 인식 결과는 무시합니다. 마이크 버튼을 누르면 발화를 먼저 중단합니다. 화면에는 인식·전사·발화 상태와 오류를 접근 가능한 텍스트로 표시하세요.

## 카메라 담당자

카메라 화면과 `/vision/describe`는 이번 구현에 포함하지 않았습니다. 분석 결과 `description: string`을 프론트로 전달하면 `voice.say(description)`으로 읽을 수 있습니다. 촬영 전 안내를 일시정지하고 사용자가 멈췄는지 확인하세요. 이미지 설명 자체로 경로를 바꾸거나 이동 명령을 만들지 마세요.

## 소음 측정

`summarizeMetering(samplesDbfs)`에 동일 기기에서 짧게 수집한 **dBFS** 배열을 전달하세요. 출력은 0~1 상대 지수로 보정된 dB SPL이 아닙니다. 실제 사용 중인 녹음 모듈의 metering 단위를 확인해야 합니다. 무음/빈 측정치를 임의의 0으로 대체하지 않습니다.

`api.submitNoise(edgeId, summary.relative_noise, consent)`로 전송하세요. 구간은 시뮬레이션에서 선택한 구간 또는 실제 확인된 구간이어야 합니다. GPS로 임의의 구간을 지정하는 기능은 없습니다. 명령 녹음과 소음 측정은 동시에 시작하지 마세요. 서버는 1시간 이내 요약을 평균하며 7일을 넘은 데이터는 다음 읽기/쓰기 때 삭제합니다. 백그라운드 상시 녹음은 없습니다.

측정 입력에 따른 경로 변화를 확인하려면 `/docs`에서 Authorize 대신 요청 헤더를 붙이는 클라이언트/curl을 사용해 네 구간을 등록하세요. 가상 그래프에서 넣는 수치는 데모 입력이며 현장 측정이라고 소개하면 안 됩니다.

```bash
curl http://localhost:8000/noise \
  -H "Authorization: Bearer $SENSEA_WRITE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"edge_id":"start-plaza","relative_noise":0.9,"consent":true}'
```

`plaza-library`도 0.9, `start-garden`과 `garden-library`는 0.1로 넣으면 도서관 경로가 최단 200m / 소음 가중 280m로 나뉩니다. `.env`를 uvicorn이 읽어도 현재 셸에는 변수가 생기지 않으므로 curl용 토큰은 별도로 셸에 설정해야 합니다.

## 테스트

프로젝트 루트에서:

```bash
cd backend
python -m unittest tests.test_api -v
python -m pytest -q
```

TypeScript 모듈 테스트는 Node 22.7+에서 프로젝트 루트 기준:

```bash
node --experimental-transform-types --test frontend/tests/*.test.ts
```

실제 휴대폰 녹음·재생, 스크린리더, OpenAI 실전사 호출은 별도 기기/키 검증이 필요합니다. API 테스트는 외부 전사를 mock하여 비용 없이 확인합니다.

음성 API 구현 참고: [OpenAI 공식 파일 전사 문서](https://developers.openai.com/api/docs/guides/speech-to-text).
