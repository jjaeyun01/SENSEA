# SENSEA Implementation Checklist

Last reviewed: September 26, 2026.

This checklist reflects files in this repository. Work on teammates' machines or branches has not been reviewed. The initial app release supports English only.

## Current status

**Backend APIs and frontend logic modules are implemented. A runnable mobile app and an integrated end-to-end journey are not yet implemented in this repository.**

`[x]` means the specific code or document exists; it does not imply device validation. Device tests, external service checks, and integration are separate unchecked items. Suggested ownership below follows the team's current split; the two frontend teammates can divide their screens as needed.

| Area | Current state | Owner |
|---|---|---|
| Mobile screens and accessibility | Not implemented | Frontend teammates 1 and 2 |
| Voice | Parser, controller, and transcription endpoint implemented; native adapters pending | You + frontend integration |
| Routing | API and deterministic algorithms implemented; fictional graph only | You |
| Noise | Calculation and local persistence implemented; device measurement pending | You |
| Camera | Not implemented in this repository | Camera teammate |
| End-to-end demo | Not integrated or tested on a phone | Everyone |

## 1. Project setup and team contracts

- [x] Separate frontend and backend code into `frontend/` and `backend/`.
- [x] Document backend dependencies, environment variables, and local startup.
- [x] Add frontend API client and response types.
- [x] Document team integration steps in [docs/team-integration.md](docs/team-integration.md).
- [x] Use English for frontend/backend messages, commands, sample destinations, and route instructions.
- [ ] Choose the demo phone, OS, Expo SDK, and development build approach.
- [ ] Initialize the runnable Expo/React Native app with package dependencies and scripts.
- [ ] Agree on the camera module's response/error contract with the camera teammate.
- [ ] Confirm the phone can reach the backend over the demo network.

## 2. Mobile screens and accessibility

Owners: frontend teammates 1 and 2.

- [ ] Build the home screen with destination search and recent destinations.
- [ ] Add an accessible microphone button and visible recording/transcription status.
- [ ] Build destination confirmation and disambiguation screens.
- [ ] Build route comparison with distance, relative noise, coverage, and measurement age.
- [ ] Explain when a noise-weighted alternative is unavailable or not demonstrably quieter.
- [ ] Build navigation controls: start, repeat, pause, resume, stop, and back.
- [ ] Add an explicit simulation indicator and a manual next-waypoint button.
- [ ] Connect the camera screen and return flow.
- [ ] Provide text/button alternatives to every essential voice action.
- [ ] Add readable labels, roles, logical focus order, large touch targets, and scalable text.
- [ ] Handle loading, empty results, network failures, and permission denial in English.
- [ ] Complete a journey with VoiceOver on iOS or TalkBack on Android.

## 3. Voice input, commands, and output

Owner: you, with frontend teammates connecting the UI.

- [x] Parse English destination, confirmation, route selection, start, repeat, pause, stop, back, and surroundings commands. See [commands.ts](frontend/src/voice/commands.ts).
- [x] Keep unrecognized commands from starting navigation.
- [x] Implement injected voice input/output control, last-message repetition, and speech-echo suppression. See [controller.ts](frontend/src/voice/controller.ts).
- [x] Implement `POST /speech/transcribe` with English input language configuration.
- [x] Add transcription timeout, MIME allowlist, 5 MiB upload limit, and English error responses.
- [x] Require a demo bearer token and cap transcription requests per server process.
- [x] Keep the provider API key on the backend and avoid persisting uploaded audio there.
- [ ] Implement native microphone permission and press-to-record/stop adapters.
- [ ] Enforce a short recording duration and delete local recordings after success or failure.
- [ ] Explain external transcription and obtain consent before recording/uploading.
- [ ] Connect recording bytes to transcription and then to the command controller.
- [ ] Implement English speech playback, stop, completion, and cancellation callbacks.
- [ ] Connect every parsed command to actual screen/session actions.
- [ ] Verify real transcription with a configured API key; current provider tests are mocked.
- [ ] Verify recording, playback, interruption, and microphone ownership on the demo phone.

## 4. Route API and campus data

Owner: you.

- [x] Implement `GET /health`, `GET /places`, `GET /graph`, and `POST /routes`.
- [x] Implement deterministic shortest and noise-weighted paths, with duplicate alternatives removed.
- [x] Validate graph edge distances/endpoints and use reverse instructions for reverse traversal.
- [x] Exclude unverified edges in live routing and reject live requests for the demo graph.
- [x] Add three fictional destinations and alternative paths to the library. See [demo-campus.json](backend/data/demo-campus.json).
- [x] Report unknown/stale noise rather than silently treating it as zero noise.
- [x] Recommend a lower-noise alternative only when both compared routes have complete fresh measurements.
- [ ] Select 2–3 actual campus destinations and survey at least two route alternatives.
- [ ] Add real waypoint/entrance coordinates and English landmark descriptions.
- [ ] Record field verification dates and accurate forward/reverse pedestrian instructions.
- [ ] Replace the fictional graph with surveyed data before any real navigation demonstration.

