import type { VerifiedVisualAlignment } from './positionFusion.mjs';

export interface VpsAlignment extends VerifiedVisualAlignment {
  providerId: string;
  mapId: string;
  anchorId: string;
}

export interface VerifiedVpsSource {
  subscribe(listener: (alignment: unknown) => void): () => void;
}

export function validateVisualAlignment(value: unknown, now?: number): VpsAlignment | null;
export function connectVerifiedVpsSource(source: VerifiedVpsSource): () => void;
export function subscribeVisualAlignment(listener: (alignment: VpsAlignment | null) => void): () => void;
export function isFreshVisualAlignment(value: unknown, now?: number): boolean;
