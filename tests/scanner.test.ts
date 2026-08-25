import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { scanProject, listProjectSlugs, buildIndexFromSessions, promptToTitle } from '../src/core/scanner.js';
import { writeSession, defaultSessionLines } from './helpers.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'csm-scan-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('listProjectSlugs', () => {
  it('returns the project slugs present in the projects dir', async () => {
    await writeSession(path.join(tmpDir, 'F--Github-TestProj'), 'a.jsonl', defaultSessionLines());
    await writeSession(path.join(tmpDir, 'F--Github-Other'), 'b.jsonl', defaultSessionLines());
    const slugs = await listProjectSlugs(tmpDir as unknown as string);
    expect(slugs).toEqual(['F--Github-Other', 'F--Github-TestProj']);
  });
});

describe('scanProject', () => {
  it('builds a SessionInfo from a fixture session', async () => {
    const file = await writeSession(
      path.join(tmpDir, 'F--Github-TestProj'),
      'a.jsonl',
      defaultSessionLines(),
    );
    const sessions = await scanProject('F--Github-TestProj', tmpDir);
    expect(sessions).toHaveLength(1);
    const s = sessions[0]!;
    expect(s.id).toBe('a');
    expect(s.title).toBe('첫 번째 테스트 세션');
    expect(s.projectPath).toBe('F:/Github/TestProj');
    expect(s.filePath).toBe(file);
    expect(s.lineCount).toBe(5);
    expect(s.gitBranch).toBe('main');
    expect(s.startTime).toBe('2026-08-01T10:00:00.000Z');
  });

  it('ignores non-jsonl files and memory directories', async () => {
    await writeSession(path.join(tmpDir, 'F--Github-TestProj'), 'a.jsonl', defaultSessionLines());
    await writeSession(path.join(tmpDir, 'F--Github-TestProj'), 'README.md', ['nope']);
    const sessions = await scanProject('F--Github-TestProj', tmpDir);
    expect(sessions).toHaveLength(1);
  });

  it('sorts sessions by lastTime descending', async () => {
    const slugDir = path.join(tmpDir, 'F--Github-TestProj');
    await writeSession(slugDir, 'old.jsonl', defaultSessionLines().map((l) => l.replace('2026-08-01T10:00:0', '2026-07-01T10:00:0')));
    await writeSession(slugDir, 'new.jsonl', defaultSessionLines());
    const sessions = await scanProject('F--Github-TestProj', tmpDir);
    expect(sessions.map((s) => s.id)).toEqual(['new', 'old']);
  });

  it('returns an empty array for a missing project', async () => {
    expect(await scanProject('Nope', tmpDir)).toEqual([]);
  });
});

describe('buildIndexFromSessions', () => {
  it('groups sessions by project and sums project sizes', async () => {
    const s1 = {
      id: 'a',
      projectSlug: 'P1',
      projectPath: '/p1',
      filePath: '/p1/a.jsonl',
      title: 't',
      firstPrompt: 'p',
      startTime: '2026-01-01T00:00:00.000Z',
      lastTime: '2026-01-02T00:00:00.000Z',
      size: 100,
      lineCount: 1,
    };
    const s2 = { ...s1, id: 'b', size: 50 };
    const s3 = { ...s1, id: 'c', projectSlug: 'P2', projectPath: '/p2', size: 200 };
    const index = buildIndexFromSessions([s1, s2, s3]);
    expect(index.sessions.a).toBeDefined();
    expect(index.projects.P1).toMatchObject({ slug: 'P1', sessionCount: 2, totalSize: 150 });
    expect(index.projects.P2).toMatchObject({ sessionCount: 1, totalSize: 200 });
  });
});

describe('promptToTitle', () => {
  it('collapses whitespace', () => {
    expect(promptToTitle('  multi\n  line prompt ')).toBe('multi line prompt');
  });

  it('truncates long prompts', () => {
    const long = 'x'.repeat(300);
    const title = promptToTitle(long);
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith('…')).toBe(true);
  });
});
