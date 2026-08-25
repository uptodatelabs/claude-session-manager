import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { trashDir, stateDir, ensureStateDir, toSlug, claudeProjectsDir } from './paths.js';
import type { SessionInfo } from './types.js';

/**
 * Session actions: resume, delete, backup, restore.
 *
 * Resume spawns `claude -r <session-id>` in the session's working directory.
 * Delete moves to a trash folder (not a permanent removal).
 * Backup/restore use tar.gz archives for cross-machine portability.
 */

// ─── Resume ─────────────────────────────────────────────────────────────────

/** Candidate executable names for the `claude` CLI, most specific first. */
function claudeCandidates(platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    return ['claude.cmd', 'claude.bat', 'claude.exe', 'claude'];
  }
  return ['claude'];
}

/** Resolve the `claude` binary path from PATH. */
export function claudeBinary(): string {
  const { env, platform } = process;
  const pathDirs = (env.PATH ?? '').split(path.delimiter);
  for (const dir of pathDirs) {
    if (!dir) continue;
    for (const name of claudeCandidates(platform)) {
      try {
        const full = path.join(dir, name);
        if (fs.existsSync(full)) return full;
      } catch {
        // Skip inaccessible paths.
      }
    }
  }
  return 'claude';
}

/**
 * Resume a session by spawning `claude --resume <id>` in the right directory.
 * The child process inherits stdio so the user interacts with Claude directly.
 */
