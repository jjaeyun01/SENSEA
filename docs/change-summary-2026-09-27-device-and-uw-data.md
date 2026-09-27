# iPhone 카메라 수정 및 UW 건물·시설 데이터 수집

작성일: 2026-09-27
대상 브랜치: main

## 모바일 안내 화면

- 실제 경로를 선택하고 안내 화면에 진입하면 카메라 준비를 자동 요청한다.
- 카메라를 화면 상단에 배치하고, 그 아래 안내 카드와 경로 지도를 표시한다.
- 카메라 상태, 재시도, 권한 설정, 안내 시작 버튼을 표시한다. 실제 경로는 카메라가 준비되어야 안내를 시작할 수 있다.
- 가상 데모 경로는 기존 수동 안내 흐름을 유지한다.

## iOS 물체 표시와 위험 판단

- 일반 물체 탐지 결과와 위험 후보를 별도로 표시하고 탐지 개수를 노출한다.
- 일반 탐지는 흰색 점선, 위험 후보는 우선순위별 색상과 라벨로 표시한다.
- 중앙 시야에 크게 나타난 물체를 주의 후보로 판정하는 조건을 추가했다. 기존 신뢰도 및 연속 프레임 확인 조건을 유지한다.
- 첫 추론 완료 로그에 탐지 개수와 일부 라벨을 기록해 실기기 분석을 확인할 수 있다.
- 화면에서 물체가 크게 보인다는 조건은 실제 거리 측정이 아니다. 모든 물체가 위험 대상으로 분류되지는 않으며, 충돌 회피나 안전을 보장하지 않는다.

## 카메라 및 소음 리소스 정리

- 카메라 종료 시 worklet의 프레임 콜백을 먼저 해제한 뒤 모델과 리사이저를 생성한 런타임에서 각각 한 번만 dispose한다.
- 서로 다른 런타임의 래퍼로 같은 Nitro 리소스를 중복 해제하던 문제를 수정했다.
- 일부 정리가 실패해도 나머지 리소스 정리를 시도하고, 오류 원인을 진단 로그에 남긴다.
- 카메라 반복 열기·닫기 테스트에 중복 dispose 검증을 추가했다. 사용자가 iPhone에서 기존 Camera Cleanup failed 오류 해결을 확인했다.
- 소음 모니터는 취소된 시작 요청을 실행하지 않고, Expo가 이미 해제한 오디오 객체를 unmount 정리에서 다시 중지하지 않도록 수정했다.

## 환경변수 예제

- backend/.env.example와 mobile/.env.example에 역할, 필수·선택 항목, 입력 방법을 한국어로 정리했다.
- Google Routes 서버 키와 플랫폼별 지도 SDK 키를 구분하고 휴대폰 테스트용 LAN 주소 사용법을 설명했다.
- 프로토타입 API 토큰 대응 관계와 Supabase 공개용 키 사용법을 설명했다.
- 실제 .env, API 키, DB 비밀번호는 커밋하지 않는다. 현재 백엔드는 Supabase 건물 저장소 어댑터를 사용하지 않는다.

## UW 공식 건물 목록

출처: https://map.wisc.edu/api/v1/map_objects.geojson

- 공식 지도 기준 219개 항목: building 216개, building_partial 3개. 건물 그룹도 포함하므로 UW 소유 전체 물리적 건물 수를 뜻하지 않는다.
- 건물명, UW ID, 주소, 건물 번호, 좌표, geometry, 출처를 JSON/CSV로 보관했다.
- 반복 실행 가능한 SQL로 Supabase places 및 waypoints에 저장했다. 두 테이블의 건물 연결·좌표·geometry 219건을 확인했다.
- 검증된 좌표는 보존하며 대표 건물 좌표를 검증된 출입구로 취급하지 않는다.
- 수집 코드: backend/scripts/export_uw_buildings.py

## More info 시설 목록

출처: https://map.wisc.edu/api/v1/map_objects/{id}.html

- 219개 건물의 상세 탭을 확인해 125개 건물에 연결된 589개 항목을 수집했다.
- Departments 506개, Dining 49개, Libraries 25개, InfoLabs 9개. 동일 시설이 여러 카테고리에 등장하면 별도 항목으로 포함한다.
- 시설명, 설명, 공개 링크, 원본 항목 ID, 출처를 facilities.json에 보관했다. 상세 탭에 표시된 연락처·운영시간은 수집 시점의 설명에 포함되며 외부 링크 페이지까지 수집하지는 않는다.
- Supabase place_facilities 테이블을 추가해 places에 연결하고, places.search_names에 건물명과 시설명을 저장했다. RLS를 활성화하고 일반 anon/authenticated 접근을 허용하지 않는다.
- College Library와 Open Book Café가 Helen C. White Hall에 연결되어 있고 검색명에도 포함됐음을 SQL로 확인했다.
- 시설을 건물의 동의어 또는 검증된 출입구로 취급하지 않는다. 반복 import는 안정적인 ID로 upsert하며 기존 데이터를 삭제하지 않는다.
- 수집 코드: backend/scripts/export_uw_facilities.py
- 데이터 및 재수집 방법: backend/data/uw-buildings/README.md

## 검증 및 남은 연결 작업

- mobile: npm run typecheck 통과, npm test 207개 통과.
- 건물·시설 수집 테스트: 4개 통과. 수집 코드와 관련 테스트 Ruff 검사 통과.
- Supabase 실제 저장 결과: 건물 219개, 시설 589개 및 예시 시설의 부모 건물 연결 확인.
- 이번 검증에서 새 iOS/Android 네이티브 빌드 또는 모든 실제 보행 상황을 재시험하지는 않았다.
- 앱의 /campus/places 검색은 여전히 UW API를 사용한다. Supabase의 새 시설 목록을 앱 검색에 연결하는 작업은 남아 있다.
- VPS 정합, 실제 거리 추정, 접근성 검증 및 시설 내부 경로 안내는 이번 변경에 포함되지 않는다.
