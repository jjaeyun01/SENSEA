# Legacy mobile prototypes

These TypeScript modules were moved from the former frontend directory. The running Expo app does not import them. Keep them separate from the current JourneyProvider, feedback, auth, and campus API contracts.

- api/client.ts: client for the backend's fictional graph, edge noise, and raw-audio transcription API. It is not the UW/Google campus client.
- navigation/session.ts: manual simulation state machine; no live GPS guidance.
- voice/commands.ts and controller.ts: adapter-based prototype command flow with its original command types.
- voice/wakeWordSession.ts: foreground wake-word coordination; native detection and microphone adapters are still required.
- noise/noiseMeter.ts: original relative sound summarizer for the edge-noise prototype.

Current equivalents are in src/navigation, src/voice, and src/noise. This move preserves existing contracts and wake-word work without replacing the application's existing implementations. Tests live in tests/ and run with `npm run test:ui` from mobile, alongside the production TypeScript tests.
