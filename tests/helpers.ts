import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';

/**
 * Test fixtures: build realistic Claude Code session files in a temp dir.
 */

export interface FakeLineOptions {
  cwd?: string;
  gitBranch?: string;
  aiTitle?: string;
}

export function userLine(prompt: string, ts: string, opts: FakeLineOptions = {}): string {
  return JSON.stringify({
    type: 'user',
    timestamp: ts,
    sessionId: 'test-session',
    uuid: 'uuid-1',
    message: { role: 'user', content: prompt },
    cwd: opts.cwd ?? 'F:/Github/TestProj',
    gitBranch: opts.gitBranch ?? 'main',
    aiTitle: opts.aiTitle,
    version: '2.1.0',
  });
}

export function assistantLine(
  ts: string,
  contentBlocks: unknown[],
  usage?: Record<string, number>,
  opts: { model?: string } = {},
): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    sessionId: 'test-session',
    uuid: 'uuid-2',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: contentBlocks,
      model: opts.model ?? 'claude-sonnet-4-5',
      usage,
    },
  });
}

export function systemLine(ts: string): string {
  return JSON.stringify({ type: 'system', timestamp: ts, sessionId: 'test-session' });
}

/** Write a fixture session file and return its path. */
export async function writeSession(
  dir: string,
  fileName: string,
  lines: string[],
): Promise<string> {
  const file = path.join(dir, fileName);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  // Write with a trailing newline, matching how Claude Code writes session files.
  await fs.promises.writeFile(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}

/** Create a temp directory that mirrors a ~/.claude/projects/<slug> layout. */
export async function makeProjectDir(): Promise<{
  root: string;
  projects: string;
  slug: string;
  file: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'csm-test-'));
  const projects = path.join(root, 'projects');
  const slug = 'F--Github-TestProj';
  await fs.promises.mkdir(path.join(projects, slug), { recursive: true });
  return { root, projects, slug, file: path.join(projects, slug, 'a.jsonl') };
}

/** Default fixture: a realistic small session. */
export function defaultSessionLines(cwd = 'F:/Github/TestProj'): string[] {
  return [
    userLine('첫 번째 요청: 테스트', '2026-08-01T10:00:00.000Z', { cwd, aiTitle: '첫 번째 테스트 세션' }),
    assistantLine(
      '2026-08-01T10:00:01.000Z',
      [{ type: 'text', text: '안녕하세요. 무엇을 도와드릴까요?' }],
      { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 },
    ),
    userLine('두 번째 요청', '2026-08-01T10:00:02.000Z', { cwd }),
    assistantLine(
      '2026-08-01T10:00:03.000Z',
      [{ type: 'tool_use', id: 'call_1', name: 'Bash', input: { command: 'ls' } }],
      { input_tokens: 20, output_tokens: 30 },
    ),
    userLine(
      '세 번째 요청',
      '2026-08-01T10:00:04.000Z',
      { cwd },
    ),
  ];
}
