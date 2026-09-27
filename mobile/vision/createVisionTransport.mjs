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
      throw new VisionRequestError("external_consent_required", "Consent is required to send photos to an external AI service.");
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
        401: "Authentication is required for the photo description service.",
        429: "Please request another camera description shortly.",
        503: "The camera description service is not connected yet.",
        504: "The camera description request timed out.",
      };
      throw new VisionRequestError(
        "http_" + response.status,
        messages[response.status] ?? "Could not complete the photo description request.",
      );
    }
    return response.json();
  };
}
