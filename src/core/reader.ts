import fs from 'node:fs';
import type {
  RawLine,
  RawMessage,
  RawUsage,
  SessionMessage,
  TokenStats,
} from './types.js';

/**
 * JSONL session-file reading utilities.
 *
 * Session files can be very large (hundreds of MB), so everything here is
 * written to stream in bounded chunks rather than loading whole files into
 * memory.
 */

/** Plain-text flattening of a Claude message `content` value. */
export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
      continue;
    }
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (typeof b.text === 'string' && b.text.trim()) {
      parts.push(b.text);
      continue;
    }
    if (typeof b.thinking === 'string' && b.thinking.trim()) {
      parts.push(b.thinking);
      continue;
    }
    if (typeof b.content === 'string' && b.content.trim()) {
      parts.push(b.content);
      continue;
    }
    if (Array.isArray(b.content)) {
      const nested = contentToText(b.content);
      if (nested) parts.push(nested);
      continue;
    }
    if (b.type === 'tool_use') {
      parts.push(`[tool:${String(b.name ?? '?')}]`);
      continue;
    }
    if (b.type === 'tool_result') {
      parts.push('[tool result]');
      continue;
    }
  }
  return parts.filter((s) => s.trim()).join('\n');
}

/** Convert a raw `usage` payload into {@link TokenStats}, or undefined when empty. */
export function usageToTokenStats(usage: RawUsage | undefined): TokenStats | undefined {
  if (!usage) return undefined;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  if (input === 0 && output === 0 && cacheCreation === 0 && cacheRead === 0) {
    return undefined;
  }
  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreationInputTokens: cacheCreation,
    cacheReadInputTokens: cacheRead,
    totalTokens: input + output + cacheCreation + cacheRead,
  };
}

/**
 * Iterate the parseable lines of a JSONL file asynchronously.
 * Malformed lines are skipped. The caller can stop early by returning false
 * from the callback.
 */
export async function forEachLine(
  filePath: string,
  onLine: (line: RawLine, lineNumber: number) => boolean | void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 256 * 1024 });
    let buffer = '';
    let lineNumber = 0;
    let stopped = false;

    const stop = (): void => {
      stopped = true;
      stream.destroy();
      resolve();
    };

    const processBuffer = (): void => {
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        lineNumber += 1;
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as RawLine;
          const keepGoing = onLine(parsed, lineNumber);
          if (keepGoing === false) {
            stop();
            return;
          }
        } catch {
          // Skip malformed JSON lines; they should not break the scan.
        }
      }
    };

    stream.on('data', (chunk: string | Buffer) => {
      if (stopped || typeof chunk !== 'string') return;
      buffer += chunk;
      processBuffer();
    });
    stream.on('end', () => {
      if (stopped) return;
      // Handle the final unterminated line.
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim()) as RawLine;
          onLine(parsed, lineNumber + 1);
        } catch {
          // Ignore trailing partial lines.
        }
      }
      resolve();
    });
    stream.on('error', reject);
  });
}

/** Count lines in a JSONL file by counting newlines in bounded chunks. */
export async function countLines(filePath: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { highWaterMark: 256 * 1024 });
    let count = 0;
    stream.on('data', (chunk: string | Buffer) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      for (let i = 0; i < buf.length; i += 1) {
        if (buf[i] === 0x0a) count += 1;
      }
    });
    stream.on('end', () => resolve(count));
    stream.on('error', reject);
  });
}

/** Metadata extracted cheaply from the head of a session file. */
export interface SessionMeta {
  title?: string;
  firstPrompt: string;
  cwd?: string;
  gitBranch?: string;
  startTime?: string;
  lastTime?: string;
  lineCount: number;
  fileSize: number;
}

/**
 * Extract metadata by reading only the head and tail of a session file.
 * Avoids a full read for the common list/index path.
 */