## 5. Navigation state and location

Owners: you + frontend teammates.

- [x] Implement destination confirmation, route selection, start, pause/resume, reset, and simulated arrival states. See [session.ts](frontend/src/navigation/session.ts).
- [x] Reject starting navigation before destination confirmation and route selection.
- [x] Discard pending route responses after a reset or destination change.
- [x] Implement manual simulated waypoint advancement.
- [ ] Connect the navigation state to screens and spoken instructions.
- [ ] Implement location permission handling and GPS accuracy reporting.
- [ ] Provide an uncertain-location message and manual/simulation fallback when GPS is insufficient.
- [ ] Verify the simulated journey on a phone from destination selection to arrival.
- [ ] If live guidance is included later, implement verified waypoint progression and test it in a controlled setting.

## 6. Noise measurement and storage

Owner: you.

- [x] Convert valid dBFS samples into a relative noise index using a power average. See [noiseMeter.ts](frontend/src/noise/noiseMeter.ts).
- [x] Implement `POST /noise` with consent, range, edge ID, and bearer-token checks.
- [x] Implement `GET /noise` with averages, sample counts, and observation timestamps.
- [x] Persist summary observations in SQLite across server restarts.
- [x] Treat measurements older than one hour as stale; prune records older than seven days on access.
- [x] Verify route selection changes with controlled noise inputs.
- [ ] Connect a device-tested native metering adapter and confirm it reports dBFS.
- [ ] Add separate noise-sharing consent, microphone activity status, and stop controls.
- [ ] Prevent command recording and noise measurement from competing for the microphone.
- [ ] Associate each sample with a known route segment.
- [ ] Measure at least two actual segments and collect enough coverage to compare full alternatives.
- [ ] Display/speak measurement freshness and describe the value as relative noise, not crowd density or calibrated dB SPL.
- [ ] Decide whether local SQLite is sufficient for the demo or implement the README's proposed Supabase storage.

## 7. Camera assistance

Owner: camera teammate, with frontend and voice integration.

- [ ] Add camera permission handling and a user-triggered still capture screen.
- [ ] Pause navigation and ask the user to stop walking before capture.
- [ ] Implement `POST /vision/describe` and server-side vision provider integration.
- [ ] Validate image MIME/size, protect provider credentials, and limit requests.
- [ ] Return concise English sign, building, or entrance descriptions with uncertainty.
- [ ] Handle unclear images, provider errors, permission denial, and cancellation.
- [ ] Connect the returned description to voice playback.
- [ ] Avoid default raw image retention and remove local temporary captures.
- [ ] Test with a prepared sign or entrance on the demo phone.

## 8. Verification, privacy, and demo delivery

- [x] Backend automated tests: **11 passed** in the latest run, including routing, consent/auth, persistence, stale data, and mocked transcription behavior.
- [x] Frontend module tests: **5 passed** in the latest run, including English commands, noise calculation, voice control, and navigation state.
- [ ] Add TypeScript type checking and app build validation once the Expo project exists.
- [ ] Test denied microphone, camera, and location permissions on-device.
- [ ] Test offline behavior, unknown destinations, stale noise, poor GPS, and uncertain camera results through the UI.
- [ ] Verify no secret provider keys are bundled in the mobile app.
- [ ] Verify temporary audio/image cleanup and visible stop controls on-device.
- [ ] Deploy the backend to the chosen demo host and configure HTTPS/access settings.
- [ ] Build/install the app on the demo phone and verify deployed API connectivity.
- [ ] Rehearse a repeatable three-minute demo and record a fallback demonstration.
- [ ] Clearly distinguish simulated data, measured data, and real provider calls during the demo.
- [ ] Complete the MVP acceptance journey below.

## MVP acceptance journey

- [ ] Speak or type an English campus destination.
- [ ] Hear the interpreted destination and explicitly confirm it.
- [ ] Hear and choose available route alternatives with distance and noise limitations.
- [ ] Follow a simulated spoken journey, including repeat, pause, resume, and stop.
- [ ] While stationary, request a camera description and hear an English result.
- [ ] Complete the same essential actions with accessible controls and a screen reader.

## Recommended next work

1. Frontend teammates: initialize Expo and build the destination → confirmation → route → simulation screens using the existing modules.
2. You: connect real recording/transcription and English playback; verify them on the chosen phone.
3. Camera teammate: implement snapshot capture and the description endpoint against an agreed contract.
4. You: survey campus paths and collect real noise measurements while frontend integration proceeds.
5. Everyone: integrate one complete journey, then test accessibility, failure states, and demo deployment.

Out of scope for this MVP: collision avoidance, crossing-safety decisions, audio-based crowd counting, and unverified campus-wide navigation.
