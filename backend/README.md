# SENSEA backend

기존 P0 API 계약을 유지하는 FastAPI 구현입니다. [데이터 아키텍처와 연결 안내](../docs/data-architecture.md)에 저장소 선택, API별 흐름, 마이그레이션과 실환경 확인 사항을 정리했습니다. 현재 모바일 카메라 앱에는 목적지·경로·소음 API가 아직 연결되지 않았으며, [사진 요청·음성 제어 모듈](../mobile/vision/README.md)도 별도로 연결할 수 있습니다.

## 현재 동작 범위

- `GET /places?q=library`: 목적지 검색.
- `POST /routes`: Dijkstra 기반 최단/소음 가중 경로 비교. 같은 경로는 중복 반환하지 않습니다.
- `POST /noise`: 동의한 사용자의 구간별 상대 소음값만 수신·집계합니다.
- `POST /vision/describe`: 멈춘 상태의 사진 → 짧은 한국어 설명·읽힌 글자·불확실성·차도/인도 관측.
- `GET /health`, `GET /docs`: 상태와 Swagger UI.
- `POST /speech/transcribe`: 미구현 상태를 명확히 알리는 `501 speech_not_configured`.

기본 `STORAGE_BACKEND=memory`는 **가상 데이터와 메모리 저장소**를 사용합니다. 실제 GPS 좌표는 `null`이며, 경로 요청에 `simulation=true`가 필요합니다. `STORAGE_BACKEND=supabase`로 서버 전용 DB 어댑터를 선택할 수 있습니다. 저장소 선택과 시뮬레이션 여부는 별도이며 Supabase도 기본 `SUPABASE_SIMULATION_ONLY=true`입니다. 실제 캠퍼스 경로 검증이나 모바일 길안내가 완료되었다는 의미가 아닙니다.

## 실행

Python 3.12 이상. 저장소 루트에서:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

macOS/Linux:

