export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function uid(prefix = 'x'): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2, 11);
  return `${prefix}_${random.replace(/-/g, '').slice(0, 16)}`;
}

/** First line of a message, trimmed to something a sidebar row can hold. */
export function titleFromContent(content: string, max = 48): string {
  const firstLine = content.replace(/\s+/g, ' ').trim();
  if (!firstLine) return 'New chat';
  return firstLine.length > max ? `${firstLine.slice(0, max - 1).trimEnd()}…` : firstLine;
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return 'just now';
  if (diff < hour) {
    const value = Math.round(diff / minute);
    return `${value} min ago`;
  }
  if (diff < day) {
    const value = Math.round(diff / hour);
    return `${value} h ago`;
  }
  if (diff < 7 * day) {
    const value = Math.round(diff / day);
    return value === 1 ? 'yesterday' : `${value} days ago`;
  }
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Bytes as a human figure. Used for model downloads and GPU memory, where the
 * number is always an estimate, so it is rounded and prefixed with `~`.
 */
export function formatDataSize(mb: number): string {
  if (mb >= 1000) return `~${(Math.round(mb / 100) / 10).toFixed(1)} GB`;
  return `~${Math.round(mb / 10) * 10} MB`;
}

export function formatContextWindow(tokens: number): string {
  if (!tokens) return '';
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return `${value % 1 === 0 ? value : value.toFixed(1)}M context`;
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K context`;
  return `${tokens} context`;
}

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
