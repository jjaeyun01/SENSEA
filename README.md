# SENSEA

SENSEA is a voice-first campus walking guidance app for blind and low-vision users. It provides destination search, route comparison, GPS guidance, and on-device camera observations on iPhone and Android.

The current `main` branch integrates an Expo Router app with a FastAPI server. The mobile version is **0.4.12**. This document describes the code implemented as of September 27, 2026.

## Implemented features

### Destination search and user accounts

- Search UW–Madison buildings and their departments, dining locations, libraries, and InfoLabs.
- Request routes immediately when there is one search result; when there are multiple results, request routes after selection. The separate address-confirmation step has been reduced.
- Supabase email registration and login, Google login, session restoration, and logout.
- Save and retrieve user profiles, preferences, saved places, recent destinations, and route history.
- Display the signed-in user's recent destinations at the top of the home screen.
- Password reset and change, user data export and deletion, and account deletion. These require the corresponding database migrations and authentication provider configuration.

### Maps and walking routes

- Display Google Maps and request walking routes through the Google Routes API.
- Compare alternative routes by duration and distance, and rank them using user preferences.
- When verified conditions are supplied, account for stairs, slopes, obstacles, construction, mixed traffic, and crossing conditions; exclude routes with verified closures.
- Apply a limited preference for lower measured noise during the day and lighting data or active-sound preferences at night.
- Noise weighting requires fresh observations, at least 70% route coverage, 10 measurements, and 3 contributors. Noise alone does not establish crowd size or crime safety.
- Foreground GPS guidance, spoken directions, directional vibration, pause, resume, and replay.
- GPS jump filtering, rejection of stale or inaccurate positions, repeated off-route confirmation, and automatic rerouting.
- Use entrance proximity only when surveyed entrance data is complete. Otherwise, describe proximity to a representative building point.
- Cache recent routes on-device and recover them after network failures. Cached routes may not reflect current construction or closures.

Converting the UW slope PDF and campus-wide lighting and obstacle data into a real pedestrian graph is not complete. Although the ranking algorithm is implemented, it does not label conditions as verified when the Google route lacks supporting verified data.

### Voice and noise

- Handle destination, route-selection, and navigation commands through OS speech recognition, with text and button alternatives.
- Coordinate shared speech output to reduce overlapping announcements and conflicts between recognition and playback.
- Use the server transcription API when a separate OpenAI key is configured.
- Measure environmental sound on-device and support consent-based noise-map contributions.
- Store consent state and numeric measurements associated with coarse location grids in Supabase, and retrieve aggregated noise data.
- Provide clearly identified demo noise data as a fallback when measured map data is insufficient.

Phone noise readings are not calibrated dB SPL measurements. Simultaneous microphone and speech-recognition use, as well as actual audio output, requires device-specific testing.

### Camera and obstacle observations

- Live rear-camera preview through VisionCamera, image-quality checks, and on-device EfficientDet Lite0/TFLite object detection.
- Limit analysis to 5 Hz and discard frames while processing to bound workload.
- Experimentally classify attention cues using repeated detections, image position, apparent size changes, and near-field candidate confirmation.
- Display object boxes and attention cues, with English observation announcements and vibration. Excluding people from automatic speech is separate from detection and attention classification.
- Release input and resources when the camera closes or the app enters the background, and support retries.
- Connect an ONNX urban-object model and ML Kit OCR to the Android navigation screen for expanded analysis, pedestrian-signal candidates, countdown observations, and STOP surroundings-scan guidance.
- Copy the approximately 99 MB expanded model into native Android assets. iOS uses the existing TFLite analysis and does not support the Android expansion.

The app does not calculate physical distance, collision probability, walkable space, or crossing clearance. Final end-to-end validation of pedestrian-signal digit recognition is incomplete. Camera object detection is not VPS, and no actual VPS provider linked to a surveyed spatial map is supplied by default.

## Data and architecture

```text
mobile/ — Expo Router · React Native · TypeScript
 ├─ Supabase Auth and RLS → users, preferences, history, UW directory, noise
 ├─ FastAPI /campus → UW search fallback and Google walking routes
 ├─ Google Maps SDK → map display
 ├─ OS speech recognition, expo-speech, expo-location → commands, guidance, GPS
 └─ VisionCamera → local TFLite / Android ONNX and OCR

backend/ — FastAPI · Python
 ├─ app.main → campus routes, noise, optional speech transcription
 └─ app.foundation → separate image-quality and experimental server vision API
```

The mobile app connects to Supabase using a publishable key and RLS. The current FastAPI default storage uses SQLite and experimental data, without a Supabase storage adapter. The live camera does not call the server photo-analysis API.

Data collected from the official UW map is stored in `backend/data/uw-buildings/`.

