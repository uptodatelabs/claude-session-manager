import { loadIndex, refreshIndex, saveIndex } from '../core/indexer.js';
import type { IndexData, SessionInfo } from '../core/types.js';

/**
 * Shared index loading for commands. Uses the persisted cache and only
 * deep-scans changed session files, then persists back when anything changed.
 *
 * @param force Force a full rescan even when the cache looks fresh.
 * @returns The fresh index and whether a rescan was performed.
 */
export async function loadFreshIndex(
  force = false,
): Promise<{ index: IndexData; scanned: number }> {
  const cached = await loadIndex();
  const hasCache = Boolean(cached.generatedAt);
  if (!hasCache) {
    const { index, scanned } = await refreshIndex(cached);
    await saveIndex(index);
    return { index, scanned };
  }
  if (force) {
    const empty: IndexData = { version: cached.version, generatedAt: '', sessions: {}, projects: {} };
    const { index, scanned } = await refreshIndex(empty);
    await saveIndex(index);
    return { index, scanned };
  }
  const { index, scanned } = await refreshIndex(cached);
  if (index.generatedAt && index.generatedAt !== cached.generatedAt) {
    await saveIndex(index);
  }
  return { index, scanned };
}

/** Find a session by its id (or a unique id prefix). */
export function findSession(
  index: IndexData,
  idOrPrefix: string,
): SessionInfo {
  if (index.sessions[idOrPrefix]) return index.sessions[idOrPrefix]!;
  const matches = Object.values(index.sessions).filter((s) => s.id.startsWith(idOrPrefix));
  if (matches.length === 0) {
    throw new Error(`Session not found: ${idOrPrefix}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous session prefix "${idOrPrefix}" matches ${matches.length} sessions; use a longer prefix.`,
    );
  }
  return matches[0]!;
}

/** Sort sessions for display, newest activity first. */
export function sortByLastTime(sessions: SessionInfo[]): SessionInfo[] {
  return [...sessions].sort((a, b) => (a.lastTime < b.lastTime ? 1 : a.lastTime > b.lastTime ? -1 : 0));
}
