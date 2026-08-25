import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import {
  tokensForSession,
  tokensForSessions,
  buildProjectStats,
  sumTotals,
} from '../src/core/stats.js';
import { scanProject } from '../src/core/scanner.js';
import { writeSession, defaultSessionLines } from './helpers.js';
import type { SessionInfo } from '../src/core/types.js';

let tmpDir: string;
let sessions: SessionInfo[];

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'csm-stats-'));
  await writeSession(path.join(tmpDir, 'F--Github-TestProj'), 'a.jsonl', defaultSessionLines());
  await writeSession(path.join(tmpDir, 'F--Github-TestProj'), 'b.jsonl', defaultSessionLines());
  await writeSession(path.join(tmpDir, 'F--Github-Other'), 'c.jsonl', defaultSessionLines());
  sessions = [
    ...(await scanProject('F--Github-TestProj', tmpDir)),
    ...(await scanProject('F--Github-Other', tmpDir)),
  ];
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('tokensForSession', () => {
  it('aggregates and caches token stats', async () => {
    const s = sessions[0]!;
    expect(s.tokenStats).toBeUndefined();
    const stats = await tokensForSession(s);
    expect(stats).toBeDefined();
    expect(stats!.totalTokens).toBe(70);
    // Second call returns from cache without re-reading.
    const cached = await tokensForSession(s);
    expect(cached!.totalTokens).toBe(70);
  });
});

describe('tokensForSessions', () => {
  it('returns a map keyed by session id', async () => {
    const map = await tokensForSessions(sessions);
    expect(map.size).toBe(3);
    expect(map.get(sessions[0]!.id)!.totalTokens).toBe(70);
  });
});

describe('buildProjectStats + sumTotals', () => {
  it('aggregates per project and sums totals', async () => {
    const map = await tokensForSessions(sessions);
    const projectStats = await buildProjectStats(sessions, map);

    const testProj = projectStats.find((p) => p.project.slug === 'F--Github-TestProj')!;
    expect(testProj.sessionCount).toBe(2);
    expect(testProj.totalTokens).toBe(140);

    const totals = sumTotals(projectStats);
    expect(totals.sessionCount).toBe(3);
    expect(totals.projectCount).toBe(2);
    expect(totals.totalTokens).toBe(210);
    expect(totals.outputTokens).toBe(35 * 3);
  });
});