export async function extractSessionMeta(filePath: string): Promise<SessionMeta> {
  const stat = await fs.promises.stat(filePath).catch(() => undefined);
  const fileSize = stat?.size ?? 0;

  const meta: SessionMeta = {
    firstPrompt: '',
    lineCount: 0,
    fileSize,
    lastTime: stat ? stat.mtime.toISOString() : '',
  };

  // Head pass: find title, first prompt, cwd, branch, start time.
  await forEachLine(filePath, (line) => {
    if (line.aiTitle) meta.title = line.aiTitle;
    if (!meta.firstPrompt) {
      if (typeof line.lastPrompt === 'string' && line.lastPrompt.trim()) {
        meta.title ??= line.lastPrompt;
      }
      const msg = line.message;
      if (msg && typeof msg.content === 'string' && msg.content.trim()) {
        const text = msg.content.trim();
        if (line.type === 'user' || msg.role === 'user') {
          meta.firstPrompt = text;
          meta.cwd = line.cwd;
          meta.gitBranch = line.gitBranch;
          meta.startTime = line.timestamp;
          return false; // We have what we need — stop early.
        }
      }
    }
    return undefined;
  });

  // Tail pass: find the last recorded timestamp. Read the final chunk only.
  if (fileSize > 0) {
    const tailSize = Math.min(fileSize, 256 * 1024);
    const handle = await fs.promises.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(tailSize);
      await handle.read(buffer, 0, tailSize, fileSize - tailSize);
      const text = buffer.toString('utf8');
      const lines = text.split('\n').filter((l) => l.trim());
      // Walk backwards looking for a line with a timestamp.
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
          const parsed = JSON.parse(lines[i]!.trim()) as RawLine;
          if (parsed.timestamp) {
            meta.lastTime = parsed.timestamp;
            break;
          }
        } catch {
          // Skip.
        }
      }
    } finally {
      await handle.close();
    }
  }

  meta.lineCount = await countLines(filePath);

  // Fallback title from first prompt when aiTitle is absent.
  if (!meta.title && meta.firstPrompt) {
    meta.title = meta.firstPrompt.split('\n')[0]!.trim().slice(0, 120);
  }

  return meta;
}

/** Extract all assistant-message token usage for a session. */
export async function aggregateTokens(filePath: string): Promise<TokenStats | undefined> {
  const totals: Required<TokenStats> = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
  };
  let found = false;
  await forEachLine(filePath, (line) => {
    const msg = line.message;
    if (!msg) return;
    const stats = usageToTokenStats(msg.usage);
    if (!stats) return;
    found = true;
    totals.inputTokens += stats.inputTokens;
    totals.outputTokens += stats.outputTokens;
    totals.cacheCreationInputTokens += stats.cacheCreationInputTokens;
    totals.cacheReadInputTokens += stats.cacheReadInputTokens;
  });
  if (!found) return undefined;
  totals.totalTokens =
    totals.inputTokens +
    totals.outputTokens +
    totals.cacheCreationInputTokens +
    totals.cacheReadInputTokens;
  return totals;
}

/** Convert a raw line into a display {@link SessionMessage}. */
function toSessionMessage(line: RawLine): SessionMessage | undefined {
  const msg: RawMessage | undefined = line.message;
  if (!msg) return undefined;

  const timestamp = line.timestamp ?? '';
  const text = contentToText(msg.content);

  if (msg.role === 'user') {
    return { role: 'user', timestamp, text, cwd: line.cwd, gitBranch: line.gitBranch };
  }
  if (msg.role === 'assistant') {
    // Tool invocations carry no text; surface the tool name instead.
    const toolName = extractToolName(msg.content);
    return {
      role: 'assistant',
      timestamp,
      text,
      toolName,
      usage: usageToTokenStats(msg.usage),
    };
  }
  return undefined;
}

function extractToolName(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const toolUse = content.find(
    (b): b is { type: string; name?: string } =>
      typeof b === 'object' && b !== null && (b as { type?: string }).type === 'tool_use',
  );
  return toolUse?.name;
}

/** Read the first `count` user/assistant messages of a session. */
export async function readFirstMessages(filePath: string, count: number): Promise<SessionMessage[]> {
  const out: SessionMessage[] = [];
  await forEachLine(filePath, (line) => {
    if (out.length >= count) return false;
    const msg = toSessionMessage(line);
    if (msg) out.push(msg);
    return undefined;
  });
  return out;
}

/** Read the last `count` user/assistant messages of a session (full pass). */
export async function readLastMessages(filePath: string, count: number): Promise<SessionMessage[]> {
  const out: SessionMessage[] = [];
  await forEachLine(filePath, (line) => {
    const msg = toSessionMessage(line);
    if (!msg) return;
    out.push(msg);
    if (out.length > count) out.shift();
  });
  return out;
}
