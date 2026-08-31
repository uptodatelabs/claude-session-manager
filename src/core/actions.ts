import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  trashDir,
  stateDir,
  ensureStateDir,
  toSlug,
  claudeProjectsDir,
  backupsDir,
  claudeConfigDir,
  claudeJsonPath,
} from './paths.js';
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
 * Resume a session by running `claude --resume <id>` in the session's working
 * directory.
 *
 * On Windows, Claude is opened in its own console window via `start`. Sharing
 * csm's console makes the child unresponsive (keys and Ctrl+C appear dead) —
 * console input handoff from a node parent to a native TUI child is unreliable
 * regardless of shell mode. A dedicated window behaves exactly like typing
 * `claude -r <id>` by hand, which is verified to work.
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
  const args = ['-r', session.id];

  if (process.platform === 'win32') {
    // `start "title" /D <dir> <program> <args…>` opens a new console window.
    // The quoted first argument is the window title. The directory must be a
    // native backslash path — cmd's `start /D` silently fails on `C:/...`.
    const nativeCwd = path.resolve(cwd);
    spawn('cmd.exe', ['/c', 'start', '"Claude"', '/D', nativeCwd, binary, ...args], {
      stdio: 'ignore',
      detached: true,
    }).unref();
    return;
  }

  // POSIX: inheriting stdio hands the terminal over reliably.
  const child = spawn(binary, args, {
    cwd,
    stdio: 'inherit',
  });
  child.on('error', (err) => {
    console.error(`[cshub] Failed to launch Claude: ${err.message}`);
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

/** Config files captured alongside sessions in a backup archive. */
export interface BackupConfigSection {
  /** Config files from ~/.claude/projects/<slug>/ (memory/, CLAUDE.md, ...). */
  projectConfigs: { slug: string; files: string[] }[];
  /** Config files from each session's project working directory. */
  projectRoots: { slug: string; cwd: string; files: string[] }[];
  /** Config files from ~/.claude (CLAUDE.md, settings.json, agents/, ...) plus ~/.claude.json. */
  globalFiles: string[];
}

export interface BackupManifest {
  createdAt: string;
  sessions: BackupSessionEntry[];
  /** Present in archives created with config support; absent in old archives. */
  config?: BackupConfigSection;
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

/** Recursively list file paths under a directory, relative to it. */
async function walkFiles(root: string): Promise<string[]> {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    const abs = rel ? path.join(root, rel) : root;
    const entries = await fs.promises.readdir(abs, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(relPath);
      else if (e.isFile()) out.push(relPath);
    }
  };
  await walk('');
  return out;
}

/**
 * Config files at a session's project working directory: CLAUDE.md, AGENTS.md,
 * .mcp.json and the whole .claude/ folder (settings, agents, skills, hooks...).
 * Returns [] when the directory does not exist on this machine.
 */
async function collectProjectRootFiles(cwd: string): Promise<string[]> {
  if (!fs.existsSync(cwd)) return [];
  const files: string[] = [];
  for (const name of ['CLAUDE.md', 'AGENTS.md', '.mcp.json']) {
    if (fs.existsSync(path.join(cwd, name))) files.push(name);
  }
  for (const f of await walkFiles(path.join(cwd, '.claude'))) {
    files.push(`.claude/${f}`);
  }
  return files;
}

/**
 * Whitelisted config files from the global Claude root (~/.claude) plus the
 * top-level ~/.claude.json (staged as `_claude.json`). Runtime/cache folders
 * (projects, plugins, todos, ...) are deliberately excluded.
 */
async function collectGlobalConfigFiles(): Promise<string[]> {
  const root = claudeConfigDir();
  const files: string[] = [];
  for (const name of ['CLAUDE.md', 'settings.json']) {
    if (fs.existsSync(path.join(root, name))) files.push(name);
  }
  for (const dir of ['agents', 'skills', 'commands', 'output-styles']) {
    for (const f of await walkFiles(path.join(root, dir))) {
      files.push(`${dir}/${f}`);
    }
  }
  if (fs.existsSync(claudeJsonPath())) files.push('_claude.json');
  return files;
}

async function copyInto(srcAbs: string, destAbs: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(destAbs), { recursive: true });
  await fs.promises.copyFile(srcAbs, destAbs);
}

function restoreTmpDir(): string {
  return path.join(stateDir(), 'restore-tmp');
}

/**
 * Create a tar.gz backup of the given sessions plus their configuration:
 *
 * - `sessions/<slug>/<id>.jsonl`            — session transcripts
 * - `project-config/<slug>/...`             — ~/.claude/projects/<slug> state (memory/, CLAUDE.md)
 * - `project-root/<slug>/...`               — config files in each session's working directory
 * - `global/...`                            — ~/.claude config files and ~/.claude.json
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
    config: { projectConfigs: [], projectRoots: [], globalFiles: [] },
  };

  const stagedSlugs = new Set<string>();

  for (const s of sessions) {
    const relFile = `sessions/${s.projectSlug}/${s.id}.jsonl`;
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

    // Stage this project's Claude-state files (memory/, CLAUDE.md, ...) once.
    if (!stagedSlugs.has(s.projectSlug)) {
      stagedSlugs.add(s.projectSlug);
      const stateRoot = path.join(claudeProjectsDir(), s.projectSlug);
      const rels = (await walkFiles(stateRoot)).filter((f) => !f.endsWith('.jsonl'));
      for (const rel of rels) {
        await copyInto(path.join(stateRoot, rel), path.join(tmpDir, 'project-config', s.projectSlug, rel));
      }
      if (rels.length > 0) {
        manifest.config!.projectConfigs.push({ slug: s.projectSlug, files: rels });
      }

      // Stage config files living in the session's own working directory.
      const rootFiles = await collectProjectRootFiles(s.projectPath);
      for (const rel of rootFiles) {
        await copyInto(
          path.join(s.projectPath, rel),
          path.join(tmpDir, 'project-root', s.projectSlug, rel),
        );
      }
      if (rootFiles.length > 0) {
        manifest.config!.projectRoots.push({ slug: s.projectSlug, cwd: s.projectPath, files: rootFiles });
      }
    }
  }

  // Stage global config (~/.claude files + ~/.claude.json).
  const globalFiles = await collectGlobalConfigFiles();
  for (const rel of globalFiles) {
    const src = rel === '_claude.json' ? claudeJsonPath() : path.join(claudeConfigDir(), rel);
    await copyInto(src, path.join(tmpDir, 'global', rel));
  }
  manifest.config!.globalFiles = globalFiles;

  await fs.promises.writeFile(
    path.join(tmpDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );

  const { create } = await import('tar');
  await create({ gzip: true, file: archive, cwd: tmpDir }, ['.']);

  await fs.promises.rm(tmpDir, { recursive: true, force: true });
}

/** A backup archive discovered on disk. */
export interface BackupArchive {
  path: string;
  name: string;
  mtimeMs: number;
  size: number;
}

/** List `.tar.gz` backup archives in a directory (newest first). */
export async function listBackupArchives(dir?: string): Promise<BackupArchive[]> {
  const root = dir ?? backupsDir();
  if (!fs.existsSync(root)) return [];
  const names = await fs.promises.readdir(root).catch(() => [] as string[]);
  const archives: BackupArchive[] = [];
  for (const name of names) {
    if (!name.endsWith('.tar.gz')) continue;
    const full = path.join(root, name);
    const stat = await fs.promises.stat(full).catch(() => undefined);
    if (!stat?.isFile()) continue;
    archives.push({ path: full, name, mtimeMs: stat.mtimeMs, size: stat.size });
  }
  archives.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return archives;
}

/**
 * Compute the archive path a single-session backup would use, without creating
 * it. Lets the TUI show the exact destination before the user confirms.
 */
export function defaultBackupArchivePath(session: SessionInfo, outputDir: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(outputDir, `${session.projectSlug}_${session.id}_${timestamp}.tar.gz`);
}

/** Backup a single session to an explicit archive path. */
export async function backupSessionToPath(
  session: SessionInfo,
  archivePath: string,
): Promise<string> {
  const dir = path.dirname(archivePath);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
  await backupSessions([session], archivePath);
  return archivePath;
}

/** Backup a single session into outputDir and return the archive path. */
export async function backupSingleSession(
  session: SessionInfo,
  outputDir: string,
): Promise<string> {
  return backupSessionToPath(session, defaultBackupArchivePath(session, outputDir));
}

export interface RestoreOptions {
  /** Remap all cwd references to this path (and recalculate slugs). */
  remapCwd?: string;
  /** Target directory to restore into (default: ~/.claude/projects). */
  outputDir?: string;
  /** Skip overwriting an existing session file. */
  skipExisting?: boolean;
}

export interface RestoreResult {
  /** Paths of restored session files. */
  sessions: string[];
  /** Paths of restored config files (project state, project roots, global). */
  configFiles: string[];
  /** Slugs whose project-root config was skipped because the dir is absent. */
  skippedRoots: string[];
}

/**
 * Restore sessions and their configuration from a tar.gz backup archive.
 * Archives created before config support (no `config` in the manifest) restore
 * sessions only, exactly as before.
 */
export async function restoreBackup(
  archive: string,
  opts: RestoreOptions = {},
): Promise<RestoreResult> {
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
  const configFiles: string[] = [];
  const skippedRoots: string[] = [];
  const targetDir = opts.outputDir ?? claudeProjectsDir();

  for (const entry of manifest.sessions) {
    const srcFile = path.join(tmpDir, entry.file);
    if (!fs.existsSync(srcFile)) {
      console.error(`[cshub] warning: missing file in archive: ${entry.file}`);
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
      console.error(`[cshub] skip: already exists ${destFile}`);
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

  // ── Config restore ──────────────────────────────────────────────────────
  const cfg = manifest.config;
  if (cfg) {
    // Per-project Claude state (~/.claude/projects/<slug>/memory, CLAUDE.md…)
    for (const group of cfg.projectConfigs) {
      const targetSlug = opts.remapCwd ? toSlug(opts.remapCwd) : group.slug;
      for (const rel of group.files) {
        const src = path.join(tmpDir, 'project-config', group.slug, rel);
        if (!fs.existsSync(src)) continue;
        const dest = path.join(targetDir, targetSlug, rel);
        if (opts.skipExisting && fs.existsSync(dest)) continue;
        try {
          await copyInto(src, dest);
          configFiles.push(dest);
        } catch (err) {
          console.error(`[cshub] warning: could not restore ${rel}: ${(err as Error).message}`);
        }
      }
    }

    // Config files from each session's working directory.
    for (const group of cfg.projectRoots) {
      // The project root must exist locally (or be provided via --remap);
      // otherwise there is no sensible place to put these files.
      const rootExists = !opts.remapCwd && fs.existsSync(group.cwd);
      if (!rootExists && !opts.remapCwd) {
        skippedRoots.push(group.slug);
        continue;
      }
      const rootDir = opts.remapCwd ?? group.cwd;
      for (const rel of group.files) {
        const src = path.join(tmpDir, 'project-root', group.slug, rel);
        if (!fs.existsSync(src)) continue;
        const dest = path.join(rootDir, rel);
        if (opts.skipExisting && fs.existsSync(dest)) continue;
        try {
          await copyInto(src, dest);
          configFiles.push(dest);
        } catch (err) {
          // A config write must never abort the session restore.
          console.error(`[cshub] warning: could not restore ${rel}: ${(err as Error).message}`);
        }
      }
    }

    // Global config (~/.claude files + ~/.claude.json).
    for (const rel of cfg.globalFiles) {
      const src = path.join(tmpDir, 'global', rel);
      if (!fs.existsSync(src)) continue;
      const dest =
        rel === '_claude.json' ? claudeJsonPath() : path.join(claudeConfigDir(), rel);
      if (opts.skipExisting && fs.existsSync(dest)) continue;
      try {
        await copyInto(src, dest);
        configFiles.push(dest);
      } catch (err) {
        console.error(`[cshub] warning: could not restore ${rel}: ${(err as Error).message}`);
      }
    }
  }

  await fs.promises.rm(tmpDir, { recursive: true, force: true });
  return { sessions: restored, configFiles, skippedRoots };
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
