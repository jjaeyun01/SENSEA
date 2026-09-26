"""Small, inspectable image heuristics; not a trained blur or safety detector."""

from io import BytesIO

from PIL import Image, ImageFilter, ImageStat

from app.config import Settings
from app.models import ImageQuality


def assess_quality(jpeg: bytes, settings: Settings) -> ImageQuality:
    # Only accept the bounded, EXIF-free JPEG returned by prepare_image.
    with Image.open(BytesIO(jpeg)) as image:
        if min(image.size) < settings.quality_min_short_side:
            return ImageQuality(
                status="retake",
                reason="low_resolution",
                guidance="사진 크기가 너무 작습니다. 원본 해상도로 다시 촬영해 주세요.",
            )
        gray = image.convert("L")
        gray.thumbnail((512, 512), Image.Resampling.LANCZOS)
        histogram = gray.histogram()
        pixels = gray.width * gray.height
        dark_fraction = sum(histogram[:25]) / pixels
        bright_fraction = sum(histogram[240:]) / pixels
        if dark_fraction >= settings.quality_clip_fraction:
            return ImageQuality(
                status="retake",
                reason="too_dark",
                guidance="사진이 너무 어둡습니다. 멈춘 상태에서 조명과 렌즈 가림을 확인해 주세요.",
            )
        if bright_fraction >= settings.quality_clip_fraction:
            return ImageQuality(
                status="retake",
                reason="too_bright",
                guidance=(
                    "사진이 너무 밝습니다. 멈춘 상태에서 강한 빛이 직접 들어오는지 확인해 주세요."
                ),
            )
        # Exclude filter borders, which otherwise create false detail on flat images.
        edges = gray.filter(ImageFilter.FIND_EDGES).crop((1, 1, gray.width - 1, gray.height - 1))
        edge_mean = ImageStat.Stat(edges).mean[0]
        if edge_mean < settings.quality_min_edge_mean:
            return ImageQuality(
                status="retake",
                reason="low_detail",
                guidance=(
                    "세부 정보가 부족합니다. "
                    "멈춘 상태에서 초점과 촬영 대상을 확인해 다시 찍어 주세요."
                ),
            )
    return ImageQuality(status="usable", reason=None, guidance=None)
