import fs from 'node:fs';
import path from 'node:path';
import { claudeProjectsDir, fromSlug, toSlug } from './paths.js';
import { extractSessionMeta } from './reader.js';
import type { IndexData, ProjectInfo, SessionInfo } from './types.js';

/**
 * Session scanner.
 *
 * Walks ~/.claude/projects/<slug>/*.jsonl and produces SessionInfo records.
 * Only cheap head/tail reads are performed here; token aggregation is lazy.
 */

const MAX_TITLE_LENGTH = 120;

/** Format a first prompt as a display title. */
export function promptToTitle(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= MAX_TITLE_LENGTH) return oneLine;
  return `${oneLine.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}

/** Enumerate project slugs that have session files. */
export async function listProjectSlugs(rootDir?: string): Promise<string[]> {
  const dir = rootDir ?? claudeProjectsDir();
  if (!fs.existsSync(dir)) return [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * Scan a single session file into a {@link SessionInfo}.
 * Returns undefined when the file cannot be read.
 */
export async function scanSessionFile(filePath: string, slug: string): Promise<SessionInfo | undefined> {
  const id = path.basename(filePath).replace(/\.jsonl$/, '');
  const stat = await fs.promises.stat(filePath).catch(() => undefined);
  if (!stat) return undefined;
  const meta = await extractSessionMeta(filePath).catch(() => undefined);
  if (!meta) return undefined;

  const projectPath = meta.cwd || fromSlug(slug);
  const firstPrompt = meta.firstPrompt || '(no messages)';
  const title = meta.title ? truncate(meta.title) : promptToTitle(firstPrompt);

  return {
    id,
    projectSlug: slug,
    projectPath,
    filePath,
    title,
    firstPrompt,
    startTime: meta.startTime ?? stat.birthtime.toISOString(),
    lastTime: meta.lastTime ?? stat.mtime.toISOString(),
    mtimeMs: stat.mtimeMs,
    gitBranch: meta.gitBranch,
    size: meta.fileSize,
    lineCount: meta.lineCount,
  };
}

/** Scan a single project directory, returning its session info records. */
export async function scanProject(slug: string, rootDir?: string): Promise<SessionInfo[]> {
  const dir = path.join(rootDir ?? claudeProjectsDir(), slug);
  if (!fs.existsSync(dir)) return [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const sessions: SessionInfo[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const filePath = path.join(dir, entry.name);
    const info = await scanSessionFile(filePath, slug);
    if (info) sessions.push(info);
  }
  sessions.sort((a, b) => (a.lastTime < b.lastTime ? 1 : a.lastTime > b.lastTime ? -1 : 0));
  return sessions;
}

function truncate(s: string, n = MAX_TITLE_LENGTH): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** Scan every project and build a complete index. */
export async function scanAll(rootDir?: string): Promise<IndexData> {
  const slugs = await listProjectSlugs(rootDir);
  const sessions: SessionInfo[] = [];
  for (const slug of slugs) {
    try {
      const found = await scanProject(slug, rootDir);
      sessions.push(...found);
    } catch (err) {
      // A single unreadable project should not abort the whole scan.
      console.error(`[csm] warning: failed to scan project "${slug}": ${(err as Error).message}`);
    }
  }
  return buildIndexFromSessions(sessions);
}

/** Build an IndexData from a flat session list. */
export function buildIndexFromSessions(sessions: SessionInfo[]): IndexData {
  const sessionMap: Record<string, SessionInfo> = {};
  const projects: Record<string, ProjectInfo> = {};
  for (const s of sessions) {
    sessionMap[s.id] = s;
    const existing = projects[s.projectSlug];
    if (!existing) {
      projects[s.projectSlug] = {
        slug: s.projectSlug,
        path: s.projectPath,
        sessionCount: 1,
        totalSize: s.size,
        lastActivity: s.lastTime,
      };
    } else {
      existing.sessionCount += 1;
      existing.totalSize += s.size;
      if (s.lastTime > existing.lastActivity) existing.lastActivity = s.lastTime;
    }
  }
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    sessions: sessionMap,
    projects,
  };
}

/** Map a session's recorded cwd to the project slug it would belong to. */
export function slugForCwd(cwd: string): string {
  return toSlug(cwd);
}

/** Read the real project path recorded in a session file when the slug path is unknown. */
export async function projectPathForSlug(slug: string): Promise<string> {
  const sessions = await scanProject(slug);
  return sessions[0]?.projectPath ?? fromSlug(slug);
}
