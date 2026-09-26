import warnings
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

from app.errors import APIError

FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


def prepare_image(data: bytes, content_type: str | None, max_pixels: int) -> bytes:
    if content_type not in FORMATS.values():
        raise APIError(415, "unsupported_image", "JPEG, PNG, WebP 이미지를 보내 주세요.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as source:
                if FORMATS.get(source.format) != content_type:
                    raise APIError(415, "unsupported_image", "파일 형식과 Content-Type이 다릅니다.")
                if source.width * source.height > max_pixels:
                    raise APIError(413, "image_too_large", "이미지 해상도 제한을 초과했습니다.")
                if getattr(source, "n_frames", 1) != 1:
                    raise APIError(415, "animated_image", "정지 이미지 한 장을 보내 주세요.")
                source.load()
                oriented = ImageOps.exif_transpose(source).convert("RGB")
                oriented.thumbnail((1536, 1536))
                clean = Image.new("RGB", oriented.size)
                clean.paste(oriented)
                output = BytesIO()
                clean.save(output, format="JPEG", quality=85)
                return output.getvalue()
    except APIError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise APIError(413, "image_too_large", "이미지 해상도 제한을 초과했습니다.") from exc
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise APIError(422, "invalid_image", "이미지를 읽을 수 없습니다.") from exc
