from pydantic import BaseModel


class VisionResponse(BaseModel):
    description: str
    is_demo: bool = True
    safety_notice: str


def describe_demo_scene(filename: str | None = None) -> VisionResponse:
    """Return a clearly labelled placeholder until a vision provider is connected."""
    file_note = " 업로드된 이미지 이름을 확인했습니다." if filename else ""
    return VisionResponse(
        description=(
            "데모 설명입니다. 정면에 건물 출입구로 보이는 문과 오른쪽 벽면의 "
            f"표지판이 있습니다.{file_note} 이 설명만으로 이동 안전을 판단하지 마세요."
        ),
        is_demo=True,
        safety_notice="실시간 위험 감지 또는 안전한 경로를 보장하지 않습니다.",
    )

