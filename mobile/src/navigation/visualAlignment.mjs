const listeners = new Set();
let disconnectSource = null;
let current = null;

export function validateVisualAlignment(value, now = Date.now()) {
  if (!value || value.verified !== true || value.confidence < 0.9 || value.confidence > 1 ||
      !Number.isFinite(value.latitude) || value.latitude < -90 || value.latitude > 90 ||
      !Number.isFinite(value.longitude) || value.longitude < -180 || value.longitude > 180 ||
      !Number.isFinite(value.accuracy) || value.accuracy <= 0 || value.accuracy > 10 ||
      !Number.isFinite(value.timestamp) || value.timestamp > now + 250 || now - value.timestamp > 2000 ||
      typeof value.providerId !== 'string' || !value.providerId.trim() ||
      typeof value.mapId !== 'string' || !value.mapId.trim() ||
      typeof value.anchorId !== 'string' || !value.anchorId.trim()) return null;
  return Object.freeze({
    latitude: value.latitude,
    longitude: value.longitude,
    accuracy: value.accuracy,
    confidence: value.confidence,
    timestamp: value.timestamp,
    verified: true,
    providerId: value.providerId.trim(),
    mapId: value.mapId.trim(),
    anchorId: value.anchorId.trim(),
  });
}

function publish(value) {
  current = validateVisualAlignment(value);
  for (const listener of listeners) listener(current);
}

/**
 * Native VPS integrations register here after matching a camera frame against a
 * surveyed spatial map. Generic object detections must never call this function.
 */
export function connectVerifiedVpsSource(source) {
  if (disconnectSource) throw new Error('A verified VPS source is already connected');
  if (!source || typeof source.subscribe !== 'function') throw new Error('Invalid VPS source');
  const disconnect = source.subscribe(publish);
  if (typeof disconnect !== 'function') throw new Error('VPS source must return a cleanup function');
  let connected = true;
  disconnectSource = () => {
    if (!connected) return;
    connected = false;
    disconnect();
    disconnectSource = null;
    publish(null);
  };
  return disconnectSource;
}

export function subscribeVisualAlignment(listener) {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

export function isFreshVisualAlignment(value, now = Date.now()) {
  return validateVisualAlignment(value, now) !== null;
}