export function resumeSession(session: SessionInfo): void {
  const cwd = session.projectPath;
  if (!fs.existsSync(cwd)) {
    throw new Error(
      `Session project path does not exist: ${cwd}\n` +
        'Cannot resume — the session was likely created on a different machine.\n' +
        'Use `csm restore --remap <path>` to remap the session to a local path.',
    );
  }
  const binary = claudeBinary();
  // On Windows, run through cmd.exe (`shell: true`). Spawning a native console
  // executable directly with `shell: false` fails to hand the console input to
  // the child, so Claude comes up unresponsive (keys and Ctrl+C appear dead).
  // cmd.exe performs the console handoff reliably, which is what worked in the
  // original implementation.
  const args = ['-r', session.id];
  const child = spawn(binary, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child.on('error', (err) => {
    console.error(`[csm] Failed to launch Claude: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

// ─── Delete / Trash ──────────────────────────────────────────────────────────

export interface TrashEntry {
  trashId: string;
  originalPath: string;
  sessionId: string;
  projectSlug: string;
  title: string;
  trashedAt: string;
}

function readTrashManifest(): TrashEntry[] {
  const manifestPath = path.join(trashDir(), 'manifest.json');
  if (!fs.existsSync(manifestPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as TrashEntry[];
  } catch {
    return [];
  }
}

async function writeTrashManifest(entries: TrashEntry[]): Promise<void> {
  const manifestPath = path.join(trashDir(), 'manifest.json');
  await fs.promises.writeFile(manifestPath, JSON.stringify(entries, null, 2), 'utf8');
}

/** Move a session file to the trash folder. */
export async function deleteSession(session: SessionInfo): Promise<TrashEntry> {
  ensureStateDir();
  const trash = trashDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const trashId = `${timestamp}_${session.id}`;
  const dest = path.join(trash, `${trashId}.jsonl`);

  await fs.promises.rename(session.filePath, dest);

  const entry: TrashEntry = {
    trashId,
    originalPath: session.filePath,
    sessionId: session.id,
    projectSlug: session.projectSlug,
    title: session.title,
    trashedAt: new Date().toISOString(),
  };

  const manifest = readTrashManifest();
  manifest.push(entry);
  await writeTrashManifest(manifest);
  return entry;
}

/** List entries in the trash. */
export async function listTrash(): Promise<TrashEntry[]> {
  return readTrashManifest();
}

/** Restore a session from trash back to its original location. */
export async function restoreFromTrash(trashId: string): Promise<TrashEntry> {
  const entries = await listTrash();
  const entry = entries.find((e) => e.trashId === trashId);
  if (!entry) throw new Error(`Trash entry not found: ${trashId}`);

  const src = path.join(trashDir(), `${trashId}.jsonl`);
  if (!fs.existsSync(src)) throw new Error(`Trash file not found: ${src}`);

  const originalDir = path.dirname(entry.originalPath);
  if (!fs.existsSync(originalDir)) {
    await fs.promises.mkdir(originalDir, { recursive: true });
  }
  await fs.promises.rename(src, entry.originalPath);

  const updated = entries.filter((e) => e.trashId !== trashId);
  await writeTrashManifest(updated);
  return entry;
}

/** Permanently purge a trash entry (delete the file and manifest record). */
export async function purgeTrashEntry(trashId: string): Promise<void> {
  const entries = await listTrash();
  const entry = entries.find((e) => e.trashId === trashId);
  if (!entry) throw new Error(`Trash entry not found: ${trashId}`);

  const src = path.join(trashDir(), `${trashId}.jsonl`);
  if (fs.existsSync(src)) {
    await fs.promises.rm(src, { force: true });
  }
  await writeTrashManifest(entries.filter((e) => e.trashId !== trashId));
}

// ─── Backup / Restore ────────────────────────────────────────────────────────

export interface BackupManifest {
  createdAt: string;
  sessions: BackupSessionEntry[];
}

export interface BackupSessionEntry {
  sessionId: string;
  projectSlug: string;
  originalCwd: string;
  title: string;
  startTime: string;
  lastTime: string;
  file: string;
  size: number;
}

function backupTmpDir(): string {
  return path.join(stateDir(), 'backup-tmp');
}

function restoreTmpDir(): string {
  return path.join(stateDir(), 'restore-tmp');
}

/**
 * Create a tar.gz backup of the given sessions.
 *
 * @param sessions Sessions to include.
 * @param archive  Output archive path.
 */
export async function backupSessions(sessions: SessionInfo[], archive: string): Promise<void> {
  ensureStateDir();
  const tmpDir = backupTmpDir();
  if (fs.existsSync(tmpDir)) {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }

  const manifest: BackupManifest = {
    createdAt: new Date().toISOString(),
    sessions: [],
  };

  for (const s of sessions) {
    const relFile = `${s.projectSlug}/${s.id}.jsonl`;
    const destFile = path.join(tmpDir, relFile);
    const destDir = path.dirname(destFile);
    if (!fs.existsSync(destDir)) {
      await fs.promises.mkdir(destDir, { recursive: true });
    }
    await fs.promises.copyFile(s.filePath, destFile);
    manifest.sessions.push({
      sessionId: s.id,
      projectSlug: s.projectSlug,
      originalCwd: s.projectPath,
      title: s.title,
      startTime: s.startTime,
      lastTime: s.lastTime,
      file: relFile,
      size: s.size,
    });
  }

  await fs.promises.writeFile(
    path.join(tmpDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );

  const { create } = await import('tar');
  await create({ gzip: true, file: archive, cwd: tmpDir }, ['.']);

  await fs.promises.rm(tmpDir, { recursive: true, force: true });
}

/** Backup a single session and return the archive path. */
export async function backupSingleSession(
  session: SessionInfo,
  outputDir: string,
): Promise<string> {
  if (!fs.existsSync(outputDir)) {
    await fs.promises.mkdir(outputDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archive = path.join(
    outputDir,
    `${session.projectSlug}_${session.id}_${timestamp}.tar.gz`,
  );
  await backupSessions([session], archive);
  return archive;
}

export interface RestoreOptions {
  /** Remap all cwd references to this path (and recalculate slugs). */
  remapCwd?: string;
  /** Target directory to restore into (default: ~/.claude/projects). */
  outputDir?: string;
  /** Skip overwriting an existing session file. */
  skipExisting?: boolean;
}

/**
 * Restore sessions from a tar.gz backup archive.
 *
 * @returns The paths of restored session files.
 */
export async function restoreBackup(
  archive: string,
  opts: RestoreOptions = {},
): Promise<string[]> {
  const { extract } = await import('tar');
  const tmpDir = restoreTmpDir();

  if (fs.existsSync(tmpDir)) {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
  await fs.promises.mkdir(tmpDir, { recursive: true });

  await extract({ file: archive, cwd: tmpDir });

  const manifestPath = path.join(tmpDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Backup archive does not contain a manifest.json');
  }
  const manifest: BackupManifest = JSON.parse(
    await fs.promises.readFile(manifestPath, 'utf8'),
  ) as BackupManifest;

  const restored: string[] = [];
  const targetDir = opts.outputDir ?? claudeProjectsDir();

  for (const entry of manifest.sessions) {
    const srcFile = path.join(tmpDir, entry.file);
    if (!fs.existsSync(srcFile)) {
      console.error(`[csm] warning: missing file in archive: ${entry.file}`);
      continue;
    }

    let targetSlug = entry.projectSlug;
    let targetCwd = entry.originalCwd;
    if (opts.remapCwd) {
      targetCwd = opts.remapCwd;
      targetSlug = toSlug(targetCwd);
    }

    const destDir = path.join(targetDir, targetSlug);
    if (!fs.existsSync(destDir)) {
      await fs.promises.mkdir(destDir, { recursive: true });
    }

    const destFile = path.join(destDir, `${entry.sessionId}.jsonl`);
    if (opts.skipExisting && fs.existsSync(destFile)) {
      console.error(`[csm] skip: already exists ${destFile}`);
      continue;
    }

    if (opts.remapCwd) {
      const content = await fs.promises.readFile(srcFile, 'utf8');
      const rewritten = content
        .split('\n')
        .map((line) => {
          if (!line.trim()) return line;
          try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            if (obj.cwd && typeof obj.cwd === 'string') {
              obj.cwd = targetCwd;
            }
            return JSON.stringify(obj);
          } catch {
            return line;
          }
        })
        .join('\n');
      await fs.promises.writeFile(destFile, rewritten, 'utf8');
    } else {
      await fs.promises.copyFile(srcFile, destFile);
    }
    restored.push(destFile);
  }

  await fs.promises.rm(tmpDir, { recursive: true, force: true });
  return restored;
}

/** Inspect a backup archive without restoring (print its manifest). */
export async function inspectBackup(archive: string): Promise<BackupManifest> {
  const tmpDir = restoreTmpDir();
  if (fs.existsSync(tmpDir)) {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
  await fs.promises.mkdir(tmpDir, { recursive: true });
  await extractBackupManifest(archive, tmpDir);
  const manifestPath = path.join(tmpDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Backup archive does not contain a manifest.json');
  }
  const manifest = JSON.parse(
    await fs.promises.readFile(manifestPath, 'utf8'),
  ) as BackupManifest;
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
  return manifest;
}

async function extractBackupManifest(archive: string, target: string): Promise<void> {
  const { extract } = await import('tar');
  await extract({ file: archive, cwd: target, onentry: (entry) => {
    if (entry.path !== 'manifest.json') {
      entry.ignore = true;
    }
  } });
}
