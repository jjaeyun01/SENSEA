from typing import Literal

from pydantic import BaseModel, Field, field_validator


class RouteRequest(BaseModel):
    destination: str = Field(min_length=1, max_length=120)

    @field_validator("destination")
    @classmethod
    def destination_must_not_be_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("destination must not be blank")
        return normalized


class NavigationStep(BaseModel):
    id: str
    instruction: str
    distanceMeters: int = Field(ge=0)
    priority: Literal[0, 1, 2, 3]


class RouteOption(BaseModel):
    id: str
    name: str
    summary: str
    durationMinutes: int = Field(gt=0)
    distanceMeters: int = Field(gt=0)
    hasStairs: bool
    noiseLevel: Literal["낮음", "보통", "높음"]
    steps: list[NavigationStep]


class RoutesResponse(BaseModel):
    destination: str
    routes: list[RouteOption]
    disclaimer: str


def build_demo_routes(destination: str) -> RoutesResponse:
    """Return manually reviewed demo routes for the hackathon flow."""
    normalized_destination = destination.strip()
    routes = [
        RouteOption(
            id="flat-safe",
            name="평지 위주 경로",
            summary="계단 없이 검토된 보행로와 횡단보도를 이용합니다.",
            durationMinutes=5,
            distanceMeters=360,
            hasStairs=False,
            noiseLevel="낮음",
            steps=[
                NavigationStep(
                    id="f1",
                    instruction="정면 12시 방향으로 80미터 직진하세요.",
                    distanceMeters=80,
                    priority=3,
                ),
                NavigationStep(
                    id="f2",
                    instruction="10미터 앞에서 2시 방향 오른쪽 길로 이동합니다.",
                    distanceMeters=10,
                    priority=2,
                ),
                NavigationStep(
                    id="f3",
                    instruction="횡단보도 앞입니다. 신호와 주변 교통을 직접 확인하세요.",
                    distanceMeters=3,
                    priority=1,
                ),
                NavigationStep(
                    id="f4",
                    instruction=f"{normalized_destination} 정문 근처에 도착했습니다.",
                    distanceMeters=0,
                    priority=2,
                ),
            ],
        ),
        RouteOption(
            id="fast",
            name="빠른 경로",
            summary="이동 시간은 짧지만 중간에 계단이 포함됩니다.",
            durationMinutes=3,
            distanceMeters=240,
            hasStairs=True,
            noiseLevel="보통",
            steps=[
                NavigationStep(
                    id="q1",
                    instruction="정면 12시 방향으로 50미터 직진하세요.",
                    distanceMeters=50,
                    priority=3,
                ),
                NavigationStep(
                    id="q2",
                    instruction="3미터 앞에 내리막 계단이 시작됩니다. 난간을 확인하세요.",
                    distanceMeters=3,
                    priority=1,
                ),
                NavigationStep(
                    id="q3",
                    instruction="계단을 내려온 뒤 9시 방향 왼쪽으로 이동하세요.",
                    distanceMeters=0,
                    priority=2,
                ),
                NavigationStep(
                    id="q4",
                    instruction=f"{normalized_destination} 측면 입구 근처에 도착했습니다.",
                    distanceMeters=0,
                    priority=2,
                ),
            ],
        ),
    ]

    return RoutesResponse(
        destination=normalized_destination,
        routes=routes,
        disclaimer=(
            "검토된 해커톤 데모 경로입니다. 현재 교통, 공사, 장애물 또는 "
            "횡단 안전을 보장하지 않습니다."
        ),
    )
