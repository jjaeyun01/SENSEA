"""Deterministic user route-policy helpers.

Noise is a relative sound signal, not evidence of crowd density or safety.
"""


def resolve_noise_preference(local_hour: int, day_start: int = 7, night_start: int = 19) -> str:
    if not 0 <= local_hour <= 23:
        raise ValueError("local_hour must be between 0 and 23")
    if not 0 <= day_start < night_start <= 23:
        raise ValueError("day_start must be earlier than night_start")
    return "quiet" if day_start <= local_hour < night_start else "active"
