import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import {
  contentToText,
  usageToTokenStats,
  extractSessionMeta,
  aggregateTokens,
  readFirstMessages,
  readLastMessages,
} from '../src/core/reader.js';
import { writeSession, defaultSessionLines } from './helpers.js';

describe('contentToText', () => {
  it('passes through plain strings', () => {
    expect(contentToText('hello')).toBe('hello');
  });

  it('flattens text blocks', () => {
    expect(contentToText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb');
  });

  it('extracts thinking blocks', () => {
    expect(contentToText([{ type: 'thinking', thinking: 'hmm' }])).toBe('hmm');
  });

  it('marks tool_use blocks', () => {
    expect(contentToText([{ type: 'tool_use', name: 'Bash' }])).toBe('[tool:Bash]');
  });

  it('handles nested content arrays', () => {
    expect(contentToText([{ type: 'tool_result', content: [{ type: 'text', text: 'out' }] }])).toBe(
      'out',
    );
  });

  it('returns empty for invalid input', () => {
    expect(contentToText(123)).toBe('');
    expect(contentToText(null)).toBe('');
    expect(contentToText([null, 5])).toBe('');
  });
});

describe('usageToTokenStats', () => {
  it('maps a full usage object', () => {
    const s = usageToTokenStats({
      input_tokens: 1,
      output_tokens: 2,
      cache_creation_input_tokens: 3,
      cache_read_input_tokens: 4,
    });
    expect(s).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      cacheCreationInputTokens: 3,
      cacheReadInputTokens: 4,
      totalTokens: 10,
    });
  });

  it('returns undefined for an all-zero usage', () => {
    expect(usageToTokenStats({ input_tokens: 0, output_tokens: 0 })).toBeUndefined();
  });

  it('returns undefined for missing usage', () => {
    expect(usageToTokenStats(undefined)).toBeUndefined();
  });
});

describe('extractSessionMeta', () => {
  it('extracts title, prompt, cwd, branch and timestamps from a fixture', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'csm-reader-'));
    const file = await writeSession(dir, 'a.jsonl', defaultSessionLines());
    try {
      const meta = await extractSessionMeta(file);
      expect(meta.title).toBe('첫 번째 테스트 세션');
      expect(meta.firstPrompt).toBe('첫 번째 요청: 테스트');
      expect(meta.cwd).toBe('F:/Github/TestProj');
      expect(meta.gitBranch).toBe('main');
      expect(meta.startTime).toBe('2026-08-01T10:00:00.000Z');
      expect(meta.lineCount).toBe(5);
      expect(meta.fileSize).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back to first prompt when no aiTitle is present', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'csm-reader-'));
    const lines = defaultSessionLines().map((l) =>
      l.includes('"aiTitle"') ? l.replace(/"aiTitle":"[^"]*",?/, '') : l,
    );
    const file = await writeSession(dir, 'a.jsonl', lines);
    try {
      const meta = await extractSessionMeta(file);
      expect(meta.title).toBe('첫 번째 요청: 테스트');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('skips malformed JSON lines without crashing', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'csm-reader-'));
    const file = await writeSession(dir, 'a.jsonl', [
      '{not json',
      ...defaultSessionLines(),
    ]);
    try {
      const meta = await extractSessionMeta(file);
      expect(meta.firstPrompt).toBe('첫 번째 요청: 테스트');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('aggregateTokens', () => {
  it('sums token usage across assistant messages', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'csm-reader-'));
    const file = await writeSession(dir, 'a.jsonl', defaultSessionLines());
    try {
      const stats = await aggregateTokens(file);
      expect(stats).toEqual({
        inputTokens: 30,
        outputTokens: 35,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 3,
        totalTokens: 70,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns undefined when a session has no assistant usage', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'csm-reader-'));
    const file = await writeSession(dir, 'a.jsonl', [defaultSessionLines()[0]!]);
    try {
      expect(await aggregateTokens(file)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('readFirstMessages / readLastMessages', () => {
  it('reads the first N messages in order', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'csm-reader-'));
    const file = await writeSession(dir, 'a.jsonl', defaultSessionLines());
    try {
      const msgs = await readFirstMessages(file, 2);
      expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(msgs[0]!.text).toBe('첫 번째 요청: 테스트');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads the last N messages', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'csm-reader-'));
    const file = await writeSession(dir, 'a.jsonl', defaultSessionLines());
    try {
      const msgs = await readLastMessages(file, 3);
      expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
      // Last assistant is a tool_use, surfaced as toolName.
      expect(msgs[1]!.toolName).toBe('Bash');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
