# SENSEA

시각장애인·저시력 사용자를 위한 음성 중심 캠퍼스 보행 안내 앱입니다. 목적지 검색, 경로 비교, GPS 안내와 기기 내 카메라 관찰을 iPhone·Android에서 제공합니다.

현재 `main`은 Expo Router 기반 앱과 FastAPI 서버를 통합한 상태입니다. 모바일 버전은 **0.4.12**이며, 아래 내용은 2026-09-27의 구현 코드를 기준으로 합니다.

## 구현된 기능

### 목적지 검색과 사용자 정보

- UW–Madison 건물과 건물 내부의 부서·식당·도서관·InfoLab 이름 검색.
- 검색 결과가 하나이면 바로 경로 요청, 여러 개이면 선택 후 경로 요청. 별도의 주소 확인 단계를 줄였습니다.
- Supabase 이메일 회원가입·로그인, Google 로그인, 세션 복원, 로그아웃.
- 사용자 프로필·설정·저장 장소·최근 목적지·경로 기록 저장 및 조회.
- 로그인한 사용자의 최근 목적지를 홈 상단에 표시.
- 비밀번호 재설정·변경, 사용자 데이터 내보내기·삭제, 계정 삭제. 해당 DB migration 및 인증 공급자 설정이 필요합니다.

### 지도와 보행 경로

- Google Maps 지도 표시와 Google Routes API 도보 경로 요청.
- 대안 경로의 시간·거리 비교와 사용자 설정에 따른 순위 조정.
- 검증된 조건이 제공된 경우 계단·경사·장애물·공사·혼합 교통·횡단 조건을 점수에 반영하고, 검증된 폐쇄 경로를 제외합니다.
- 낮에는 신뢰 기준을 충족하는 소음 관측의 낮은 소음값을, 밤에는 조명 자료와 활동 소음 선호를 제한적으로 반영합니다.
- 소음 반영에는 최신 관측, 경로 커버리지 70% 이상, 측정 10개 이상, 기여자 3명 이상을 요구합니다. 소음만으로 사람 수나 범죄 안전성을 판단하지 않습니다.
- 전경 GPS 안내, 방향별 음성·진동, 일시정지·재개·다시 듣기.
- GPS 튐 보정, 오래되거나 부정확한 위치 거부, 경로 이탈 연속 확인과 자동 재탐색.
- 조사된 출입구 데이터가 완전할 때만 출입구 근접 판정을 사용합니다. 그 외에는 건물 대표 지점 근접으로 안내합니다.
- 최근 경로의 기기 내 캐시와 네트워크 실패 시 복구. 캐시에는 최신 공사·폐쇄 정보가 반영되지 않을 수 있습니다.

UW 경사도 PDF와 캠퍼스 전체 조명·장애물 자료를 실제 보행 그래프로 변환하는 작업은 완료되지 않았습니다. 순위 알고리즘이 구현되어 있어도 Google 경로에 이러한 검증 자료가 없으면 해당 조건을 확인된 것으로 표시하지 않습니다.

### 음성과 소음

- OS 음성 인식으로 목적지·경로 선택 및 이동 명령 처리, 텍스트·버튼 조작 대안.
- 공유 음성 출력 제어로 안내 중복을 줄이고 음성 인식과 발화 충돌을 조정합니다.
- 서버 음성 전사 API는 별도 OpenAI 키를 설정한 경우 사용 가능합니다.
- 기기 내 환경 소음 측정과 사용자 동의 기반 소음지도 기여.
- Supabase에 동의 상태와 거친 위치 격자의 숫자 측정값을 저장하고 집계 소음을 조회합니다.
- 실측 자료가 부족한 지도에는 데모 소음 자료를 구분해서 표시하는 대체 흐름이 있습니다.

휴대폰 소음값은 보정된 dB SPL 측정이 아닙니다. 마이크·음성 인식 동시 사용과 실제 오디오 출력은 기기별 검증이 필요합니다.

### 카메라와 장애물 관찰

