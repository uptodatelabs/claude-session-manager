import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import { loadFreshIndex } from '../utils/io.js';

/**
 * Entry point for the TUI. Loads the session index and starts the Ink app.
 * Resume is handled inside the App via Ink's official `suspendTerminal` API,
 * so the terminal handoff is managed by Ink itself.
 */
export async function renderTui(): Promise<void> {
  const { index, scanned } = await loadFreshIndex();

  const app = render(
    <App initialIndex={index} scannedCount={scanned} />,
    { exitOnCtrlC: false },
  );

  await app.waitUntilExit();
}
