# SENSEA Frontend

Mobile TypeScript modules for the English-only initial release. The frontend team will add Expo screens and native recording and playback adapters.

```text
frontend/
├── src/
│   ├── api/client.ts          # Backend HTTP client and response types
│   ├── voice/commands.ts      # English voice command parsing
│   ├── voice/controller.ts    # Voice input and output control
│   ├── navigation/session.ts  # Destination confirmation, routes, and simulation
│   └── noise/noiseMeter.ts    # Device noise measurement summaries
└── tests/modules.test.ts
```

Run module tests from this directory (Node 22.7+):

```bash
node --experimental-transform-types --test tests/modules.test.ts
```

Pass the backend URL to `SenseaApi`. On a physical phone, use your development computer's LAN IP. Never put the server's `OPENAI_API_KEY` in this folder.

There is no Expo app or package.json yet; these tests run directly with Node. Preserve the existing `src/` and `tests/` directories when setting up the Expo project. Configure native speech recognition and playback for English when connecting the audio adapters.

Supported commands include “Take me to library,” “Yes,” “Start navigation,” “Repeat,” “Pause,” “Stop,” “Back,” “Describe surroundings,” “Shortest route,” and “Quiet route.”

API contracts and integration steps: [Team integration guide](../docs/team-integration.md).
