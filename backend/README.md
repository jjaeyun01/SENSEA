# SENSEA Backend

FastAPI server for route computation, noise summary storage, and speech transcription.
The initial release supports English. Destination names, route instructions, and API messages are in English. Transcription requests specify English (`en`) as the input language; this is not a language detection or translation feature.

```text
backend/
├── app/
│   ├── main.py       # HTTP API and speech transcription
│   ├── routing.py    # Shortest and noise-weighted routes
│   └── noise.py      # SQLite noise summary storage and expiration
├── data/demo-campus.json  # Simulation-only route data
├── tests/test_api.py
├── .env.example
└── requirements.txt
```

Run from this directory (Python 3.11+):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Set SENSEA_WRITE_TOKEN in .env; set OPENAI_API_KEY to enable transcription.
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --env-file .env
```

API documentation: http://localhost:8000/docs

Run tests:

```bash
python -m unittest discover -s tests -v
```

The backend runs independently of the frontend. The default map is fictional and must not be used for real-world navigation.

API contracts and integration steps: [Team integration guide](../docs/team-integration.md).
