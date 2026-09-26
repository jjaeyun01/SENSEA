"""Replaceable, privacy-preserving still-image description adapter."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class VisionResult:
    description: str
    recognized_text: str | None
    uncertainty: float
    provider_mode: str


def describe_image(image: bytes, expected_place: str | None = None) -> VisionResult:
    del image  # processed in memory and discarded; no raw-image retention
    place = expected_place.strip() if expected_place and expected_place.strip() else None
    if place:
        return VisionResult(f"Demo visual description, not live AI analysis: a sign may identify the entrance as {place}. I am not certain; please do not use this to judge whether it is safe to proceed.", place, 0.35, "demo-mock")
    mode = "demo-mock" if not os.getenv("VISION_API_KEY") else "demo-mock-provider-not-connected"
    return VisionResult("Demo visual description, not live AI analysis: I cannot tell what is shown in the image.", None, 1.0, mode)
