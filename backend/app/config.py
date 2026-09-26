from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", hide_input_in_errors=True
    )

    storage_backend: Literal["memory", "supabase"] = "memory"
    supabase_url: str = ""
    supabase_secret_key: SecretStr = SecretStr("")
    supabase_timeout_seconds: float = Field(default=10, gt=0, le=60)
    supabase_simulation_only: bool = True

    vision_provider: Literal["disabled", "openai"] = "disabled"
    openai_api_key: SecretStr = SecretStr("")
    openai_vision_model: str = "gpt-4.1-mini"
    sensea_api_key: SecretStr = SecretStr("")
    vision_timeout_seconds: float = Field(default=15, gt=0, le=60)
    vision_requests_per_minute: int = Field(default=6, ge=1, le=60)
    max_image_bytes: int = Field(default=5 * 1024 * 1024, gt=0, le=10 * 1024 * 1024)
    max_image_pixels: int = Field(default=12_000_000, gt=0, le=24_000_000)
    # Prototype heuristics: calibrate with consented phone captures before deployment.
    quality_min_short_side: int = Field(default=192, ge=32, le=1024)
    quality_clip_fraction: float = Field(default=0.85, ge=0.5, le=1)
    quality_min_edge_mean: float = Field(default=1.5, ge=0, le=255)
    noise_ttl_seconds: int = Field(default=3600, ge=1, le=86400)
    cors_origins: list[str] = []

    @model_validator(mode="after")
    def require_keys(self):
        if self.vision_provider == "openai":
            if not self.openai_api_key.get_secret_value():
                raise ValueError("OPENAI_API_KEY is required for openai mode")
            if not self.sensea_api_key.get_secret_value():
                raise ValueError("SENSEA_API_KEY is required for openai mode")
        if self.storage_backend == "supabase":
            if not self.supabase_url.strip():
                raise ValueError("SUPABASE_URL is required for supabase mode")
            try:
                url = urlsplit(self.supabase_url)
                valid_port = url.port is None or 0 < url.port <= 65535
                valid = (
                    url.hostname
                    and valid_port
                    and not url.username
                    and not url.password
                    and not url.query
                    and not url.fragment
                    and url.path in {"", "/"}
                    and (
                        url.scheme == "https"
                        or (
                            url.scheme == "http"
                            and url.hostname in {"localhost", "127.0.0.1", "::1"}
                        )
                    )
                )
            except ValueError:
                valid = False
            if not valid:
                raise ValueError(
                    "SUPABASE_URL must be an HTTPS project origin (HTTP only on loopback)"
                )
            key = self.supabase_secret_key.get_secret_value()
            if not key.strip():
                raise ValueError("SUPABASE_SECRET_KEY is required for supabase mode")
            if key.startswith("sb_publishable_"):
                raise ValueError(
                    "SUPABASE_SECRET_KEY must be a server secret or legacy service_role key"
                )
            if not self.sensea_api_key.get_secret_value().strip():
                raise ValueError("SENSEA_API_KEY is required for supabase mode")
        return self
