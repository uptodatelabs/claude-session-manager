import { aggregateTokens } from './reader.js';
import type { ProjectInfo, SessionInfo, TokenStats } from './types.js';

/**
 * Token statistics aggregation.
 *
 * Token usage is read lazily from session files since it requires a full pass
 * over the JSONL. Results can be cached on the SessionInfo records.
 */

export interface SessionStats {
  session: SessionInfo;
  tokens?: TokenStats;
}

export interface ProjectStats {
  project: ProjectInfo;
  sessionCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface Totals {
  sessionCount: number;
  projectCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** Sum token counts for one session, with caching on the session record. */
export async function tokensForSession(session: SessionInfo): Promise<TokenStats | undefined> {
  if (session.tokenStats || session.tokensLoaded) {
    return session.tokenStats;
  }
  session.tokensLoaded = true;
  const stats = await aggregateTokens(session.filePath).catch(() => undefined);
  if (stats) session.tokenStats = stats;
  return stats;
}

/** Aggregate token stats across many sessions. Sessions may run concurrently. */
export async function tokensForSessions(sessions: SessionInfo[]): Promise<Map<string, TokenStats>> {
  const result = new Map<string, TokenStats>();
  const batches: SessionInfo[][] = [];
  const BATCH = 8;
  for (let i = 0; i < sessions.length; i += BATCH) {
    batches.push(sessions.slice(i, i + BATCH));
  }
  for (const batch of batches) {
    const resolved = await Promise.all(batch.map((s) => tokensForSession(s)));
    batch.forEach((s, i) => {
      const t = resolved[i];
      if (t) result.set(s.id, t);
    });
  }
  return result;
}

/** Per-project token aggregates. */
export async function buildProjectStats(
  sessions: SessionInfo[],
  tokenMap: Map<string, TokenStats>,
): Promise<ProjectStats[]> {
  const byProject = new Map<string, SessionInfo[]>();
  for (const s of sessions) {
    const list = byProject.get(s.projectSlug) ?? [];
    list.push(s);
    byProject.set(s.projectSlug, list);
  }

  const out: ProjectStats[] = [];
  for (const [slug, group] of byProject) {
    const stats: ProjectStats = {
      project: {
        slug,
        path: group[0]?.projectPath ?? slug,
        sessionCount: group.length,
        totalSize: group.reduce((acc, s) => acc + s.size, 0),
        lastActivity: group.reduce((acc, s) => (s.lastTime > acc ? s.lastTime : acc), ''),
      },
      sessionCount: group.length,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    for (const s of group) {
      const t = tokenMap.get(s.id);
      if (!t) continue;
      stats.totalTokens += t.totalTokens;
      stats.inputTokens += t.inputTokens;
      stats.outputTokens += t.outputTokens;
      stats.cacheReadTokens += t.cacheReadInputTokens;
      stats.cacheCreationTokens += t.cacheCreationInputTokens;
    }
    out.push(stats);
  }
  out.sort((a, b) => b.totalTokens - a.totalTokens);
  return out;
}

/** Global totals. */
export function sumTotals(projectStats: ProjectStats[]): Totals {
  return projectStats.reduce<Totals>(
    (acc, p) => {
      acc.sessionCount += p.sessionCount;
      acc.projectCount += 1;
      acc.totalTokens += p.totalTokens;
      acc.inputTokens += p.inputTokens;
      acc.outputTokens += p.outputTokens;
      acc.cacheReadTokens += p.cacheReadTokens;
      acc.cacheCreationTokens += p.cacheCreationTokens;
      return acc;
    },
    {
      sessionCount: 0,
      projectCount: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
  );
}
