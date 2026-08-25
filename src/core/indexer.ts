import fs from 'node:fs';
import path from 'node:path';
import { indexFilePath, ensureStateDir, claudeProjectsDir } from './paths.js';
import { listProjectSlugs, scanSessionFile, buildIndexFromSessions } from './scanner.js';
import type { IndexData, SessionInfo } from './types.js';

/**
 * Index persistence & incremental refresh.
 *
 * Scanning every session file on every invocation would be slow (files can
 * reach hundreds of MB). We persist a JSON cache and only re-scan sessions
 * whose mtime differs from the cached value.
 */

const CURRENT_VERSION = 1;

/** Load the persisted index, or an empty one when absent/corrupt. */
export async function loadIndex(): Promise<IndexData> {
  const file = indexFilePath();
  if (!fs.existsSync(file)) {
    return { version: CURRENT_VERSION, generatedAt: '', sessions: {}, projects: {} };
  }
  try {
    const raw = await fs.promises.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as IndexData;
    if (parsed.version !== CURRENT_VERSION || !parsed.sessions || !parsed.projects) {
      return { version: CURRENT_VERSION, generatedAt: '', sessions: {}, projects: {} };
    }
    return parsed;
  } catch {
    return { version: CURRENT_VERSION, generatedAt: '', sessions: {}, projects: {} };
  }
}

/** Persist the index atomically. */
export async function saveIndex(index: IndexData): Promise<void> {
  ensureStateDir();
  const file = indexFilePath();
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(index), 'utf8');
  await fs.promises.rename(tmp, file);
}

/**
 * Refresh the index incrementally. Sessions whose file mtime/size changed are
 * re-scanned; deleted sessions are dropped.
 *
 * @param cached The index loaded from disk (may be empty).
 * @returns A fresh index and the number of sessions that were re-scanned.
 */
export async function refreshIndex(
  cached: IndexData,
): Promise<{ index: IndexData; scanned: number }> {
  const sessions: Record<string, SessionInfo> = {};
  let scanned = 0;

  for (const slug of await listProjectSlugs()) {
    const dir = path.join(claudeProjectsDir(), slug);
    let entries: string[];
    try {
      entries = await fs.promises.readdir(dir);
    } catch {
      continue;
    }
    for (const fileName of entries) {
      if (!fileName.endsWith('.jsonl')) continue;
      const id = fileName.slice(0, -'.jsonl'.length);
      const filePath = path.join(dir, fileName);
      const stat = await fs.promises.stat(filePath).catch(() => undefined);
      if (!stat) continue;

      const cachedSession = cached.sessions[id];
      // Cheap path: file unchanged since the cache was written.
      if (
        cachedSession &&
        cachedSession.mtimeMs === stat.mtimeMs &&
        cachedSession.size === stat.size
      ) {
        sessions[id] = cachedSession;
        continue;
      }
      // Deep scan only the changed/new file.
      const fresh = await scanSessionFile(filePath, slug);
      if (fresh) {
        sessions[id] = fresh;
        scanned += 1;
      }
    }
  }

  let removed = 0;
  for (const id of Object.keys(cached.sessions)) {
    if (!sessions[id]) removed += 1;
  }

  const index = buildIndexFromSessions(Object.values(sessions));
  if (removed > 0 || scanned > 0) {
    index.generatedAt = new Date().toISOString();
  }
  return { index, scanned };
}
