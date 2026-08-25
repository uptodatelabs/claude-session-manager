/**
 * Formatting helpers for CLI/TUI output: dates, sizes, tokens, ANSI colors.
 */

/** ANSI color wrapper that is a no-op when not a TTY. */
export function color(enabled: boolean): {
  dim: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  red: (s: string) => string;
  cyan: (s: string) => string;
  bold: (s: string) => string;
} {
  const wrap = (code: string) => (s: string) => (enabled ? `[${code}m${s}[0m` : s);
  return {
    dim: wrap('2'),
    green: wrap('32'),
    yellow: wrap('33'),
    red: wrap('31'),
    cyan: wrap('36'),
    bold: wrap('1'),
  };
}

const isTTY = (): boolean => Boolean(process.stdout.isTTY);

/** A prebuilt colorizer bound to whether stdout is a TTY. */
export const c = color(isTTY());

/** Format a byte size human-readably. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i]!;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

/** Format a token count compactly (e.g. 1.2M). */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

/** Format a dollar amount (unused for cost, kept for future use). */
export function formatMoney(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/** Relative time like "3d ago", "5h ago", "just now". */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** Compact absolute date/time, e.g. "2026-08-01 10:00". */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Truncate to at most n characters, adding an ellipsis. */
export function truncate(s: string, n = 60): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= n) return oneLine;
  return `${oneLine.slice(0, n - 1)}…`;
}

/** Keep only the basename of a path, with a "…/" prefix when it has parents. */
export function shortPath(p: string, maxLen = 40): string {
  if (p.length <= maxLen) return p;
  const tail = p.slice(-(maxLen - 3));
  return `…${tail}`;
}
