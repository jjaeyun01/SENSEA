from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    vision_provider: Literal["disabled", "openai"] = "disabled"
    openai_api_key: SecretStr = SecretStr("")
    openai_vision_model: str = "gpt-4.1-mini"
    sensea_api_key: SecretStr = SecretStr("")
    vision_timeout_seconds: float = Field(default=15, gt=0, le=60)
    vision_requests_per_minute: int = Field(default=6, ge=1, le=60)
    max_image_bytes: int = Field(default=5 * 1024 * 1024, gt=0, le=10 * 1024 * 1024)
    max_image_pixels: int = Field(default=12_000_000, gt=0, le=24_000_000)
    noise_ttl_seconds: int = Field(default=3600, ge=1, le=86400)
    cors_origins: list[str] = []

    @model_validator(mode="after")
    def require_keys(self):
        if self.vision_provider == "openai":
            if not self.openai_api_key.get_secret_value():
                raise ValueError("OPENAI_API_KEY is required for openai mode")
            if not self.sensea_api_key.get_secret_value():
                raise ValueError("SENSEA_API_KEY is required for openai mode")
        return self
