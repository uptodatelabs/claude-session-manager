import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { loadFreshIndex } from '../utils/io.js';
import { resumeSession } from '../core/actions.js';
import type { SessionInfo } from '../core/types.js';

/**
 * Entry point for the TUI. Loads the session index, starts the Ink app, and
 * waits until the user exits or triggers an action (like resume) that requires
 * the TUI to be torn down first.
 */
/**
 * Hand the terminal fully back to Claude before spawning it.
 *
 * While the TUI is mounted, Ink keeps the console in raw mode with an active
 * stdin data listener. If Claude is spawned while either is still in place,
 * keystrokes and Ctrl+C are swallowed by csm and Claude appears to be
 * unresponsive (keys "dead", Ctrl+C does nothing). We therefore tear the TUI
 * down completely and force the console back to canonical mode before Claude
 * takes over.
 */
async function handTerminalToClaude(
  app: ReturnType<typeof render>,
  session: SessionInfo,
): Promise<void> {
  app.unmount();
  await app.waitUntilExit();
  try {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.removeAllListeners('data');
    }
  } catch {
    // stdin may already be torn down; nothing more to do.
  }
  try {
    resumeSession(session);
  } catch (err) {
    console.error(`[csm] Cannot resume session: ${(err as Error).message}`);
    process.exit(1);
  }
}

export async function renderTui(): Promise<void> {
  const { index, scanned } = await loadFreshIndex();

  const app = render(
    <App
      initialIndex={index}
      scannedCount={scanned}
      onResume={(session: SessionInfo) => {
        void handTerminalToClaude(app, session);
      }}
    />,
    { exitOnCtrlC: false },
  );

  await app.waitUntilExit();
}
