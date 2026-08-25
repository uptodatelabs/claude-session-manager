import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import {
  backupSessions,
  restoreBackup,
  inspectBackup,
  deleteSession,
  listTrash,
  restoreFromTrash,
  purgeTrashEntry,
  claudeBinary,
  resumeSession,
} from '../src/core/actions.js';
import { scanProject } from '../src/core/scanner.js';
import { writeSession, defaultSessionLines } from './helpers.js';
import type { SessionInfo } from '../src/core/types.js';

let tmpDir: string;
let stateDir: string;
let sessions: SessionInfo[];

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'csm-actions-'));
  stateDir = path.join(tmpDir, 'state');
  process.env.CSM_STATE_DIR = stateDir;
  await writeSession(path.join(tmpDir, 'projects', 'F--Github-TestProj'), 'a.jsonl', defaultSessionLines('F:/Github/TestProj'));
  await writeSession(path.join(tmpDir, 'projects', 'F--Github-TestProj'), 'b.jsonl', defaultSessionLines('F:/Github/TestProj'));
  sessions = await scanProject('F--Github-TestProj', path.join(tmpDir, 'projects'));
});

afterEach(async () => {
  delete process.env.CSM_STATE_DIR;
  await rm(tmpDir, { recursive: true, force: true });
});

describe('claudeBinary', () => {
  it('resolves to a claude binary that exists when a path is found', () => {
    const bin = claudeBinary();
    expect(bin.length).toBeGreaterThan(0);
    expect(bin.toLowerCase()).toContain('claude');
    // When resolved from PATH it should be an existing file; the bare 'claude'
    // fallback is only used when nothing could be found on PATH.
    if (bin.includes('/') || bin.includes('\\')) {
      expect(existsSync(bin)).toBe(true);
    }
  });
});

describe('resumeSession', () => {
  it('throws when the project path does not exist', () => {
    const fakeSession = sessions[0]!;
    expect(() => resumeSession({ ...fakeSession, projectPath: 'Z:/nonexistent' })).toThrow();
  });
});

describe('backup / restore', () => {
  it('round-trips a session through a tar.gz archive', async () => {
    const archive = path.join(tmpDir, 'backup.tar.gz');
    await backupSessions([sessions[0]!], archive);
    expect(existsSync(archive)).toBe(true);

    // Restore into a fresh projects dir to simulate another machine.
    const fresh = path.join(tmpDir, 'restored-projects');
    const restored = await restoreBackup(archive, { outputDir: fresh });
    expect(restored).toHaveLength(1);

    const content = await readFile(restored[0]!, 'utf8');
    expect(content).toContain('첫 번째 요청: 테스트');
    expect(content).toContain('F:/Github/TestProj');
  });

  it('remaps cwd when restore --remap is used', async () => {
    const archive = path.join(tmpDir, 'backup.tar.gz');
    await backupSessions(sessions, archive);

    const fresh = path.join(tmpDir, 'remapped-projects');
    const restored = await restoreBackup(archive, {
      outputDir: fresh,
      remapCwd: 'C:/Users/new/MyProj',
    });
    expect(restored).toHaveLength(2);

    // Restored into the remapped slug folder.
    expect(restored[0]!.includes('C--Users-new-MyProj')).toBe(true);
    const content = await readFile(restored[0]!, 'utf8');
    expect(content).toContain('C:/Users/new/MyProj');
    expect(content).not.toContain('F:/Github/TestProj');
  });

  it('writes a manifest that survives a round trip', async () => {
    const archive = path.join(tmpDir, 'backup.tar.gz');
    await backupSessions([sessions[0]!], archive);
    const manifest = await inspectBackup(archive);
    expect(manifest.sessions).toHaveLength(1);
    expect(manifest.sessions[0]!.sessionId).toBe(sessions[0]!.id);
    expect(manifest.sessions[0]!.originalCwd).toBe('F:/Github/TestProj');
  });
});

describe('trash', () => {
  it('moves a session to trash and restores it', async () => {
    const original = sessions[0]!;
    const originalPath = original.filePath;
    expect(existsSync(originalPath)).toBe(true);

    const entry = await deleteSession(original);
    expect(existsSync(originalPath)).toBe(false);
    expect(existsSync(path.join(stateDir, 'trash', `${entry.trashId}.jsonl`))).toBe(true);

    const trash = await listTrash();
    expect(trash).toHaveLength(1);
    expect(trash[0]!.sessionId).toBe(original.id);

    await restoreFromTrash(entry.trashId);
    expect(existsSync(originalPath)).toBe(true);
    expect(await listTrash()).toHaveLength(0);
  });

  it('purges a trash entry permanently', async () => {
    const entry = await deleteSession(sessions[0]!);
    await purgeTrashEntry(entry.trashId);
    expect(await listTrash()).toHaveLength(0);
    expect(existsSync(path.join(stateDir, 'trash', `${entry.trashId}.jsonl`))).toBe(false);
  });
});
