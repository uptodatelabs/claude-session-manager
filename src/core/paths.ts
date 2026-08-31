import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Path & slug utilities.
 *
 * Claude Code derives a "project slug" from a working directory and stores
 * session files under ~/.claude/projects/<slug>/<uuid>.jsonl. The slug is
 * produced by normalizing the path to forward slashes and replacing every
 * character that is not [A-Za-z0-9._-] with a dash (so non-ASCII characters,
 * spaces, the drive colon and path separators all become dashes).
 */

/** Directory that holds all per-project session folders. */
export function claudeProjectsDir(): string {
  const override = process.env.CSM_PROJECTS_DIR;
  if (override) return path.resolve(override);
  return path.join(os.homedir(), '.claude', 'projects');
}

/**
 * Claude's global config directory (~/.claude) — holds CLAUDE.md,
 * settings.json, agents/, skills/, commands/ and friends.
 * CSM_CONFIG_DIR overrides it (used by tests and custom setups).
 */
export function claudeConfigDir(): string {
  const override = process.env.CSM_CONFIG_DIR;
  if (override) return path.resolve(override);
  return path.join(os.homedir(), '.claude');
}

/** Path of the top-level ~/.claude.json config file (sits next to ~/.claude). */
export function claudeJsonPath(): string {
  return path.join(path.dirname(claudeConfigDir()), '.claude.json');
}

/** Directory used by this tool for its own state (index, trash, logs). */
export function stateDir(): string {
  const override = process.env.CSM_STATE_DIR;
  if (override) return path.resolve(override);
  return path.join(os.homedir(), '.claude-session-manager');
}

export function indexFilePath(): string {
  return path.join(stateDir(), 'index.json');
}

export function trashDir(): string {
  return path.join(stateDir(), 'trash');
}

/** Default directory where `csm backup` archives are written. */
export function backupsDir(): string {
  return path.join(stateDir(), 'backups');
}

export function logDir(): string {
  return path.join(stateDir(), 'logs');
}

/**
 * Convert a filesystem path to Claude Code's project slug.
 *
 * Empirically verified against Claude Code storage: the path is normalized to
 * forward slashes and every character outside [A-Za-z0-9-] (drive colon,
 * separators, spaces, non-ASCII characters, underscores, dots) becomes a dash.
 *
 * @example
 *   toSlug('F:\\Github\\api_tester')   // 'F--Github-api-tester'
 *   toSlug('/home/me/proj')            // '-home-me-proj'
 */
export function toSlug(p: string): string {
  const normalized = p.replaceAll('\\', '/');
  return normalized.replace(/[^A-Za-z0-9-]/g, '-');
}

/**
 * Best-effort inverse of {@link toSlug}. The mapping is lossy for paths that
 * contained dashes or non-ASCII characters, so the result is only used as a
 * display fallback when the real path cannot be recovered from a session's
 * cwd field.
 */
export function fromSlug(slug: string): string {
  // Drive-letter slug: F--Github-Main -> F:/Github/Main.
  // The first two dashes encode the colon (X:) and the following slash.
  if (/^[A-Za-z]--/.test(slug)) {
    return `${slug[0]}:${slug.slice(2).replaceAll('-', '/')}`;
  }
  // POSIX slug: -home-me-proj -> /home/me/proj.
  if (slug.startsWith('-')) {
    return `/${slug.slice(1).replaceAll('-', '/')}`;
  }
  return slug;
}

/**
 * Read the native project path recorded inside a session file's first user
 * message. This is the authoritative source for the real path, since slugs
 * are lossy. Returns undefined when not determinable.
 */
export async function extractProjectPathFromFile(filePath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 128 * 1024 });
    let buffer = '';
    let settled = false;
    const finish = (value?: string) => {
      if (settled) return;
      settled = true;
      stream.destroy();
      resolve(value);
    };
    stream.on('data', (chunk: string | Buffer) => {
      if (typeof chunk !== 'string') return;
      buffer += chunk;
      // Process complete lines only.
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as { cwd?: string };
          if (parsed.cwd) {
            finish(parsed.cwd);
            return;
          }
        } catch {
          // Skip malformed lines.
        }
      }
      // Stop early once we have plenty of data to find the first user message.
      if (buffer.length > 1024 * 1024) finish();
    });
    stream.on('end', () => finish());
    stream.on('error', () => finish());
  });
}

/** Ensure the state directory (and subdirectories) exist. */
export function ensureStateDir(): void {
  for (const dir of [stateDir(), trashDir(), logDir(), backupsDir()]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}
