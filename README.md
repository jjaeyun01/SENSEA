# Integrated main application

The current app combines `be1`, `fr1`, `fr_num2` and `fr2`, using **fr2’s design**. See [integration details](docs/branch-integration.md), [mobile setup](mobile/README.md), and [demo script](docs/demo-script.md).

# SENSEA

개발 진행 내역: [README1 — 구현 내용·검증 결과·설치 파일·남은 작업](README1.md)

**현재 개발 방향 (2026-09-27):** 사용자 요청에 따라 Android에서 경로 안내보다 **카메라 기반 위험 요소 관찰**을 우선합니다. v0.4.4 소스에는 반복 탐지·화면 내 위치·영상 크기 변화로 주의 후보를 선정하는 실험적 알고리즘과 화면·음성 연결을 구현했습니다. 실제 거리·충돌 확률·횡단 가능 여부를 계산하지 않으며 실기기 인식 성능은 아직 검증하지 않았습니다. 아래는 원래 해커톤 기획을 보존한 내용입니다. 현재 구현 범위와 한계는 [위험 요소 관찰 설계](docs/hazard-awareness.md)와 README1의 최신 기록을 기준으로 확인합니다.

**Voice-first, noise-aware navigation with optional AI visual assistance for blind and low-vision users.**

## Implementation quick start

Track implemented modules and remaining app work in [CHECKLIST.md](CHECKLIST.md).

Code is separated into two folders:

- [mobile/src/legacy/](mobile/src/legacy/README.md): preserved simulation and wake-word prototypes; not imported by the running app.
- [backend/](backend/README.md): FastAPI server, route data, persistence, and tests.
- [docs/](docs/team-integration.md): shared API and team integration guide.

Backend APIs and independent mobile voice/navigation/noise modules are now available.
See [팀 연결 및 실행 가이드](docs/team-integration.md) for setup, API contracts, frontend integration, and tests.
The included graph is fictional and simulation-only. Storage currently uses local SQLite;
Supabase, native recording/playback adapters, camera analysis, and live GPS guidance are not yet integrated.
The roadmap below remains the original MVP plan, not a claim that every feature is implemented.

> Hackathon prototype · 3–4 developers · 24 hours  
> **Safety:** SENSEA is an experimental information aid, **not** a mobility aid or obstacle-avoidance system. Do not use it to decide whether a street crossing or route is safe. Test navigation in a controlled setting, not blindfolded in traffic. A camera description is not evidence that a route is clear.

## 1. Problem and solution

Traditional maps optimize for time or distance, but do not always provide the hands-free interaction, nearby landmark descriptions, or environmental preferences that a blind user may want. SENSEA combines:

1. **Voice-first operation:** Set a destination, compare routes, start/pause navigation, and request a repeated instruction using speech; every essential action must also work with VoiceOver/TalkBack and standard controls.
2. **Noise-aware routes:** Collect opt-in, short-duration microphone measurements and rank *verified pedestrian routes* by travel distance and relative noise. **Noise is not a reliable crowd counter**; label routes as “lower measured noise,” not “fewer people.”
3. **Turn-by-turn guidance:** Read verified waypoint instructions aloud; if location accuracy is poor, announce uncertainty rather than precise directions.
4. **Optional camera assistant:** While stopped, the user requests a snapshot or periodic frame analysis to identify signs, building names, or entrances, and hears a short description. Do not promise live hazard detection, collision avoidance, or safe crossing decisions.

**MVP scope:** A small, manually checked campus area with 2–3 destinations, at least two route alternatives, a few measured noise segments, voice UI, simulated waypoint progression, and camera-based landmark description. No wheelchair-specific routing in this version.

## 2. Recommended app stack

**Build a mobile app with Expo + React Native + TypeScript**, not a browser-only PWA. Expo accelerates cross-platform development and allows real-phone demos. Use **FastAPI + Python** for route computation and the camera-analysis API, and **Supabase Postgres** for places, paths, and aggregate noise observations. Keep routing deterministic; use a vision-capable AI model only to *describe* snapshots, not to generate navigable paths.

