/**
 * Claude Session Manager — core type definitions.
 *
 * These types model the data read from Claude Code's session storage
 * (~/.claude/projects/<slug>/<uuid>.jsonl) plus the index/derived data
 * the manager maintains itself.
 */

/** Aggregate token usage across the assistant messages of a session. */
export interface TokenStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** Sum of input + output (cache tokens excluded, they are a subset of input). */
  totalTokens: number;
}

/** A single session as recorded in ~/.claude/projects/<slug>/<uuid>.jsonl. */
export interface SessionInfo {
  /** Session UUID, equal to the .jsonl file basename. */
  id: string;
  /** Project slug, e.g. "F--Github-Main". */
  projectSlug: string;
  /** Real (native) project path extracted from the session's cwd field. */
  projectPath: string;
  /** Absolute path to the .jsonl file. */
  filePath: string;
  /** Display title: auto-generated aiTitle when available, else first prompt. */
  title: string;
  /** Plain-text of the first user prompt, used as title fallback & preview. */
  firstPrompt: string;
  /** ISO timestamp of the first user message. */
  startTime: string;
  /** ISO timestamp of the last recorded activity (content-derived). */
  lastTime: string;
  /** File modification time in ms — used to detect session changes cheaply. */
  mtimeMs: number;
  /** Git branch at session start, when available. */
  gitBranch?: string;
  /** Size of the .jsonl file in bytes. */
  size: number;
  /** Number of JSONL lines (approx. message count). Lazy; 0 when unknown. */
  lineCount: number;
  /** Token usage for the session. Lazy; undefined until aggregated. */
  tokenStats?: TokenStats;
  /** Whether token aggregation is currently running/finished for this session. */
  tokensLoaded?: boolean;
  /** True when the session file was deleted from disk but still in index. */
  stale?: boolean;
}

/** A single message rendered for the detail view. */
export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  /** ISO timestamp of the message. */
  timestamp: string;
  /** Human-readable text content (blocks flattened). */
  text: string;
  /** Tool name when the message is a tool_use invocation. */
  toolName?: string;
  /** Token usage attached to this message (assistant messages only). */
  usage?: TokenStats;
  /** Working directory recorded for user messages. */
  cwd?: string;
  /** Git branch recorded for user messages. */
  gitBranch?: string;
}

/** Lightweight per-project aggregate derived from the session index. */
export interface ProjectInfo {
  slug: string;
  path: string;
  sessionCount: number;
  totalSize: number;
  lastActivity: string;
}

/** Structure of the persisted index cache (~/.claude-session-manager/index.json). */
export interface IndexData {
  version: number;
  generatedAt: string;
  /** Session id -> session info. */
  sessions: Record<string, SessionInfo>;
  /** Project slug -> project info. */
  projects: Record<string, ProjectInfo>;
}

/** Flat, machine-readable CLI output row. */
export interface SessionListRow {
  id: string;
  project: string;
  title: string;
  startTime: string;
  lastTime: string;
  gitBranch?: string;
  size: number;
  totalTokens?: number;
}

/** Options shared by scanning/refresh operations. */
export interface ScanOptions {
  /** Skip reading session file content entirely (index-only, from cache). */
  useCache?: boolean;
  /** Force a full rescan ignoring cached mtimes. */
  force?: boolean;
}

/** Parsed token usage from a single assistant JSONL line. */
export interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** A raw parsed JSONL line, keyed by its 'type'. */
export interface RawLine {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  aiTitle?: string;
  lastPrompt?: string;
  message?: RawMessage;
  uuid?: string;
  [key: string]: unknown;
}

/** The 'message' payload of user/assistant lines. */
export interface RawMessage {
  role?: string;
  content?: unknown;
  model?: string;
  usage?: RawUsage;
  [key: string]: unknown;
}
