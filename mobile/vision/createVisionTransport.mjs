import { VisionRequestError } from "./LatestVisionController.mjs";

/** React Native multipart transport. Its API key is a prototype access token. */
export function createVisionTransport({
  baseUrl,
  apiKey = "",
  fetchImpl = globalThis.fetch,
  formDataFactory = () => new FormData(),
}) {
  const endpoint = baseUrl.replace(/\/+$/, "") + "/vision/describe";
  return async ({ photo, requestId, expectedPlace, signal }) => {
    const body = formDataFactory();
    body.append("image", {
      uri: photo.uri,
      name: "snapshot.jpg",
      type: photo.mimeType ?? "image/jpeg",
    });
    body.append("stationary", "true");
    body.append("request_id", requestId);
    if (expectedPlace) body.append("expected_place", expectedPlace);
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: apiKey ? { "X-API-Key": apiKey } : {},
      body,
      signal,
    });
    // Let fetch set the multipart boundary; never include an OpenAI key here.
    if (!response.ok) {
      const messages = {
        401: "사진 설명 서비스의 인증이 필요합니다.",
        429: "잠시 후 카메라 설명을 다시 요청해 주세요.",
        503: "카메라 설명 서비스가 아직 연결되지 않았습니다.",
        504: "카메라 설명 시간이 초과되었습니다.",
      };
      throw new VisionRequestError(
        "http_" + response.status,
        messages[response.status] ?? "사진 설명 요청을 완료하지 못했습니다.",
      );
    }
    return response.json();
  };
}