| Layer | Recommendation | Why |
|---|---|---|
| Mobile frontend | Expo, React Native, TypeScript, Expo Router | iOS/Android app, shared codebase, accessible native controls |
| UI/accessibility | React Native `accessibilityLabel`, `accessibilityRole`, `AccessibilityInfo`; large touch targets | VoiceOver/TalkBack support |
| Voice output | `expo-speech` | Read navigation instructions aloud |
| Voice input | Native speech-recognition Expo-compatible module **only after verifying Expo SDK and device support**; otherwise a press-to-record flow using `expo-audio` + backend speech-to-text | Speech recognition is the main platform risk; avoid assuming browser Web Speech API works in native apps |
| Camera | VisionCamera 5 + fast-tflite | Native Android/iOS frames with local object detection; see mobile/README.md |
| Location | `expo-location` | GPS with reported accuracy |
| Map | `react-native-maps` (if compatible with chosen Expo SDK) | Visual fallback for sighted/low-vision users; map must not be the sole UI |
| Backend | FastAPI, Python 3.11+ | Clear API contracts and easy route algorithms |
| Data | Supabase Postgres | Places, graph edges, timestamped noise summaries |
| Camera AI | Server-side vision-capable model API | Keep API keys off the phone; return short, uncertainty-aware descriptions |
| Deployment | Expo development build on demo phones; backend on Render/Railway/Fly.io or other available host | Avoid last-minute native module surprises |

**Important native-module check:** Expo Go does not support every native library. On the first hour, test voice input and microphone metering on the *actual demo phone*. If speech recognition fails, use a large press-to-record button with backend transcription; if that also fails, use accessible typed search and preserve voice *output*.

## 3. MVP features and acceptance criteria

### P0 — Must ship

- [ ] **Accessible home:** “Where would you like to go?”; destination search, microphone button, recent destinations. Every control has a readable label, role, and logical focus order.
- [ ] **Voice commands:** At minimum, “Take me to [destination],” “Start navigation,” “Repeat,” “Pause,” and “Describe surroundings.” Confirm the recognized destination aloud before navigation.
- [ ] **Campus graph:** 2–3 buildings, checked pedestrian waypoints, two alternative paths, entrance coordinates, and route descriptions. Mark unknown data as unknown.
- [ ] **Noise-aware routing:** Opt-in measurements for at least two segments; display/announce a *relative noise index* and measurement freshness. Route alternatives must never be invented from LLM output.
- [ ] **Guidance:** Spoken step-by-step instructions; repeat/pause; simulation mode for the demo. Handle location-permission denial and poor GPS accuracy.
- [ ] **Camera assistant:** User-initiated still image → backend vision analysis → spoken landmark/sign/entrance description, including “I cannot tell” when uncertain. Must work without continuous video.
- [ ] **Privacy:** No audio recording stored by default; no raw camera frames retained by default; explicit permission and clear on/off state. Coarsen or aggregate shared location observations.

### P1 — Only if P0 is stable

- [ ] Short-interval camera snapshots **while stationary**, with a visible/audible stop control and rate limit.
- [ ] Optional haptic cues for simple turn notifications; never require haptics to use the app.
- [ ] Community-submitted temporary obstructions, clearly marked **unverified** until checked.
- [ ] Simple natural-language route explanation: “This route is 2 minutes longer but has lower measured noise.”

### Out of scope for the hackathon

Real-time collision avoidance; traffic-light/crosswalk safety judgments; reliable crowd-density detection from audio; unverified whole-campus navigation; guaranteed accessible/safe routes; autonomous navigation without a cane, guide dog, or existing mobility practice.

## 4. User journey

1. Open app; VoiceOver/TalkBack announces the main controls. App asks: “Where would you like to go?”
2. Speak or type a destination. App repeats its interpretation and requests confirmation.
3. Backend finds **verified pedestrian graph** paths and returns a shortest and lower-noise alternative, including uncertainty and data age.
4. App reads both choices and lets user choose by voice or accessible buttons.
5. Navigation reads the next waypoint instruction. If GPS accuracy is insufficient, app requests manual confirmation or offers demo simulation; it must not assert an exact turn.
6. Near the destination, user **stops walking**, requests “Describe surroundings,” and points the phone camera. App speaks a concise landmark description and its uncertainty.
7. User can repeat, pause, stop, or switch to manual controls at any time.

## 5. Architecture

