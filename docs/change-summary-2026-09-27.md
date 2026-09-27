# SENSEA 변경사항 정리

작성일: 2026-09-27  
현재 브랜치: `connect-back-front`  
기준 커밋: `fd75e17` (light four-tab UI), `6744919` (building API + microphone access)

## 1. 전체 요약

SENSEA 모바일 앱을 기존 다크 테마에서 밝은 테마의 4탭 구조로 개편하고, UW–Madison 건물 검색/상세정보 API와 전경 실시간 환경 소음 측정을 연결했다.

현재 주요 사용자 흐름은 다음과 같다.

1. 앱 실행 및 마이크 권한 확인
2. 홈에서 음성 또는 텍스트로 UW 건물 검색
3. 검색 결과 선택 후 주소와 대표 좌표 확인
4. 경로 후보 조회 및 선택
5. 지도·음성·진동 기반 안내
6. 홈/지도에서 환경 소음의 기기 상대값 확인

## 2. UI와 내비게이션 개편

### 밝은 테마

- 전체 앱을 흰색/밝은 회색 배경과 민트 계열 SENSEA 브랜드 색상으로 통일했다.
- 카드, 버튼, 배지, 입력창, 하단 내비게이션의 간격과 모서리 스타일을 통일했다.
- 기존 `Tap to speak` 중심 UI 대신 `Voice assistant active` 상태 카드를 표시한다.
- 참고 이미지: [sensea-four-tab-ui-light.png](sensea-four-tab-ui-light.png)

### 4개 하단 탭

| 탭 | 역할 |
| --- | --- |
| Home | 목적지 검색, 건물 상세 확인, 경로 탐색 시작 |
| Map | 캠퍼스 지도, 소음 오버레이 ON/OFF, 실시간 기기 소음 레벨 |
| Preferences | Balanced/Fastest/Quietest/Step-free 등 경로 추천 선호도 |
| Profile | 게스트 이용, 프로토타입 로그인, 안내 및 개인정보 설정 |

로그인하지 않아도 핵심 검색·지도·경로 기능을 사용할 수 있다. 현재 로그인은 앱 세션에만 저장되는 UI 프로토타입이며 실제 인증 백엔드와 연결되어 있지 않다.

주요 파일:

- `mobile/src/components/BottomNav.tsx`
- `mobile/src/theme.ts`
- `mobile/app/index.tsx`
- `mobile/app/map.tsx`
- `mobile/app/preferences.tsx`
- `mobile/app/profile.tsx`
- `mobile/app/settings.tsx`

## 3. UW 건물 검색 및 상세정보 연결

### 백엔드

`backend/app/campus.py`가 UW 지도 서비스를 서버에서 호출한다. 모바일 앱이 UW 외부 API를 직접 호출하지 않는다.

| Method | Endpoint | 기능 |
| --- | --- | --- |
| `GET` | `/campus/places?q={query}` | 건물명 검색, ID/이름 목록 반환 |
| `GET` | `/campus/places/{place_id}` | 건물명, 도로명 주소, 대표 위도/경도 반환 |
| `POST` | `/campus/routes` | 현재 위치와 선택한 건물 사이의 도보 경로 조회 |

적용된 검증:

- 검색 결과는 UW의 `building` 및 `building_partial` 객체만 허용한다.
- 건물 ID는 숫자 형태만 허용한다.
- 건물명 공백/누락, 잘못된 위도·경도, 건물이 아닌 객체를 거부한다.
- UW 응답 형식이 바뀌거나 외부 서비스에 연결하지 못하면 `502` 오류를 명시적으로 반환한다.
- 검색과 상세 응답에 FastAPI/Pydantic 응답 모델을 적용했다.
- 응답에 `Cache-Control: no-store`를 적용한다.

### 프론트엔드

`mobile/src/navigation/campusApi.ts`에 검색과 상세정보 전용 함수를 추가했다.

- `searchCampusPlaces(query, signal)`
- `getCampusPlace(placeId, signal)`
- 검색/상세 응답 런타임 검증
- AbortSignal 기반 취소 및 시간 제한
- 서버 연결 실패, 읽을 수 없는 JSON, API 오류 메시지 처리
- 검색 결과 ID와 상세 결과 ID가 다른 경우 거부

사용자가 검색 결과를 누르면 상세 API를 다시 호출한다. 확인 카드에는 다음 정보가 표시된다.

- UW–Madison 건물명
- 도로명 주소
- 검증된 대표 위도/경도

관련 파일:

- `backend/app/campus.py`
- `mobile/src/navigation/campusApi.ts`
- `mobile/src/navigation/JourneyProvider.tsx`
- `mobile/app/index.tsx`
- `mobile/src/navigation/campusApi.test.ts`

## 4. 연속 환경 소음 측정

### 권한과 실행 범위

- 앱 실행 시 운영체제 마이크 권한을 요청한다.
- 사용자가 허용하면 앱이 전경에 있는 동안 측정을 계속한다.
- 앱이 백그라운드로 이동하면 스트림을 즉시 중단한다.
- 음성 명령 인식을 시작하면 마이크 충돌 방지를 위해 소음 측정을 잠시 멈추고, 인식 종료 후 자동으로 재개한다.
- Settings와 Profile에서 `Continuous sound meter`를 끌 수 있다.
- 권한을 영구 거절한 경우 시스템 설정으로 이동하는 버튼을 제공한다.

### 측정 방식

`expo-audio`의 실시간 PCM `AudioStream`을 사용한다.

