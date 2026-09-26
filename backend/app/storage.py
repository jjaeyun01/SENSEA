"""Choose a store explicitly. Configuration errors must fail startup."""

from app.config import Settings
from app.db import DemoRepository
from app.repository import Repository


def create_repository(settings: Settings) -> Repository:
    if settings.storage_backend == "memory":
        return DemoRepository(settings.noise_ttl_seconds)
    from app.supabase import SupabaseRepository

    return SupabaseRepository(settings)