```text
Expo React Native app (TypeScript)
 ├── Accessible UI / voice command controller
 ├── expo-speech (spoken feedback)
 ├── Speech-to-text adapter (native or record + backend)
 ├── expo-location (GPS + accuracy)
 ├── expo-camera (user-triggered snapshot)
 ├── Microphone noise-meter adapter (device-tested native implementation)
 └── API client
          │ HTTPS
          ▼
FastAPI backend (Python)
 ├── /places             destination lookup
 ├── /routes             deterministic shortest / noise-aware paths
 ├── /noise              consented, aggregated noise observations
 ├── /vision/describe    server-side vision model
 └── /speech/transcribe  optional fallback speech-to-text
          │
          ▼
Supabase Postgres
 ├── places
 ├── waypoints
 ├── path_edges
 └── noise_observations (aggregated/coarsened)
```

Do not call an AI model directly from the mobile client using a secret API key. Rate-limit costly vision/transcription endpoints and validate upload size and MIME type.

## 6. Data model

Suggested minimal schema (SQL types illustrative):

```sql
create table places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  entrance_notes text,
  verified_at timestamptz
);

create table waypoints (
  id text primary key,
  latitude double precision not null,
  longitude double precision not null,
  landmark_description text,
  verified_at timestamptz
);

create table path_edges (
  id text primary key,
  from_waypoint text references waypoints(id),
  to_waypoint text references waypoints(id),
  distance_m double precision not null check (distance_m > 0),
  pedestrian_verified boolean not null default false,
  instruction text,
  bidirectional boolean not null default true
);

create table noise_observations (
  id uuid primary key default gen_random_uuid(),
  edge_id text references path_edges(id),
  relative_noise double precision not null check (relative_noise between 0 and 1),
  observed_at timestamptz not null default now(),
  device_class text
);
```

Use only pedestrian-verified edges for the live demo. In a real deployment, add row-level security, retention limits, abuse controls, and a review workflow for community contributions. Store *summaries*, not raw microphone audio. An uncalibrated phone measurement is **not** a certified dB SPL reading.

## 7. API contract

| Method | Endpoint | Request | Response |
|---|---|---|---|
| GET | `/places?q=library` | Search query | Place IDs, names, coordinates |
| POST | `/routes` | `start_waypoint`, `end_waypoint`, `noise_preference` | Alternatives, segments, distance, relative noise, freshness |
| POST | `/noise` | `edge_id`, `relative_noise`, `consent` | Accepted / rejected |
| POST | `/vision/describe` | JPEG image, optional expected place | Concise description, recognized text, uncertainty |
| POST | `/speech/transcribe` | Short audio file, if needed | Transcript |

Example route request:

```json
{
  "start_waypoint": "start",
  "end_waypoint": "library_entrance",
  "noise_preference": "quiet"
}
```

Example route response (illustrative only):

```json
{
  "routes": [
    {
      "id": "quiet-route",
      "distance_m": 610,
      "relative_noise": 0.28,
      "noise_data_status": "measured",
      "segments": [
        { "from": "start", "to": "quad", "instruction": "Continue to the next verified landmark." },
        { "from": "quad", "to": "library_entrance", "instruction": "The library entrance is at the next waypoint." }
      ]
    }
  ]
}
```

## 8. Routing implementation

Represent verified paths as a graph. For each edge, store distance and an aggregated noise score in `[0, 1]`. For the **shortest route**, edge cost is distance. For the **quiet route**, use a transparent weighted cost, for example:

```python
# backend/app/routing.py
import heapq
from math import inf


def shortest_path(graph, start, goal, noise_weight=0.0):
    """graph[node] = [(neighbor, distance_m, noise_score), ...].
    noise_weight expresses the distance penalty for a maximally noisy edge.
    All graph edges must be verified pedestrian paths.
    """
    queue = [(0.0, start)]
    best = {start: 0.0}
    previous = {}

    while queue:
        cost, node = heapq.heappop(queue)
        if cost > best.get(node, inf):
            continue
        if node == goal:
            path = [goal]
            while path[-1] != start:
                path.append(previous[path[-1]])
            return list(reversed(path)), cost

        for neighbor, distance_m, noise_score in graph.get(node, []):
            # Scale the noise penalty by segment distance.
            next_cost = cost + distance_m * (1 + noise_weight * noise_score)
            if next_cost < best.get(neighbor, inf):
                best[neighbor] = next_cost
                previous[neighbor] = node
                heapq.heappush(queue, (next_cost, neighbor))

    return None, inf
```

