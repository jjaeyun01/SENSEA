import pytest

from scripts.export_uw_buildings import collect, import_sql


def building(identifier=431):
    return {
        "id": identifier,
        "name": "Memorial Library",
        "object_type": "building",
        "lnglat": [-89.3998, 43.0756],
        "street_address": "728 State St.",
    }


def test_catalog_preserves_upstream_id_and_repeatable_database_id():
    first = collect([building()])
    assert first == collect([building()])
    assert first[0]["uw_map_object_id"] == "431"
    assert first[0]["waypoint_id"] == "uw-building-431"
    assert first[0]["latitude"] == 43.0756
    assert first[0]["longitude"] == -89.3998
    sql = import_sql(first)
    assert "ON CONFLICT(uw_map_object_id) DO UPDATE" in sql
    assert "WHERE waypoints.verified_at IS NULL" in sql
    assert "verified_at=excluded" not in sql


def test_invalid_or_duplicate_catalog_fails_instead_of_importing():
    with pytest.raises(ValueError):
        collect([building(), building()])
    with pytest.raises(ValueError):
        collect([{**building(), "lnglat": [float("nan"), 43]}])
    with pytest.raises(ValueError):
        collect([{**building(), "object_type": "parking_lot"}])
