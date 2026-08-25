import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import React from 'react';
import { render } from 'ink';
import { App, filterSessions, buildRows, windowSlice } from '../src/ui/App.js';
import type { IndexData, SessionInfo } from '../src/core/types.js';

/** A Writable that behaves like a TTY and captures output. */
class FakeStdout extends Writable {
  isTTY = true;
  columns = 100;
  rows = 40;
  output = '';
  constructor() {
    super({ write: (chunk, _enc, cb) => {
      this.output += chunk.toString();
      cb();
    } });
  }
}

/** A stdin stub with the surface Ink's useInput needs. */
class FakeStdin {
  isTTY = true;
  setRawMode = () => this;
  on = () => this;
  off = () => this;
  destroy = () => {};
  emit = () => {};
  unref = () => {};
  ref = () => {};
}

function makeSession(over: Partial<SessionInfo>): SessionInfo {
  return {
    id: 'abc12345-0000-4000-8000-000000000000',
    projectSlug: 'F--Github-Test',
    projectPath: 'F:/Github/Test',
    filePath: '/tmp/test.jsonl',
    title: 'Test session title',
    firstPrompt: 'hello',
    startTime: '2026-08-01T10:00:00.000Z',
    lastTime: '2026-08-01T11:00:00.000Z',
    mtimeMs: 1,
    size: 100,
    lineCount: 1,
    ...over,
  };
}

const index: IndexData = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sessions: {
    a: makeSession({ id: 'a', projectSlug: 'F--Github-Test', title: 'Alpha session' }),
    b: makeSession({ id: 'b', projectSlug: 'F--Github-Other', title: 'Beta session' }),
  },
  projects: {},
};

describe('TUI pure helpers', () => {
  it('filters by title and id substring', () => {
    const all = Object.values(index.sessions);
    expect(filterSessions(all, 'alpha')).toHaveLength(1);
    expect(filterSessions(all, 'f--github-other')).toHaveLength(1);
    expect(filterSessions(all, '')).toHaveLength(2);
    expect(filterSessions(all, 'zzz')).toHaveLength(0);
  });

  it('builds project-grouped rows with headers', () => {
    const rows = buildRows(Object.values(index.sessions));
    expect(rows[0]).toEqual({ kind: 'project', slug: expect.any(String) });
    expect(rows[1]).toEqual({ kind: 'session', session: expect.any(Object) });
    const projectKinds = rows.filter((r) => r.kind === 'project');
    expect(projectKinds).toHaveLength(2);
  });

  it('windows a list around the cursor', () => {
    const list = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(windowSlice(list, 5, 5)).toEqual([4, 5, 6, 7, 8]);
    expect(windowSlice(list, 0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(windowSlice(list, 9, 5)).toEqual([6, 7, 8, 9, 10]);
    expect(windowSlice(list, 0, 100)).toEqual(list);
  });
});

describe('TUI rendering (mock streams)', () => {
  it('renders the session list with titles', async () => {
    const stdout = new FakeStdout();
    const app = render(
      <App initialIndex={index} scannedCount={0} />,
      { stdout, stdin: new FakeStdin() as never, exitOnCtrlC: false },
    );
    // Allow Ink to flush output.
    await new Promise((r) => setTimeout(r, 100));
    expect(stdout.output).toContain('Alpha session');
    expect(stdout.output).toContain('Beta session');
    expect(stdout.output).toContain('Claude Session Manager');
    app.unmount();
  });
});
