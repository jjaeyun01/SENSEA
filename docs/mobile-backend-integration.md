# 모바일 앱 ↔ 백엔드 연결 상태

이 문서는 실행 중인 `mobile/app` 화면 기준이다. `mobile/src/legacy`와 백엔드의 `/demo`, 구형 `/places`, `/routes`, `/noise`, `/speech/transcribe` 흐름은 별도 데모·호환 경로이며 현재 앱의 기본 화면이 사용하지 않는다.

| 사용자 기능 | 모바일 데이터 경로 | 현재 연결 |
| --- | --- | --- |
| 건물·건물 내 시설 검색 | Supabase `sensea_uw_directory` RPC; 실패 시 백엔드 `/campus/places` | 연결됨. 백엔드 대체 검색은 건물만 검색하며 시설 목록은 Supabase가 필요하다. |
| 건물 선택·경로 후보 | Supabase 디렉터리/백엔드 `/campus/places/{id}` → 백엔드 `/campus/routes` → Google Routes `WALK` | 연결됨. 현재 위치 권한, 실행 중인 백엔드, Google Routes 키가 필요하다. |
| 계정·프로필·경로 설정 | Supabase Auth, `profiles`, `user_preferences` | 연결됨. 계정 화면과 경로 설정 화면이 같은 `user_preferences` 값을 사용한다. 로그인하지 않은 경우 설정은 해당 앱 세션에만 적용된다. |
| 최근 장소·즐겨찾기 | Supabase `user_places` | 연결됨. 도착 확인 후 최근 장소에 저장한다. |
| 경로 기록 | Supabase `route_history` | 연결됨. 안내 시작을 기록하고 도착 확인 시 완료 처리하여 계정 화면에서 보여 준다. |
| 소음 기여·지도·경로 보조 점수 | Supabase `noise_collection_consents`, `noise_measurements`, `noise_grid_hourly` | 연결됨. 사용자가 동의한 측정만 업로드하며 충분히 관측된 집계만 경로 점수에 사용한다. |
| 카메라 분석·음성 인식·음성/진동 안내 | 모바일 기기 내 라이브러리 | 기기 내 처리. 서버 영상·음성 인식 API를 기본 앱에 연결하지 않는다. |

## 아직 데이터가 없는 조건

`/campus/routes`는 검증된 보행로별 장애물, 계단, 경사, 조명, 공사 상태를 아직 반환하지 않는다. 따라서 계정의 보행 조건 설정은 코드상 순위 함수에 연결되어 있지만 해당 구간 자료가 없는 실제 Google 후보에서는 점수를 바꾸지 않는다. `docs/campus-route-policy.md`의 현장 조사·GIS 자료가 필요하다. 미확인 조건을 안전 또는 접근 가능으로 표시하지 않는다.

조명 선호도는 Supabase `user_preferences` 스키마에 컬럼이 없어 현재 세션에만 적용된다. 실제 검증 조명 자료가 준비되기 전에는 후보 순위에도 영향을 주지 않는다. 기존의 동작하지 않던 소음 변화 알림 스위치는 화면에서 제거했다. 지도는 위치 표시와 집계 소음 오버레이를 사용하며, 실시간 공사·범죄·가로등 API는 연결되어 있지 않다.