Here `noise_weight` is a dimensionless multiplier. Missing measurements should carry an `unknown` status rather than silently receiving a zero-noise score. Always explain when the quieter route is longer and how recent its measurements are.

## 9. Mobile app implementation starter

Current project layout (two application directories):

```text
SENSEA/
├── backend/                    # Python APIs and server tests
├── mobile/
│   ├── app/                    # Expo Router UI screens
│   ├── src/navigation/         # UW/Google routes, GPS, voice/haptics
│   ├── src/camera/             # Integrated camera provider
│   ├── src/vision/             # On-device image analysis
│   ├── src/auth/               # Supabase accounts
│   ├── src/noise/              # Foreground sound measurement
│   ├── src/components/         # Shared UI
│   ├── src/legacy/             # Preserved independent prototypes and tests
│   └── package.json
├── docs/                       # Shared documentation
└── .github/                    # CI workflows
```

Bootstrap commands:

```bash
# Existing mobile camera app (native development build, not Expo Go)
cd mobile
npm ci
npm run models:download
npm run android -- --device
# On macOS with Xcode: npm run ios -- --device

# Backend (separate terminal, from project root)
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install fastapi 'uvicorn[standard]' supabase python-multipart httpx
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Minimal accessible voice-output screen (`mobile/app/index.tsx`):

```tsx
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, AccessibilityInfo } from 'react-native';
import * as Speech from 'expo-speech';

