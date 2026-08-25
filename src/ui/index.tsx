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
export async function renderTui(): Promise<void> {
  const { index, scanned } = await loadFreshIndex();

  const app = render(
    <App
      initialIndex={index}
      scannedCount={scanned}
      onResume={(session: SessionInfo) => {
        app.unmount();
        resumeSession(session);
      }}
    />,
    { exitOnCtrlC: false },
  );

  await app.waitUntilExit();
}
