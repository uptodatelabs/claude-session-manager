import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { mkdtemp, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import { refreshIndex, loadIndex, saveIndex } from '../src/core/indexer.js';
import { writeSession, defaultSessionLines } from './helpers.js';

let root: string;
let projectsDir: string;
let stateDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'csm-index-'));
  projectsDir = path.join(root, 'projects');
  stateDir = path.join(root, 'state');
  process.env.CSM_PROJECTS_DIR = projectsDir;
  process.env.CSM_STATE_DIR = stateDir;
});

afterEach(async () => {
  delete process.env.CSM_PROJECTS_DIR;
  delete process.env.CSM_STATE_DIR;
  await rm(root, { recursive: true, force: true });
});

describe('indexer', () => {
  it('persists and reloads the index', async () => {
    await writeSession(path.join(projectsDir, 'F--Github-TestProj'), 'a.jsonl', defaultSessionLines());
    const { index, scanned } = await refreshIndex(await loadIndex());
    expect(scanned).toBe(1);
    expect(index.sessions.a).toBeDefined();

    await saveIndex(index);
    const reloaded = await loadIndex();
    expect(reloaded.sessions.a).toBeDefined();
  });

  it('only re-scans changed sessions on refresh', async () => {
    await writeSession(path.join(projectsDir, 'F--Github-TestProj'), 'a.jsonl', defaultSessionLines());
    const first = await refreshIndex(await loadIndex());
    expect(first.scanned).toBe(1);

    const second = await refreshIndex(first.index);
    expect(second.scanned).toBe(0);
    expect(second.index.sessions.a).toBeDefined();

    // Touch the file (new mtime) and confirm it is re-scanned.
    const file = path.join(projectsDir, 'F--Github-TestProj', 'a.jsonl');
    const future = new Date(Date.now() + 60_000);
    await utimes(file, future, future);
    const third = await refreshIndex(second.index);
    expect(third.scanned).toBe(1);
  });

  it('drops deleted sessions from the index', async () => {
    await writeSession(path.join(projectsDir, 'F--Github-TestProj'), 'a.jsonl', defaultSessionLines());
    await writeSession(path.join(projectsDir, 'F--Github-TestProj'), 'b.jsonl', defaultSessionLines());
    const { index } = await refreshIndex(await loadIndex());
    expect(Object.keys(index.sessions)).toHaveLength(2);

    // Delete b from disk.
    const b = path.join(projectsDir, 'F--Github-TestProj', 'b.jsonl');
    await rm(b, { force: true });

    const refreshed = await refreshIndex(index);
    expect(refreshed.index.sessions.b).toBeUndefined();
    expect(Object.keys(refreshed.index.sessions)).toHaveLength(1);
  });
});