export default function HomeScreen() {
  const [destination, setDestination] = useState('');

  const confirmDestination = () => {
    const name = destination.trim();
    if (!name) {
      Speech.speak('Please enter a destination.');
      return;
    }
    Speech.speak(`You selected ${name}. Confirm before starting navigation.`);
    AccessibilityInfo.announceForAccessibility(`Destination: ${name}`);
    // TODO: look up place, show accessible confirmation, then request routes.
  };

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 20, backgroundColor: '#101827' }}>
      <Text accessibilityRole="header" style={{ color: 'white', fontSize: 32, fontWeight: '700' }}>
        SENSEA
      </Text>
      <Text style={{ color: 'white', fontSize: 24 }}>Where would you like to go?</Text>
      <TextInput
        accessibilityLabel="Destination"
        accessibilityHint="Type a building or location"
        placeholder="Search destination"
        placeholderTextColor="#666"
        value={destination}
        onChangeText={setDestination}
        style={{ backgroundColor: 'white', padding: 18, borderRadius: 12, fontSize: 20 }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Confirm destination"
        onPress={confirmDestination}
        style={{ backgroundColor: '#A7F3D0', padding: 20, borderRadius: 12, minHeight: 60 }}
      >
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#064E3B' }}>Confirm destination</Text>
      </Pressable>
      {/* Add a speech-input button after verifying microphone/STT on the demo phone. */}
    </View>
  );
}
```

**Voice command state machine:** `IDLE → LISTENING → CONFIRM_DESTINATION → ROUTE_SELECTION → NAVIGATING → CAMERA_ASSIST → NAVIGATING`. Every state must support “Repeat,” “Back,” and “Stop” where applicable. Pause speech recognition while the app is speaking to avoid transcribing its own voice.

**Camera flow:** Ask permission → tell the user to stop walking → take a snapshot → send over HTTPS to `/vision/describe` → read a brief response → discard image unless explicit retention consent is given. For the demo, prioritize signs and door labels; do not issue precise walking or safety instructions from image interpretation alone.

**Noise flow:** Ask for microphone permission separately → collect a short sample → compute relative RMS or use a device-tested metering library → aggregate by known route segment → upload only the summary. Microphone APIs and background recording vary by OS; do not promise passive always-on collection.

## 10. 24-hour build schedule

| Time | Team milestone | Exit criterion |
|---|---|---|
| 0–2 h | Choose 2–3 campus destinations, test native permissions/voice, define API | One real phone can speak, open camera, and request permissions |
| 2–8 h | Parallel: UI/voice, graph routing, camera AI, noise collection | Each module works independently |
| 8–12 h | Integrate destination → routes → spoken instructions | Complete simulated journey |
| 12–16 h | Add measured noise to routing; connect camera descriptions | Quiet route changes with test data; camera reads a sign |
| 16–20 h | Test with VoiceOver/TalkBack and real device; handle failure modes | No essential screen requires visual interaction |
| 20–24 h | Freeze scope, rehearse demo, deploy backend, record fallback demo | Repeatable 3-minute demonstration |

### Ownership

- **Developer 1 — Mobile/accessibility:** Expo app, voice command flow, accessible screens, screen-reader tests.
- **Developer 2 — Routing/maps:** Verified campus graph, shortest/quiet paths, route API, guidance waypoints.
- **Developer 3 — Camera AI:** Camera capture, server-side vision integration, uncertainty handling, spoken descriptions.
- **Developer 4 — Noise/data/integration:** Metering proof of concept, aggregation, Supabase, integration tests. For a 3-person team, Developer 2 owns noise weighting and Developer 1 owns DB integration.

Agree on request/response schemas before coding in parallel. Make a working end-to-end skeleton by hour 8; do not wait until every feature is polished to integrate.

## 11. Tests and demo

**Accessibility checks:** VoiceOver (iOS) or TalkBack (Android) can find every button, search destinations, compare routes, repeat instructions, pause navigation, and trigger camera capture. Dynamic announcements must not overlap endlessly. Provide a typed fallback for noisy environments.

**Failure checks:** Deny camera/microphone/location permission; disconnect the network; provide an unknown destination; provide stale noise data; return an uncertain vision result; simulate poor GPS accuracy. Each case needs an understandable spoken or screen-reader-accessible fallback.

**3-minute demo:**

1. Speak or enter a campus destination; SENSEA repeats it for confirmation.
2. Compare shortest and lower-measured-noise routes; explain that noise is a proxy for sound environment, **not proof of low crowd density**.
3. Start a **simulated** route and hear waypoint instructions.
4. Stop at a prepared sign/door, request a camera description, and hear the recognized text.
5. Close with what is real in the prototype versus what requires user testing, calibrated sensing, and verified route coverage.

## 12. Privacy and safety rules

구현 상태: 앱 내 안내·권한·중지·현재 결과 지우기, 화면 읽기와 자동 음성 조정, 사진 외부 전송 동의·임시 파일 정리 계약, 소음 자동 만료, 경로 검증 기한을 구현했습니다. 실제 기기·현장·당사자 검토는 완료하지 않았습니다. [구현 범위](docs/privacy-and-safety.md) · [기기/사용자 시험 계획](docs/accessibility-test-plan.md).

- Ask permission only when a feature needs it; show microphone/camera active state and a clear stop action.
- Do not store raw audio or photos by default; never expose secret API keys in the app.
- Aggregate and expire location-linked noise measurements; avoid publishing individual user movement traces.
- Camera AI can hallucinate or miss obstacles. It cannot confirm that a path is clear, a road is safe to cross, or a door is accessible.
- Use manually verified pedestrian segments in the prototype; unknown or stale route information must be described as uncertain.
- Invite blind/low-vision users or accessibility specialists to review the interaction design when feasible. Blindfolded developer testing is not a substitute for lived-experience feedback.

## 13. Definition of done

The hackathon MVP is complete when a tester can use accessible controls or speech to select a destination, hear and choose between verified route alternatives informed by measured noise, follow a simulated spoken journey, and request a spoken camera description of a stationary landmark. The team must also be able to explain the limits of its location, noise, and AI measurements without claiming real-world navigation safety.


## Backend implementation

A runnable FastAPI foundation is available in [backend/README.md](backend/README.md), with setup instructions, API examples, tests, and an initial Supabase schema. The included route/noise dataset is synthetic and simulation-only; camera descriptions require a configured server-side model key. Supabase persistence and speech transcription remain integration points.

### Camera processing modules

The [Android/iPhone camera app](mobile/README.md) connects native live frames, local quality checks, EfficientDet Lite0 object detection, and Korean speech. It drops frames while busy, limits analysis to 5 Hz, and releases camera/model resources on close or background. See [real-time frame handling](docs/realtime-camera.md) for ownership and verification limits. Road/sidewalk segmentation, distance estimation, GPS navigation UI, and the stationary server-description flow remain separate integration work; the earlier sections describe the broader product roadmap.
