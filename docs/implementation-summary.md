# SENSEA 구현 변경사항 정리

> 마지막 정리일: 2026-09-27  
> 기준 브랜치: `user_setting`  
> 기준 커밋: `202ee1d`

## 1. 프로젝트 개요

SENSEA는 시각장애인과 저시력 사용자의 대학 캠퍼스 이동을 돕기 위한
음성 우선 내비게이션 프로토타입이다. 현재 프로젝트는 다음 기능을 하나의
Expo React Native 앱으로 통합했다.

- 목적지 음성·텍스트 검색과 재확인
- 접근 가능한 경로 선택 화면
- 단계별 음성 길 안내와 반복·일시정지·종료 조작
- 사용자 요청 기반 카메라 장면 설명
- Supabase 이메일/비밀번호 및 Google 로그인
- 사용자별 프로필, 장소, 경로 설정과 이동 기록
- 동의 기반의 전경 전용 소음 측정 및 소음 지도
- 낮과 밤에 서로 다른 상대 소음 선호도를 적용한 경로 비교

SENSEA는 실험적인 정보 보조 도구이며 지팡이, 안내견 또는 정식 이동 보조
장치를 대체하지 않는다. 카메라 설명이나 소음 정보는 길 또는 횡단보도의
안전을 보장하지 않는다.

## 2. 모바일 앱 구조와 화면

모바일 앱은 Expo SDK 57, React Native, TypeScript, Expo Router를 사용한다.
주요 화면은 다음과 같다.

| 화면 | 파일 | 구현 내용 |
| --- | --- | --- |
| 시작/홈 | `mobile/app/index.tsx` | 앱 소개, 목적지 입력 진입, 사용자 상태 표시 |
| 로그인/회원가입 | `mobile/app/auth.tsx` | 이메일·비밀번호 로그인/가입, Google OAuth |
| OAuth 콜백 | `mobile/app/auth/callback.tsx` | Supabase 로그인 콜백 처리 |
| 목적지 검색 | `mobile/app/destination.tsx` | 음성 또는 텍스트 검색, 인식 결과 확인 |
| 경로 선택 | `mobile/app/routes.tsx` | 시간·평지·안전 및 상대 소음 정보를 포함한 경로 비교 |
| 길 안내 | `mobile/app/navigate.tsx` | 경유지 안내, 지도, 반복·일시정지·종료, 소음 수집 상태 |
| 카메라 | `mobile/app/camera.tsx`, `scan.tsx` | 사용자가 요청한 장면/랜드마크 설명 |
| 설정 | `mobile/app/settings.tsx` | 접근성 설정, 소음 지도 기여 동의 및 데이터 삭제 |
| 계정 | `mobile/app/account.tsx` | 프로필, 저장·즐겨찾기·최근 장소, 경로 기록 |

공통 상태는 `JourneyProvider`, `AuthProvider`, `NoiseProvider`,
`CameraProvider`가 관리한다. 지도 표시는 `RouteMap.tsx`, 큰 조작 버튼은
`LargeActionButton.tsx`가 담당한다.

## 3. UI 및 접근성 변경사항

- 초기 단순 화면을 SENSEA 색상 체계와 카드 기반 레이아웃으로 개편했다.
- 주요 조작 버튼의 크기와 대비를 높이고 VoiceOver/TalkBack에서 읽을 수
  있도록 접근성 라벨, 역할, 힌트를 추가했다.
- 앱 시작, 목적지 확인, 경로 선택, 길 안내 과정에서 TTS 안내를 제공한다.
- 목적지와 경로를 음성뿐 아니라 표준 화면 조작으로도 선택할 수 있게 했다.
- 동적 길 안내가 중복 재생되지 않도록 음성 안내 큐를 사용한다.
- 위치 정확도가 낮을 때 정확한 방향을 단정하지 않고 불확실성을 안내한다.
- 반복, 일시정지, 정지, 카메라 실행 기능을 길 안내 화면에서 접근할 수 있다.

## 4. 인증 및 사용자별 데이터

Supabase Auth를 사용해 다음 인증 방식을 구현했다.

- 이메일/비밀번호 회원가입 및 로그인
- Google OAuth 로그인
- 로그인 세션 복원 및 로그아웃
- 신규 사용자 생성 시 프로필과 기본 환경설정 자동 생성

비밀번호는 `public` 테이블에 저장하지 않으며 Supabase Auth가 해시 처리한다.
모바일 앱에는 publishable key만 사용하고 service-role key나 Google client
secret을 저장하지 않는다.

사용자별 데이터는 다음 테이블에 저장된다.

| 테이블 | 용도 |
| --- | --- |
| `profiles` | 이름, 전화번호, 비상 연락처, 시간대 |
| `user_preferences` | 경로 우선순위, 계단·공사·보차 혼용 도로 회피 등 |
| `user_places` | 저장 장소, 즐겨찾기, 최근 방문 장소 |
| `route_history` | 목적지, 거리, 시간, 적용된 경로 조건과 이동 기록 |

