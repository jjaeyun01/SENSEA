# SENSEA backend

루트 README의 P0 API 계약을 따르는 FastAPI 기본 구현입니다. 모바일 앱은 별도 작업이며, [최신 요청·음성 제어 모듈](../mobile/vision/README.md)을 연결할 수 있습니다.

## 현재 동작 범위

- `GET /places?q=library`: 목적지 검색.
- `POST /routes`: Dijkstra 기반 최단/소음 가중 경로 비교. 같은 경로는 중복 반환하지 않습니다.
- `POST /noise`: 동의한 사용자의 구간별 상대 소음값만 수신·집계합니다.
- `POST /vision/describe`: 멈춘 상태의 사진 → 짧은 한국어 설명·읽힌 글자·불확실성·차도/인도 관측.
- `GET /health`, `GET /docs`: 상태와 Swagger UI.
- `POST /speech/transcribe`: 미구현 상태를 명확히 알리는 `501 speech_not_configured`.

현재 저장소는 **가상 데이터와 메모리 저장소만 사용**합니다. 실제 GPS 좌표는 `null`이며, 경로는 반드시 `simulation=true`로 요청해야 합니다. 응답은 항상 `simulation_only=true`입니다. 실제 캠퍼스 경로 검증이나 이동 안내가 구현되었다는 의미가 아닙니다.

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

원시 오디오, 사용자 ID, 사용자 GPS는 받지 않습니다. 구간별 최대 1,000개 요약값을 메모리에 보관하며, 집계/쓰기 시 1시간보다 오래된 값은 제거합니다. 읽기·쓰기가 없는 유휴 구간의 메모리 제거는 다음 접근 때 이뤄집니다. 데모 초기값과 업로드값은 함께 집계되므로 실제 측정값으로 사용하지 마세요.

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
- 502/503/504: 모델 응답 오류, 미연결, 시간 초과

`vision_configured=true`는 설정이 있다는 의미이며 실제 공급자 연결 성공을 보증하지 않습니다. 테스트는 외부 API 비용 없이 실행됩니다.

## 구조와 다음 연결 지점

```text
app/
  main.py           API, 인증, 호출 제한, 수명주기
  config.py         환경변수
  models.py         요청/응답 및 도메인 모델
  db.py             가상 데이터와 메모리 소음 저장소
  routing.py        검증된 보행 그래프의 결정론적 경로 알고리즘
  vision.py         교체 가능한 카메라 설명 제공자
  images.py         이미지 검증·정규화
  quality.py        밝기·해상도·세부 정보 검사와 재촬영 안내
  middleware.py     multipart 파싱 전 요청 크기 제한
  data/demo.json    실제 좌표 없는 가상 그래프
migrations/
  001_initial.sql   Supabase 테이블 초안
tests/
```

Supabase는 아직 연결하지 않았습니다. SQL은 루트 README의 places/waypoints/path_edges/noise_observations에 입구 waypoint 연결과 역방향 안내 문장을 추가한 초안입니다. [Supabase RLS 문서](https://supabase.com/docs/guides/database/postgres/row-level-security)에 따라 RLS와 클라이언트 권한 차단을 포함합니다. 실제 DB에 적용·검증하기 전까지 마이그레이션 성공을 가정하지 마세요.

다음 단계는 실제 캠퍼스 구간 검증, Supabase 저장소 어댑터와 보존기간 삭제 작업, 지도/위치 정확도 처리, 필요 시 STT 제공자 연결입니다. 실제 저장소를 붙일 때는 `simulation_only=false`에서 미검증 edge가 제외되는 규칙과 양방향 안내를 유지하세요. 현재 경로 알고리즘 테스트는 이 필터를 검증하지만, 실시간 길안내 앱 자체를 검증하지는 않습니다.

## 검사

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m ruff format --check .
```