1. 16 kHz, 모노, Float32 PCM 버퍼를 받는다.
2. 샘플의 RMS(root mean square)를 계산한다.
3. `20 × log10(RMS)`로 `dBFS`를 구한다.
4. 약 250ms 단위로 값을 갱신하고 지수 평활화로 흔들림을 줄인다.
5. 화면 표시용으로 Quiet/Moderate/Loud 구간을 분류한다.

원시 PCM 버퍼는 계산 직후 폐기하며 오디오 파일, 데이터베이스 또는 서버에 저장하지 않는다.

### UI 표시

- 홈: 실시간 값, LIVE/PAUSED/OFF 상태, 레벨 바, Quiet/Moderate/Loud 표시
- 지도: 소음 오버레이 카드에 현재 `dBFS`와 레벨 바 표시
- 설정/Profile: 연속 측정 ON/OFF 스위치

관련 파일:

- `mobile/src/noise/NoiseMonitorProvider.tsx`
- `mobile/src/noise/noiseLevel.ts`
- `mobile/src/components/LiveNoiseMeter.tsx`
- `mobile/src/navigation/JourneyProvider.tsx`
- `mobile/app/_layout.tsx`
- `mobile/app/index.tsx`
- `mobile/app/map.tsx`
- `mobile/app/profile.tsx`
- `mobile/app/settings.tsx`
- `mobile/app.json`

### 중요한 단위 제한

현재 표시값은 교정된 소음계의 `dB SPL`이 아니라 디지털 입력 기준의 `dBFS`다. 휴대폰 모델, 마이크 감도, 자동 게인 제어에 따라 값이 달라질 수 있으므로 다음 용도로 사용하면 안 된다.

- 청력 손상/산업안전 노출 판정
- 법적 소음 기준 판정
- 서로 다른 기기 사이의 절대 소음 비교
- 주변 인원수 또는 안전도 추정

Quiet/Moderate/Loud 임계값도 기기 상대값을 시각화하기 위한 제품 휴리스틱이다. 실제 `dB SPL`이 필요하면 기기별 보정값과 인증된 기준 소음원을 이용한 캘리브레이션 절차가 추가되어야 한다.

## 5. 개인정보 및 안전 처리

- 환경 소음 원본 오디오는 저장하거나 업로드하지 않는다.
- 음성 인식은 Apple/Google 운영체제 서비스의 네트워크 처리를 사용할 수 있다.
- 건물 검색어는 UW 서비스로 전달된다.
- 경로 요청 시 현재 위치와 목적지는 Google Routes API로 전달될 수 있다.
- 카메라 프레임은 기기에서 처리하며 이미지 파일로 저장하지 않는다.
- 앱은 백그라운드 위치와 백그라운드 마이크 녹음을 활성화하지 않는다.
- SENSEA는 실험적 정보 보조 도구이며 보행 안전, 장애물 회피 또는 횡단 가능 여부를 보장하지 않는다.

## 6. 설정 및 실행

### 백엔드

```sh
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --env-file .env
```

건물 검색/상세조회에는 모바일 토큰이 필요하지 않다. `/campus/routes`를 사용하려면 백엔드 `.env`에 다음 값이 필요하다.

```env
SENSEA_WRITE_TOKEN=...
GOOGLE_ROUTES_API_KEY=...
```

### 모바일

```sh
cd mobile
npm ci
npm run ios -- --device
# 또는
npm run android -- --device
```

`mobile/.env` 예시:

```env
EXPO_PUBLIC_API_BASE_URL=http://localhost:8000
EXPO_PUBLIC_API_TOKEN=
EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY=
EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY=
```

실제 휴대폰에서는 `localhost` 대신 백엔드가 실행 중인 Mac/PC의 LAN IP를 사용한다. 운영 환경에서는 HTTPS를 사용해야 한다.

마이크 권한과 `expo-audio` 네이티브 설정이 추가되었기 때문에 기존 Dev Client가 있더라도 네이티브 앱을 다시 빌드해야 한다. Expo Go는 현재 사용 중인 네이티브 카메라·음성 모듈을 모두 지원하지 않는다.

## 7. 검증 결과

최근 변경 후 다음 검사를 통과했다.

- TypeScript `tsc --noEmit`: 통과
- Vitest UI/API/계산 테스트: 19개 통과
- Node 내비게이션·비전 테스트: 83개 통과
- Expo public config 생성: 통과
- Git diff whitespace 검사: 통과
- 캠퍼스 검색 → 상세조회 백엔드 HTTP 스모크 테스트: 통과
- Python backend compile 검사: 통과

프로젝트 백엔드 가상환경에는 전체 pytest 픽스처가 요구하는 Pillow가 누락되어 있어 전체 pytest 실행 전 `requirements-dev.txt` 설치가 필요하다.

## 8. 남은 작업

- 실제 iPhone/Android에서 20분 이상 연속 소음 측정 시 발열·배터리·메모리 확인
- 여러 휴대폰 모델에서 `dBFS` 범위와 Quiet/Moderate/Loud 임계값 조정
- 음성 안내 재생 중 마이크가 기기 스피커 출력을 다시 측정하는지 실기기 확인
- 실제 UW 네트워크 응답과 검색 결과 형식 회귀 확인
- 운영용 사용자 인증 연결
- 로그인/환경설정 영구 저장 및 동기화
- Google Routes/Maps 운영 키 제한과 서버 인증 강화
- 필요 시 인증된 기준 소음원을 이용한 기기별 `dB SPL` 보정 기능 설계