각 테이블에는 Row Level Security가 적용되어 로그인한 사용자가 자신의
데이터만 조회·추가·수정·삭제할 수 있다.

## 5. 경로 탐색과 길 안내

- 캠퍼스의 검증된 경유지와 보행 경로를 기반으로 경로 대안을 계산한다.
- 가장 빠른 경로, 평지 중심 경로, 안전 조건 중심 경로를 비교할 수 있다.
- 계단, 보차 혼용 도로, 횡단보도, 공사 구간 조건을 사용자 설정에 반영한다.
- 경로 선택 결과와 경유지 안내를 음성으로 읽는다.
- GPS 정확도가 충분하지 않은 경우 시뮬레이션 또는 수동 확인을 제공한다.
- 정확한 GPS 값이 계획 경로에서 반복적으로 벗어나면 사용자를 정지시키고 현재
  위치에서 도보 경로를 자동 재탐색한다. 재탐색 실패 시 안내를 일시정지한다.
- DeviceMotion은 정지 상태의 비현실적인 GPS 순간 이동을 거부하는 데 사용하며
  위치를 임의로 생성하지 않는다.
- 현장 조사 메타데이터가 있는 출입구는 서로 다른 정확한 위치값 3회로 근접
  상태를 판정한 뒤 사용자에게 최종 확인을 요청한다. 데이터가 없으면 대표 건물
  좌표까지만 안내한다.
- 사용자가 도착을 확인하면 로그인 계정의 최근 장소에 반영되고, 내비게이션 시작은 경로 기록으로 저장된다.

현재 경로와 장소 데이터는 해커톤 시연 범위의 캠퍼스 데이터이므로 전체
캠퍼스 또는 일반 도로에 대한 완전한 경로 커버리지를 의미하지 않는다.

## 6. 카메라 및 장면 설명

- 사용자가 직접 요청했을 때 카메라 화면으로 이동한다.
- 표지판, 건물 이름, 입구 등 주변 랜드마크 설명을 제공하도록 구성했다.
- 카메라 결과에는 불확실성을 포함하고, 인식할 수 없는 경우 이를 알린다.
- 카메라는 충돌 방지, 실시간 장애물 회피 또는 안전한 횡단 판단을 보장하지
  않는다.
- 실제 기기용 VisionCamera 및 온디바이스 비전 모듈을 포함하므로 Expo Go가
  아닌 development build가 필요하다.

## 7. 소음 지도 구현

### 7.1 사용자 동의와 수집 조건

- 소음 수집은 기본적으로 꺼져 있다.
- 로그인한 사용자가 앱 설명을 읽고 동의한 뒤 OS 마이크 권한을 허용해야
  활성화된다.
- 수집은 앱이 전경에 있고 내비게이션이 진행 중일 때만 수행한다.
- 약 30초마다 최대 한 번, 5초 동안 측정한다.
- TTS가 재생 중이거나 위치 정확도가 30m보다 나쁘거나 유효 샘플이 부족하면
  해당 측정값을 폐기한다.
- 사용자는 설정에서 동의를 철회하고 자신의 측정 데이터를 삭제할 수 있다.

### 7.2 개인정보 보호

- 원본 음성은 서버로 전송하거나 데이터베이스에 저장하지 않는다.
- 측정값은 기기의 실시간 메모리 스트림에서 계산하며 오디오 파일을 생성하지 않는다.
- 정확한 GPS 좌표는 기기에서 약 30~45m 격자 중심으로 변환한 뒤 폐기한다.
- 서버에는 격자 ID·격자 중심, 상대 소음값, 측정 품질과 시간만 전송한다.
- 공개 지도에는 서로 다른 사용자 3명 이상이 기여한 시간별 격자만 나타난다.
- 데이터베이스가 사용자당 20초에 한 번, 하루 최대 1,000건으로 업로드를
  제한한다.

### 7.3 값의 의미와 경로 반영

측정값은 휴대전화 마이크의 dBFS 기반 **상대 소음값**이다. 보정된 dBA 또는
인증된 음압 측정값이 아니다.

- 낮 시간대(기본 07:00~19:00): 상대적으로 조용하게 측정된 경로 우선
- 밤 시간대(기본 19:00~07:00): 상대적으로 소리가 활발하게 측정된 경로 우선
- 경로와 최근 집계 격자가 충분히 겹치지 않으면 시간 기준 순서로 되돌리고
  소음 데이터가 부족함을 표시

소리가 크다고 사람이 많거나 안전하다는 뜻은 아니다. 소음 선호도는 검증된
보행 경로, 통제 구간 또는 긴급 안내보다 우선하지 않는다.

## 8. 데이터베이스 마이그레이션

Supabase SQL Editor에서 다음 파일을 순서대로 실행한다.

1. `backend/migrations/001_initial.sql`
2. `backend/migrations/002_user_accounts.sql`
3. `backend/migrations/003_crowdsourced_noise_map.sql`