```bash
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
cp .env.example .env
.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

[Swagger UI](http://127.0.0.1:8000/docs)에서 요청을 실행할 수 있습니다.
휴대폰 테스트 시에만 호스트를 `0.0.0.0`으로 바꾸고 같은 네트워크의 PC 주소를 사용하세요. 외부 배포는 HTTPS와 사용자 인증을 먼저 구성해야 합니다. 이 메모리 저장소는 **단일 worker**에서 사용하며 재시작 시 업로드된 소음값은 초기화됩니다.

## 저장소 설정

기본 메모리 모드는 Supabase 계정 없이 실행됩니다. Supabase 모드를 사용하려면 `migrations/001_initial.sql`의 기존 적용 여부를 확인한 뒤 `migrations/002_storage.sql`까지 검토·적용하고, 로컬 `.env`에 다음을 설정합니다. 이미 적용한 `001`은 다시 실행하지 않습니다. 앱이 SQL을 자동 적용하거나 예제 데이터를 DB에 넣지는 않습니다.

```dotenv
STORAGE_BACKEND=supabase
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_REPLACE_LOCALLY
SUPABASE_TIMEOUT_SECONDS=10
SUPABASE_SIMULATION_ONLY=true
SENSEA_API_KEY=REPLACE_WITH_A_SEPARATE_APP_TOKEN
NOISE_TTL_SECONDS=3600
```

예시 문자열을 실제 값으로 바꾸는 작업은 로컬에서만 수행하세요. 실제 키를 채팅·코드·문서·로그·Git에 넣지 않습니다. `SUPABASE_SECRET_KEY`는 신규 secret 키 또는 기존 `service_role` 키로, 백엔드만 보유합니다. Supabase 모드에서 URL·DB 키·앱 접근 토큰이 없으면 설정 오류를 반환합니다. 모바일에는 FastAPI 주소와 `X-API-Key`에 넣을 앱 접근 토큰만 제공합니다.

`SUPABASE_SIMULATION_ONLY=false`는 검증한 데이터에 한해 명시적으로 선택합니다. 이때 미검증 보행 edge는 경로에서 제외됩니다. DB 연결 자체로 경로가 검증되지는 않습니다. `/health`의 `data_mode=demo/live`는 데이터 모드이며 DB 준비 상태 검사가 아닙니다.

저장소는 `Repository` 인터페이스로 분리했습니다. 동기 Supabase HTTP 호출은 worker thread에서 실행하고, 경로의 소음 요약은 구간별 호출 없이 일괄 조회합니다. 시간 초과·연결 실패·잘못된 DB 응답은 명시적인 API 오류가 되며 메모리 모드로 자동 전환하지 않습니다. API 요청·응답 형식과 사진 설명 구현은 유지합니다.

설정·RPC·권한·물리 삭제 작업의 범위는 [데이터 아키텍처](../docs/data-architecture.md)를 참고하세요. 이 변경에서 실제 Supabase 프로젝트 연결이나 마이그레이션 적용을 수행한 것은 아닙니다.

## 모바일 연결 예제

`POST /routes`:

```json
{
  "start_waypoint": "start",
  "end_waypoint": "library_entrance",
  "noise_preference": "quiet",
  "simulation": true
}
```

기본 예제는 200m 최단 경로와 280m 소음 가중 경로를 반환합니다. 소음 지수는 예시값이며 `noise_data_status=demo`로 구분합니다. 위치·경로·소음값 모두 실제 장소를 의미하지 않습니다.

`POST /noise`:

```json
{
  "edge_id": "start-quad",
  "relative_noise": 0.3,
  "consent": true
}
```

원시 오디오, 사용자 ID, 사용자 GPS는 받지 않습니다. 두 저장소는 유효 기간 내 구간별 최신 최대 1,000개 요약값을 집계합니다. 기본 유효 기간은 1시간(`NOISE_TTL_SECONDS=3600`)이며 경계 시각은 포함합니다. 메모리는 접근할 때 오래된 값을 제거하고, Supabase는 만료값을 집계에서 제외하지만 DB 행을 삭제하지 않습니다. 운영 환경의 정기 삭제 작업은 별도로 검토·구성해야 합니다. 메모리 데모 초기값과 업로드값은 함께 집계되므로 실제 측정값으로 사용하지 마세요. Supabase의 시뮬레이션 모드도 요약을 `demo`로 표시합니다.

`relative_noise`는 0~1 상대 소음값이며 dB SPL이나 인원수 추정값이 아닙니다. 만료/누락된 값은 `null`로 반환합니다. 경로 탐색에서는 미측정 구간을 0 소음으로 간주하지 않고 비용 계산에 보수적인 값 1을 사용합니다. 경로 소음값은 측정된 거리만의 가중 평균이며 `noise_coverage`와 구간별 측정 시간을 함께 확인해야 합니다.

`POST /vision/describe`는 multipart form입니다.

| 필드 | 형식 | 의미 |
| --- | --- | --- |
| image | JPEG/PNG/WebP 파일 | 사진 1장, 기본 5MiB/12MP 이하 |
| stationary | boolean, 필수 | 앱에서 사용자가 멈췄음을 확인 |
| request_id | UUID, 필수 | 촬영 시도마다 새 ID 생성, 응답과 대조 |
| expected_place | string, 선택 | 예상 장소명 200자 이하, 식별 근거로 간주하지 않음 |

```powershell
curl.exe -X POST http://127.0.0.1:8000/vision/describe -H "X-API-Key: YOUR_DEMO_TOKEN" -F "stationary=true" -F "request_id=00000000-0000-4000-8000-000000000001" -F "image=@sign.jpg;type=image/jpeg"
```

기본 `VISION_PROVIDER=disabled`에서는 품질 검사만 수행하며, 검사를 통과한 사진의 장면 설명은 `503 vision_not_configured`를 반환합니다. 실제 분석을 사용하려면 로컬 `.env`에 `VISION_PROVIDER=openai`, `OPENAI_API_KEY`, `SENSEA_API_KEY`를 설정하세요. 키는 Git에 포함하지 않습니다. 모바일에는 OpenAI 키를 넣지 않고, 데모용 접근 토큰만 `X-API-Key` 헤더로 전달합니다. 이 공유 토큰은 운영용 사용자 인증을 대체하지 않습니다.

OpenAI 연동은 [공식 이미지 입력 문서](https://developers.openai.com/api/docs/guides/images-vision)와 [Structured Outputs 문서](https://developers.openai.com/api/docs/guides/structured-outputs)를 따릅니다. 모델은 `OPENAI_VISION_MODEL`로 교체할 수 있습니다. 유료 API의 실제 응답 속도·인식 품질·계정 접근은 별도로 검증해야 합니다.

이미지를 디코딩해 EXIF/GPS를 제거하고 긴 변 1536px 이하 JPEG로 전송합니다. 백엔드는 사진을 영구 저장하거나 로그로 남기지 않으며, multipart 처리 중 프레임워크 임시 파일이 만들어질 수 있고 요청 종료 시 닫힙니다. OpenAI에 전송되는 사진은 해당 서비스의 데이터 처리 정책을 따릅니다. `store=false`를 설정하지만 외부 서비스의 무보관을 보장하는 설정은 아닙니다.

설명은 표지판·랜드마크 중심입니다. `navigation_safe`는 항상 false입니다. 차도/인도 관측이 있어도 거리 계산, 통행 허가, 충돌 회피, 횡단 판단을 제공하지 않습니다. 앱에서는 사진 설명 동안 이동 안내를 멈추고 [연결 모듈](../mobile/vision/README.md)로 중복 음성 출력과 뒤늦은 응답을 처리해야 합니다.

## 사진 품질과 응답 계약 (v0.2)

v0.2부터 `request_id`가 필수이며, 누락된 기존 클라이언트 요청은 422로 거부합니다. HTTP 200 응답은 먼저 `status`로 분기하세요.

검사를 통과해 모델이 설명을 반환한 경우:

```json
{
  "status": "described",
  "request_id": "00000000-0000-4000-8000-000000000001",
  "quality": {"status": "usable", "reason": null, "guidance": null},
  "description": "도서관이라고 적힌 표지판이 보입니다.",
  "recognized_text": ["도서관"],
  "uncertainty": "medium",
  "roadway": "uncertain",
  "sidewalk": "uncertain",
  "navigation_safe": false
}
```

재촬영이 필요한 경우 모델을 호출하지 않으며 장면 설명 필드가 없습니다:

```json
{
  "status": "retake",
  "request_id": "00000000-0000-4000-8000-000000000001",
  "quality": {
    "status": "retake",
    "reason": "low_detail",
    "guidance": "세부 정보가 부족합니다. 멈춘 상태에서 초점과 촬영 대상을 확인해 다시 찍어 주세요."
  },
  "navigation_safe": false
}
```

작은 해상도, 어두움, 과다 노출, 세부 정보 부족을 검사합니다. `low_detail`은 단색 벽 등에도 발생하므로 초점 불량을 확정하지 않습니다. `usable`은 임시 품질 규칙을 통과했다는 뜻이며 인식 정확도나 이동 안전 판정이 아닙니다. `uncertainty` 역시 모델의 정성적 표현이며 보정된 확률이 아닙니다. 임계값과 평가 계획은 [구현 기록](../docs/vision-implementation-notes.md)에 정리했습니다.

서버는 `request_id`를 그대로 돌려줍니다. 요청 간 최신 여부와 촬영 후 경과 시간은 앱이 검사해야 합니다. 연결 모듈은 촬영 버튼 시점부터 기본 15초가 지난 결과를 버리고, 이동 재개·화면 종료 시 이전 응답을 무효화합니다. 실제 화면의 수명주기와 연결하는 작업이 필요합니다.

## 오류

모든 예상 오류는 `{"error":{"code":"...","message":"..."}}` 형태입니다.

- 400: 소음 업로드 동의 없음
- 401: API 토큰 누락/불일치
- 404: 미등록 지점/구간, 연결된 경로 없음
- 409: 시뮬레이션 또는 정지 확인 필요
- 413/415/422: 크기 초과, 파일 형식, 요청 오류
- 429: 카메라 호출 제한, 기본 프로세스 전체 분당 6회, 품질 검사 시도 포함
- 501: 음성 인식 미연결
- 502/503/504: 모델 또는 저장소 응답 오류, 연결 실패/미설정, 시간 초과

`vision_configured=true`는 설정이 있다는 의미이며 실제 공급자 연결 성공을 보증하지 않습니다. 테스트는 외부 API 비용 없이 실행됩니다.

## 구조와 다음 연결 지점

```text
app/
  main.py           API, 인증, 호출 제한, 수명주기
  config.py         환경변수
  models.py         요청/응답 및 도메인 모델
  repository.py     저장소 Protocol
  storage.py        환경설정에 따른 저장소 선택
  db.py             가상 데이터와 메모리 소음 저장소
  supabase.py       Supabase PostgREST RPC 저장소
  check_storage.py  선택 실행하는 읽기 전용 DB 연결 검사
  routing.py        검증된 보행 그래프의 결정론적 경로 알고리즘
  vision.py         교체 가능한 카메라 설명 제공자
  images.py         이미지 검증·정규화
  quality.py        밝기·해상도·세부 정보 검사와 재촬영 안내
  middleware.py     multipart 파싱 전 요청 크기 제한
  data/demo.json    실제 좌표 없는 가상 그래프