- VisionCamera 실시간 후면 카메라, 영상 품질 검사, EfficientDet Lite0/TFLite 기기 내 객체 탐지.
- 최대 5 Hz 분석 및 처리 중 프레임 폐기로 과도한 작업을 제한합니다.
- 연속 탐지·화면 내 위치·겉보기 크기 변화·근접 후보 확인을 이용한 실험적 주의 요소 분류.
- 객체 박스와 주의 표시, 영어 관찰 안내, 진동. 자동 음성에서 사람을 제외하는 정책은 탐지·주의 판정과 별개입니다.
- 카메라 종료·백그라운드 전환 시 입력과 자원을 정리하고 재시도를 지원합니다.
- Android 내비게이션 화면에는 ONNX 도시 객체 모델과 ML Kit OCR 기반 확장 분석을 연결했습니다. 보행 신호 후보·카운트다운 관찰과 STOP 주변 스캔 안내를 제공합니다.
- Android 확장 모델은 약 99 MB이며 네이티브 Android 자산으로 복사됩니다. iOS는 기존 TFLite 분석을 사용하며 Android 확장 분석을 지원하지 않습니다.

실제 거리·충돌 확률·보행 가능 공간·횡단 허가를 계산하지 않습니다. 보행 신호 숫자 인식의 최종 E2E 검증은 완료되지 않았습니다. 카메라 객체 탐지는 VPS가 아니며, 조사된 공간 지도에 연결된 실제 VPS 공급자는 기본 제공되지 않습니다.

## 데이터와 연결 구조

```text
mobile/ — Expo Router · React Native · TypeScript
 ├─ Supabase Auth 및 RLS → 사용자·설정·기록·UW 디렉터리·소음
 ├─ FastAPI /campus → UW 검색 대체 흐름·Google 도보 경로
 ├─ Google Maps SDK → 지도 표시
 ├─ OS 음성 인식·expo-speech·expo-location → 명령·안내·GPS
 └─ VisionCamera → 로컬 TFLite / Android ONNX·OCR

backend/ — FastAPI · Python
 ├─ app.main → 캠퍼스 경로·소음·선택적 음성 전사
 └─ app.foundation → 별도 사진 품질 검사·서버 비전 실험 API
```

Supabase 연결은 모바일에서 공개용 키와 RLS를 사용합니다. 현재 FastAPI 기본 저장소는 SQLite/실험용 데이터이며 Supabase 저장소 어댑터를 사용하지 않습니다. 실시간 카메라는 서버 사진 분석 API를 호출하지 않습니다.

UW 공식 지도에서 수집한 데이터는 `backend/data/uw-buildings/`에 있습니다.

- 건물 지도 항목 **219개**: 건물 216개, 일부 건물 항목 3개. UW가 소유한 모든 물리적 건물의 개수라는 의미는 아닙니다.
- 시설 항목 **589개**: 부서 506개, 식당 49개, 도서관 25개, InfoLab 9개. 같은 시설이 여러 분류에 나타날 수 있습니다.
- 건물·시설 JSON, CSV 및 반복 실행 가능한 Supabase 가져오기 SQL.
- 건물 좌표·이름과 조사된 실제 출입구 정보는 구분합니다.

수집·새로고침·가져오기 방법은 [UW 데이터 설명](backend/data/uw-buildings/README.md)을 참고하세요.

## 저장소 구성

| 경로 | 역할 |
| --- | --- |
| `mobile/app/` | 홈·목적지·경로·내비게이션·카메라·설정·계정 화면 |
| `mobile/src/` | 인증·API·GPS·카메라·소음·앱 상태 |
| `mobile/native/urban-vision/` | Android ONNX·OCR 네이티브 구현 |
| `mobile/src/legacy/` | 현재 앱에서 사용하지 않는 초기 프로토타입 |
| `backend/app/` | FastAPI 및 경로·소음·사진 분석 모듈 |
| `backend/migrations/` | Supabase 스키마·RLS·사용자 데이터 관리 SQL |
| `backend/data/` | UW 수집 자료·출입구 입력·가상 그래프 |
| `docs/` | 기능 설계·통합·시험 기록 |

`frontend/`는 별도로 사용하지 않습니다. 실제 UI는 `mobile/`에 있습니다. `mobile/App.tsx`는 Expo Router 레이아웃을 재내보내며, 카메라 단독 시험 진입점은 `CameraSmokeApp.tsx`입니다.

## 실행 방법

Node.js 22, Python 3.12 이상을 사용합니다. iOS는 macOS/Xcode/CocoaPods, Android는 Android SDK/JDK 환경이 필요합니다. 네이티브 카메라 모듈 때문에 **Expo Go로는 실행할 수 없습니다**.

### 1. 환경변수와 DB

