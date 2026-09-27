"""Explicit fr1/fr_num2 walkthrough fixtures, separate from live campus routing."""

from fastapi import APIRouter, HTTPException

from .demo_journey import RouteRequest, UnknownDestinationError, build_demo_routes

router = APIRouter(prefix="/demo", tags=["demo"])


@router.post("/routes")
def routes(body: RouteRequest):
    try:
        return {**build_demo_routes(body.destination).model_dump(), "simulation_only": True}
    except UnknownDestinationError as exc:
        raise HTTPException(404, str(exc)) from exc
