import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
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
  listBackupArchives,
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
    expect(restored.sessions).toHaveLength(1);

    const content = await readFile(restored.sessions[0]!, 'utf8');
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
    expect(restored.sessions).toHaveLength(2);

    // Restored into the remapped slug folder.
    expect(restored.sessions[0]!.includes('C--Users-new-MyProj')).toBe(true);
    const content = await readFile(restored.sessions[0]!, 'utf8');
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

describe('listBackupArchives', () => {
  it('lists .tar.gz files newest-first and ignores others', async () => {
    const dir = path.join(tmpDir, 'archives');
    const { mkdir, writeFile, utimes } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'old.tar.gz'), 'x');
    await writeFile(path.join(dir, 'new.tar.gz'), 'yy');
    await writeFile(path.join(dir, 'notes.txt'), 'ignore me');
    const past = new Date(Date.now() - 60_000);
    await utimes(path.join(dir, 'old.tar.gz'), past, past);

    const list = await listBackupArchives(dir);
    expect(list.map((a) => a.name)).toEqual(['new.tar.gz', 'old.tar.gz']);
    expect(list[0]!.size).toBe(2);
  });

  it('returns empty for a missing directory', async () => {
    expect(await listBackupArchives(path.join(tmpDir, 'nope'))).toEqual([]);
  });
});

describe('config-aware backup & restore', () => {
  let projDir: string;   // fake ~/.claude/projects
  let rootDir: string;   // fake project working dir
  let configDir: string; // fake ~/.claude

  beforeEach(async () => {
    projDir = path.join(tmpDir, 'claude-projects');
    rootDir = path.join(tmpDir, 'project-root');
    configDir = path.join(tmpDir, 'claude-config');

    // per-project Claude state: memory + CLAUDE.md alongside sessions
    await mkdir(path.join(projDir, 'F--Github-TestProj', 'memory'), { recursive: true });
    await writeFile(path.join(projDir, 'F--Github-TestProj', 'memory', 'MEM.md'), 'memory content');
    await writeFile(path.join(projDir, 'F--Github-TestProj', 'CLAUDE.md'), 'project claude md');

    // re-scan sessions but with cwd pointing at the real rootDir
    await rm(path.join(projDir, 'F--Github-TestProj', 'a.jsonl'), { force: true });
    await writeSession(path.join(projDir, 'F--Github-TestProj'), 'a.jsonl', defaultSessionLines(rootDir.replaceAll('\\', '/')));
    sessions = await scanProject('F--Github-TestProj', projDir);

    // project root config files
    await mkdir(path.join(rootDir, '.claude'), { recursive: true });
    await writeFile(path.join(rootDir, 'CLAUDE.md'), 'root claude md');
    await writeFile(path.join(rootDir, '.claude', 'settings.json'), '{"x":1}');

    // global config
    await mkdir(path.join(configDir, 'agents'), { recursive: true });
    await writeFile(path.join(configDir, 'settings.json'), '{"model":"x"}');
    await writeFile(path.join(configDir, 'agents', 'helper.md'), 'agent');
    await writeFile(path.join(path.dirname(configDir), '.claude.json'), '{"global":true}');

    process.env.CSM_CONFIG_DIR = configDir;
    process.env.CSM_PROJECTS_DIR = projDir;
  });

  afterEach(async () => {
    delete process.env.CSM_CONFIG_DIR;
    delete process.env.CSM_PROJECTS_DIR;
  });

  it('archive contains session, project-config, project-root and global files', async () => {
    const archive = path.join(tmpDir, 'with-config.tar.gz');
    await backupSessions([sessions[0]!], archive);

    const extractDir = path.join(tmpDir, 'extracted');
    await mkdir(extractDir, { recursive: true });
    const { extract } = await import('tar');
    await extract({ file: archive, cwd: extractDir });

    const expectExists = (rel: string) =>
      expect(existsSync(path.join(extractDir, rel))).toBe(true);

    expectExists(`sessions/F--Github-TestProj/${sessions[0]!.id}.jsonl`);
    expectExists('project-config/F--Github-TestProj/memory/MEM.md');
    expectExists('project-config/F--Github-TestProj/CLAUDE.md');
    expectExists('project-root/F--Github-TestProj/CLAUDE.md');
    expectExists('project-root/F--Github-TestProj/.claude/settings.json');
    expectExists('global/settings.json');
    expectExists('global/agents/helper.md');
    expectExists('global/_claude.json');
  });

  it('restore writes configs back to their locations', async () => {
    const archive = path.join(tmpDir, 'with-config.tar.gz');
    await backupSessions([sessions[0]!], archive);

    // remove the originals to prove restore recreates them
    await rm(path.join(projDir, 'F--Github-TestProj', 'memory'), { recursive: true, force: true });
    await rm(path.join(rootDir, 'CLAUDE.md'), { force: true });
    await rm(path.join(configDir, 'settings.json'), { force: true });

    const result = await restoreBackup(archive, { outputDir: projDir });
    expect(result.sessions).toHaveLength(1);
    expect(result.configFiles.length).toBeGreaterThan(0);

    expect(existsSync(path.join(projDir, 'F--Github-TestProj', 'memory', 'MEM.md'))).toBe(true);
    expect(existsSync(path.join(rootDir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(path.join(configDir, 'settings.json'))).toBe(true);
    expect(existsSync(path.join(path.dirname(configDir), '.claude.json'))).toBe(true);
    expect(result.skippedRoots).toHaveLength(0);
  });

  it('skips project-root restore when the directory is missing and no remap is given', async () => {
    const archive = path.join(tmpDir, 'with-config.tar.gz');
    await backupSessions([sessions[0]!], archive);

    await rm(rootDir, { recursive: true, force: true });

    const result = await restoreBackup(archive, { outputDir: projDir });
    expect(result.skippedRoots).toContain('F--Github-TestProj');
  });

  it('remaps project-root files to the remap target', async () => {
    const archive = path.join(tmpDir, 'with-config.tar.gz');
    await backupSessions([sessions[0]!], archive);

    const target = path.join(tmpDir, 'remapped-root');
    await restoreBackup(archive, { outputDir: projDir, remapCwd: target.replaceAll('\\', '/') });

    expect(existsSync(path.join(target, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(path.join(target, '.claude', 'settings.json'))).toBe(true);
  });

  it('defaultBackupArchivePath uses slug_id_timestamp naming', async () => {
    const { defaultBackupArchivePath } = await import('../src/core/actions.js');
    const outDir = path.join(tmpDir, 'bname');
    const p = defaultBackupArchivePath(sessions[0]!, outDir);
    expect(p).toContain('F--Github-TestProj_');
    expect(p.endsWith('.tar.gz')).toBe(true);
  });
});