```sh
cp backend/.env.example backend/.env
cp mobile/.env.example mobile/.env
```

| 파일 | 주요 설정 |
| --- | --- |
| `backend/.env` | `GOOGLE_ROUTES_API_KEY`, `SENSEA_WRITE_TOKEN`; 서버 전사 사용 시 `OPENAI_API_KEY` |
| `mobile/.env` | `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_API_TOKEN`, 플랫폼별 Maps SDK 키, Supabase URL·publishable 키 |

`EXPO_PUBLIC_API_TOKEN`은 서버의 `SENSEA_WRITE_TOKEN`과 같아야 합니다. 실제 휴대폰에서는 서버 주소를 `localhost` 대신 Mac의 LAN IP로 지정하고 같은 네트워크에서 연결합니다.

Supabase는 `backend/migrations/001_initial.sql`부터 `005_account_management.sql`까지 적용하고 UW 건물·시설 가져오기 SQL을 실행합니다. Google 로그인은 Supabase 공급자와 앱 리다이렉트 설정도 필요합니다.

`EXPO_PUBLIC_*`는 앱에 포함됩니다. 서버 API 비밀키, Supabase service-role 키, DB 비밀번호는 넣지 않습니다. 실제 `.env`는 Git에 올리지 않습니다.

### 2. 서버

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --env-file .env
```

`http://localhost:8000/docs`에서 API를 확인할 수 있습니다. 선택적 사진 분석 서버는 `app.foundation:app`을 별도 포트에서 실행합니다.

### 3. 모바일

```sh
cd mobile
npm ci
npm run ios -- --device
# 또는
npm run android
```

개발 서버만 시작하려면 `npm start`를 사용합니다. 지도 SDK 키·네이티브 플러그인 변경 시 앱을 다시 빌드해야 합니다. Android 도시 객체 분석 플러그인도 네이티브 재빌드가 필요합니다.

## 주요 서버 API

| API | 역할 |
| --- | --- |
| `GET /health` | 서버 상태 |
| `GET /campus/places`, `GET /campus/places/{id}` | UW 목적지 검색·상세 |
| `POST /campus/routes` | Google 도보 경로 |
| `GET /places`, `GET /graph`, `POST /routes` | 가상 그래프·경로 실험 |
| `GET /noise`, `POST /noise` | 서버 구간 소음 저장·조회 |
| `POST /speech/transcribe` | 설정 시 서버 음성 전사 |
| `POST /demo/routes` | 명시적인 데모 경로 |
| `POST /vision/describe` | foundation 서버의 선택적 사진 분석 |

사용자 계정·기록·UW 디렉터리·격자 소음 DB 접근은 모바일의 Supabase 모듈을 통해 이루어집니다. 전체 계약은 [팀 연결 가이드](docs/team-integration.md)와 각 서버의 Swagger를 참고하세요.

## 검증과 남은 작업

```sh
cd mobile
npm run typecheck
npm test
npm run test:ui
npm run export:check

cd ../backend
python -m pytest
```

최근 병합에서 모바일 타입 검사, Node 테스트 **300개**, UI/상태 테스트 **46개**, iOS·Android 번들 생성 및 Android 시험 도구 테스트 **8개**가 통과했습니다. 번들 생성 성공은 네이티브 빌드나 실기기 인식 성능 검증을 대신하지 않습니다.

남은 주요 작업은 캠퍼스 보행 구간·경사·조명·실제 출입구 조사, iOS/Android 반복 실행·음성·마이크 시험, 신호 숫자 인식 E2E 검증, VoiceOver/TalkBack 및 사용자 현장 검토입니다. 현재 앱은 실험적 정보 제공 도구이며 경로가 안전하거나 장애물이 없다는 것을 보장하지 않습니다.

## 관련 문서

- [통합 기록](docs/branch-integration.md)
- [모바일 실행·카메라](mobile/README.md)
- [백엔드 설명](backend/README.md)
- [내비게이션 동작과 한계](docs/in-app-navigation.md)
- [장애물 관찰 설계](docs/hazard-awareness.md)
- [전체 개발 정리](DEVELOPMENT_SUMMARY.md)
- [브랜치별 작업·빌드 기록](README1.md)

README1과 이전 개발 기록에는 당시의 단독 카메라 앱·데모 계획이 포함되어 있습니다. 현재 통합 앱의 범위는 이 README와 실제 `main` 코드를 기준으로 확인하세요.