현재 최종 `public` 테이블은 다음과 같다.

| 구분 | 테이블 |
| --- | --- |
| 캠퍼스 경로 | `waypoints`, `places`, `path_edges`, `noise_observations` |
| 사용자 데이터 | `profiles`, `user_preferences`, `user_places`, `route_history` |
| 소음 지도 | `noise_collection_consents`, `noise_measurements`, `noise_grid_hourly` |

`003`은 초기 개발 단계의 동일 이름 소음 테이블이 발견되면 데이터를 삭제하지
않고 `sensea_archive` 스키마로 옮긴 후 새 구조를 만든다.

### 전체 앱 데이터 초기화

필요한 데이터가 있다면 먼저 백업한다. 아래 작업은 SENSEA의 `public` 데이터와
이전 보관 스키마를 삭제하지만 `auth.users` 로그인 계정은 유지한다.

```sql
begin;

drop trigger if exists on_auth_user_created on auth.users;

drop table if exists
  public.noise_grid_hourly,
  public.noise_measurements,
  public.noise_collection_consents,
  public.noise_observations,
  public.route_history,
  public.user_places,
  public.user_preferences,
  public.profiles,
  public.places,
  public.path_edges,
  public.waypoints
cascade;

drop function if exists public.refresh_noise_grid_hourly() cascade;
drop function if exists public.can_submit_noise_measurement(uuid) cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.set_updated_at() cascade;
drop schema if exists sensea_archive cascade;

commit;
```

초기화 후 `001`, `002`, `003`을 다시 순서대로 실행한다. `002`가 남아 있는
`auth.users` 계정을 기반으로 기본 프로필과 환경설정을 다시 생성한다.

## 9. 실행 환경과 설정

모바일 환경변수 파일 `mobile/.env`에는 다음 값이 필요하다.

```text
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

설치 및 정적 검사는 다음과 같이 실행한다.

```bash
cd mobile
npm install
npm run typecheck
npm test
```

커스텀 네이티브 카메라·음성 인식·오디오 모듈 때문에 Expo Go 대신 실제 기기용
development build를 사용한다.

```bash
cd mobile
npx expo run:ios --device
# 또는
npx expo run:android --device

npx expo start --dev-client --clear
```

Google OAuth의 `sensea://auth/callback` custom URL scheme도 development
build에서 테스트해야 한다.

## 10. 테스트 및 검증

현재 모바일 테스트 범위에는 다음이 포함된다.

- 목적지와 길 안내용 음성 명령 파싱
- 경유지 안내와 거리 기반 안내 로직
- 비전 탐지 결과 정규화 및 위험하지 않은 설명 처리
- 소음값 정규화, 격자 변환과 품질 필터
- 낮/밤 상대 소음 경로 점수와 데이터 부족 fallback
- TypeScript 정적 타입 검사
- Expo iOS 번들 export 검사

주요 명령은 다음과 같다.

```bash
cd mobile
npm run typecheck
npm test
npx expo export --platform ios --output-dir /tmp/sensea-export
```

## 11. 현재 제한사항 및 다음 작업

- 실제 기기마다 마이크 감도가 다르므로 상대 소음값은 기기 간 편차가 있다.
- 소음 집계가 지도에 표시되려면 같은 격자·시간대에 최소 3명의 기여자가
  필요하다.
- 해커톤 이후에는 원시 측정값의 보관 기간과 자동 삭제 정책을 추가해야 한다.
- 전체 캠퍼스 경로를 제공하려면 검증된 경유지와 보행 경로 데이터를 확대해야
  한다.
- 실제 VPS 위치 정합에는 캠퍼스 공간맵, 현장 앵커와 검증된 VPS 공급자가
  추가로 필요하다. 현재 카메라 객체 인식을 VPS 좌표로 취급하지 않는다.
- VoiceOver와 TalkBack을 켠 실제 기기에서 전체 사용자 여정을 반복 검증해야
  한다.
- 마이크·카메라·위치 권한 거부, 네트워크 단절, 오래된 소음 데이터, GPS
  정확도 저하 상태를 실제 기기에서 점검해야 한다.
- 카메라 설명과 소음 경로 선호도는 보조 정보로만 유지하고 안전 보장 문구를
  사용하지 않아야 한다.

## 12. 관련 문서

- `docs/auth-and-user-data.md`: 인증과 사용자 데이터 설정
- `docs/noise-map-mvp.md`: 소음 지도 개인정보 보호 및 수집 방식
- `docs/accessibility-test-plan.md`: 접근성 테스트 계획
- `docs/demo-script.md`: 해커톤 시연 순서
- `docs/in-app-navigation.md`: 앱 내부 이동 구조
- `docs/realtime-camera.md`: 카메라 기능 설명
- `docs/privacy-and-safety.md`: 개인정보 및 안전 원칙
- `docs/branch-integration.md`: 브랜치 통합 내역
