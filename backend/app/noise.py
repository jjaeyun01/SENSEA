"""Local persistent summaries, without audio, user IDs, or movement traces."""
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

FRESH_SECONDS = 3600
RETENTION_DAYS = 7


class NoiseStore:
    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS noise (
                edge_id TEXT NOT NULL, observed_at TEXT NOT NULL,
                relative_noise REAL NOT NULL CHECK(relative_noise BETWEEN 0 AND 1))""")
            db.execute("CREATE INDEX IF NOT EXISTS noise_edge_time ON noise(edge_id, observed_at)")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path)
        try:
            with db:
                yield db
        finally:
            db.close()

    def prune(self, db, now):
        cutoff = (now - timedelta(days=RETENTION_DAYS)).isoformat()
        db.execute("DELETE FROM noise WHERE observed_at < ?", (cutoff,))

    def add(self, edge_id, score, now=None):
        now = now or datetime.now(timezone.utc)
        with self.connect() as db:
            self.prune(db, now)
            db.execute("INSERT INTO noise VALUES (?, ?, ?)", (edge_id, now.isoformat(), score))

    def summaries(self, edge_ids, now=None):
        now = now or datetime.now(timezone.utc)
        cutoff = (now - timedelta(seconds=FRESH_SECONDS)).isoformat()
        result = {}
        with self.connect() as db:
            self.prune(db, now)
            for edge_id in edge_ids:
                score, count, oldest, latest = db.execute(
                    "SELECT AVG(relative_noise), COUNT(*), MIN(observed_at), MAX(observed_at) FROM noise WHERE edge_id=? AND observed_at>=?",
                    (edge_id, cutoff),
                ).fetchone()
                last = db.execute("SELECT MAX(observed_at) FROM noise WHERE edge_id=?", (edge_id,)).fetchone()[0]
                result[edge_id] = {
                    "status": "measured" if count else "stale" if last else "unknown",
                    "relative_noise": score, "sample_count": count,
                    "oldest_observed_at": oldest, "latest_observed_at": latest or last,
                }
        return result
