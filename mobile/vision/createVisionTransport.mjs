import { VisionRequestError } from "./LatestVisionController.mjs";

/** React Native multipart transport. Its API key is a prototype access token. */
export function createVisionTransport({
  baseUrl,
  apiKey = "",
  allowInsecureLocalHttp = false,
  fetchImpl,
  formDataFactory = () => new FormData(),
}) {
  const url = new URL(baseUrl);
  const host = url.hostname;
  const privateHost = host === "localhost" || host === "[::1]" ||
    (/^\d+\.\d+\.\d+\.\d+$/.test(host) &&
      (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
       /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)));
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && privateHost && allowInsecureLocalHttp))) {
    throw new TypeError("Photo upload requires HTTPS; local HTTP must be explicitly enabled.");
  }
  // React Native's XHR-based global fetch ignores redirect: "error".
  // Inject expo/fetch (or a verified standards-compliant implementation).
  if (typeof fetchImpl !== "function") throw new TypeError("A redirect-aware fetch implementation is required.");
  const endpoint = url.toString().replace(/\/+$/, "") + "/vision/describe";
  return async ({ photo, requestId, expectedPlace, signal, externalProcessingConsent = false }) => {
    if (externalProcessingConsent !== true) {
      throw new VisionRequestError("external_consent_required", "외부 AI로 사진을 보내는 데 동의가 필요합니다.");
    }
    const body = formDataFactory();
    body.append("image", {
      uri: photo.uri,
      name: "snapshot.jpg",
      type: photo.mimeType ?? "image/jpeg",
    });
    body.append("stationary", "true");
    body.append("external_processing_consent", "true");
    body.append("request_id", requestId);
    if (expectedPlace) body.append("expected_place", expectedPlace);
    const response = await fetchImpl(endpoint, {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
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
