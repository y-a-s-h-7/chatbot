/**
 * The single source of truth adapters read credentials from.
 *
 * The settings store pushes a snapshot in here, so adapters never import the
 * store (no cycles) and never touch localStorage directly. Keys held here are
 * either persisted (user ticked "Remember on this device") or memory-only.
 */

import { ProviderError } from '../providers/errors';
import type { ProviderId } from '../providers/providers';

export interface CredentialSnapshot {
  /** providerId -> api key */
  keys: Partial<Record<ProviderId, string>>;
  /** providerId -> connected via OAuth */
  connected: Partial<Record<ProviderId, boolean>>;
  /** Base URL for the OpenAI-compatible "custom" provider. */
  customBaseUrl: string;
  /** Base URL for a local Ollama-compatible runtime. */
  ollamaBaseUrl: string;
}

const EMPTY: CredentialSnapshot = { keys: {}, connected: {}, customBaseUrl: '', ollamaBaseUrl: '' };

/**
 * A plain snapshot is enough (and keeps this module dependency-free): adapters
 * read it at call time, so a newly pasted key is picked up by the very next
 * request without any pub/sub wiring to leak listeners.
 */
let snapshot: CredentialSnapshot = { ...EMPTY };

export function setCredentials(next: CredentialSnapshot): void {
  snapshot = next;
}

export function getCredentials(): CredentialSnapshot {
  return snapshot;
}

/** Stable non-empty check so we never send `Authorization: Bearer ` with nothing. */
export function getKey(providerId: ProviderId): string | undefined {
  const value = snapshot.keys[providerId];
  return value && value.trim() ? value.trim() : undefined;
}

/** Throws a friendly, actionable error instead of a 401 round trip. */
export function requireKey(providerId: ProviderId, providerLabel: string, keyUrl?: string): string {
  const key = getKey(providerId);
  if (key) return key;
  throw new ProviderError(
    'not_configured',
    `**${providerLabel}** needs an API key. Open Settings → Providers to paste one — it stays in this browser.`,
    {
      providerLabel,
      retryable: false,
      action: keyUrl ? { label: 'Get a key', href: keyUrl } : undefined,
    },
  );
}

/** Never render more than a hint of a key back to the user. */
export function maskKey(key: string | undefined): string {
  if (!key) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '•'.repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}${'•'.repeat(Math.min(18, Math.max(6, trimmed.length - 8)))}${trimmed.slice(-4)}`;
}