- **219 building map entries:** 216 buildings and 3 partial-building entries. This is not a count of every physical building owned by UW.
- **589 facility entries:** 506 departments, 49 dining locations, 25 libraries, and 9 InfoLabs. A facility can appear in multiple categories.
- Building and facility JSON, CSV, and repeatable Supabase import SQL.
- Building names and coordinates are distinguished from surveyed entrance information.

See the [UW data documentation](backend/data/uw-buildings/README.md) for collection, refresh, and import instructions.

## Repository structure

| Path | Purpose |
| --- | --- |
| `mobile/app/` | Home, destination, routes, navigation, camera, settings, and account screens |
| `mobile/src/` | Authentication, APIs, GPS, camera, noise, and app state |
| `mobile/native/urban-vision/` | Native Android ONNX and OCR implementation |
| `mobile/src/legacy/` | Early prototypes not used by the current app |
| `backend/app/` | FastAPI and routing, noise, and photo-analysis modules |
| `backend/migrations/` | Supabase schema, RLS, and user data management SQL |
| `backend/data/` | UW catalog, entrance inputs, and fictional graphs |
| `docs/` | Feature designs, integration notes, and test records |

There is no separate active `frontend/` folder. The UI lives in `mobile/`. `mobile/App.tsx` re-exports the Expo Router layout; `CameraSmokeApp.tsx` is the standalone camera test entry point.

## Setup and execution

Use Node.js 22 and Python 3.12 or later. iOS requires macOS, Xcode, and CocoaPods; Android requires the Android SDK and JDK. Native camera modules mean **the app cannot run in Expo Go**.

### 1. Environment variables and database

```sh
cp backend/.env.example backend/.env
cp mobile/.env.example mobile/.env
```

| File | Main settings |
| --- | --- |
| `backend/.env` | `GOOGLE_ROUTES_API_KEY`, `SENSEA_WRITE_TOKEN`; `OPENAI_API_KEY` for server transcription |
| `mobile/.env` | `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_API_TOKEN`, platform-specific Maps SDK keys, Supabase URL and publishable key |

`EXPO_PUBLIC_API_TOKEN` must match the server's `SENSEA_WRITE_TOKEN`. On a physical phone, use the Mac's LAN IP instead of `localhost` for the server address and connect both devices to the same network.

Apply Supabase migrations from `backend/migrations/001_initial.sql` through `005_account_management.sql`, then run the UW building and facility import SQL. Google login also requires Supabase provider and app redirect configuration.

`EXPO_PUBLIC_*` values are included in the app. Do not put server API secrets, Supabase service-role keys, or database passwords there. Do not commit actual `.env` files.

### 2. Server

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --env-file .env
```

Inspect the API at `http://localhost:8000/docs`. Run the optional photo-analysis server, `app.foundation:app`, on a separate port.

### 3. Mobile

```sh
cd mobile
npm ci
npm run ios -- --device
# Or:
npm run android
```

Use `npm start` to start only the development server. Rebuild the native app after changes to Maps SDK keys or native plugins. The Android urban-analysis plugin also requires a native rebuild.

## Main server APIs

| API | Purpose |
| --- | --- |
| `GET /health` | Server health |
| `GET /campus/places`, `GET /campus/places/{id}` | UW destination search and details |
| `POST /campus/routes` | Google walking routes |
| `GET /places`, `GET /graph`, `POST /routes` | Fictional graph and routing experiments |
| `GET /noise`, `POST /noise` | Server segment-noise storage and retrieval |
| `POST /speech/transcribe` | Server transcription when configured |
| `POST /demo/routes` | Explicit demo routes |
| `POST /vision/describe` | Optional photo analysis on the foundation server |

User accounts, history, the UW directory, and grid-noise database access use the mobile Supabase modules. See the [team integration guide](docs/team-integration.md) and each server's Swagger documentation for the full contracts.

## Validation and remaining work

```sh
cd mobile
npm run typecheck
npm test
npm run test:ui
npm run export:check

cd ../backend
python -m pytest
```

During the latest merge, mobile type checking, **300 Node tests**, **46 UI/state tests**, iOS and Android bundle exports, and **8 Android test-tool tests** passed. Successful bundle export does not replace native build or physical-device recognition testing.

Remaining work includes surveying campus pedestrian segments, slopes, lighting, and actual entrances; repeated iOS/Android camera, voice, and microphone tests; signal-digit recognition end-to-end validation; and VoiceOver/TalkBack and field reviews with users. The app is an experimental information aid and does not guarantee that a route is safe or free of obstacles.

## Related documentation

- [Integration records](docs/branch-integration.md)
- [Mobile setup and camera](mobile/README.md)
- [Backend documentation](backend/README.md)
- [Navigation behavior and limitations](docs/in-app-navigation.md)
- [Obstacle observation design](docs/hazard-awareness.md)
- [Development summary](DEVELOPMENT_SUMMARY.md)
- [Branch work and build records](README1.md)

README1 and earlier development records include historical standalone camera-app and demo plans. Use this README and the actual `main` code to determine the current integrated app's scope.
