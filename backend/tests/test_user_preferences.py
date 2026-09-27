import pytest

from app.user_preferences import resolve_noise_preference


@pytest.mark.parametrize("hour", range(7, 19))
def test_daytime_prefers_quiet(hour):
    assert resolve_noise_preference(hour) == "quiet"


@pytest.mark.parametrize("hour", [*range(0, 7), *range(19, 24)])
def test_nighttime_prefers_active_sound(hour):
    assert resolve_noise_preference(hour) == "active"


@pytest.mark.parametrize("hour", [-1, 24])
def test_invalid_hour_rejected(hour):
    with pytest.raises(ValueError):
        resolve_noise_preference(hour)