migrations/
  001_initial.sql   기존 Supabase 테이블·키·RLS 정의(변경하지 않음)
  002_storage.sql   저장소 RPC·인덱스·서버 권한 제한
tests/
```

Supabase 어댑터는 기존 places/waypoints/path_edges/noise_observations를 사용합니다. `002_storage.sql`은 그래프 snapshot, 문자열 검색, 일괄 소음 집계, 원자적 소음 저장 RPC를 추가합니다. 테이블 RLS와 모바일 클라이언트 권한 차단을 유지하고, 함수는 서버 역할에만 실행을 허용합니다. 실제 DB에 적용·검증하기 전까지 마이그레이션 성공을 가정하지 마세요.

다음 단계는 실제 Supabase 프로젝트·키 설정, `001`→`002` 적용과 권한/읽기·쓰기 확인, 검증된 캠퍼스 데이터 입력, 보존기간 정기 삭제, 모바일 API 연결, 지도/위치 정확도 처리와 필요 시 STT 연결입니다. `simulation_only=false`에서 미검증 edge 제외와 양방향 안내 규칙을 유지합니다. 경로 알고리즘 테스트는 실시간 길안내 앱 자체를 검증하지 않습니다.

## 검사

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m ruff format --check .
```

기본 테스트는 실제 계정·네트워크·유료 API 없이 실행합니다. 테스트 통과는 실제 SQL 적용이나 DB 연결 성공을 의미하지 않습니다. Supabase 설정과 마이그레이션 적용을 별도로 완료한 개발 환경에서만 다음 읽기 전용 검사를 선택 실행합니다.

```powershell
.\.venv\Scripts\python.exe -m app.check_storage
```

이 명령은 `STORAGE_BACKEND=supabase`를 요구하며 행 삽입·삭제나 마이그레이션을 수행하지 않습니다. DB 쓰기와 운영 보존 정책은 별도 확인이 필요합니다.
