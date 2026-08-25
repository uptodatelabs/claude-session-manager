#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { program } from 'commander';
import { loadFreshIndex, findSession } from './utils/io.js';
import { c, formatSize, formatTokens, formatRelative, formatDateTime, truncate } from './utils/format.js';
import { tokensForSessions, buildProjectStats, sumTotals } from './core/stats.js';
import { resumeSession, deleteSession, listTrash, restoreFromTrash, purgeTrashEntry, backupSingleSession, backupSessions, restoreBackup, inspectBackup } from './core/actions.js';
import { readLastMessages } from './core/reader.js';
import { ensureStateDir } from './core/paths.js';
import type { SessionInfo } from './core/types.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

ensureStateDir();

program
  .name('csm')
  .description('Claude Session Manager — browse, search, resume, backup & analyze Claude Code sessions')
  .version(pkg.version)
  .option('--json', 'output in JSON format (machine-readable)')
  .hook('preAction', async () => {
    // Pre-action hook available for future use.
  });

// ─── list ───────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List sessions, newest first')
  .option('-p, --project <slug>', 'Filter by project slug')
  .option('-n, --limit <count>', 'Max sessions to show', parseInt)
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const { index } = await loadFreshIndex();
    let sessions = Object.values(index.sessions);
    if (opts.project) {
      sessions = sessions.filter((s) => s.projectSlug === opts.project);
    }
    sessions = sessions.sort(
      (a, b) => (a.lastTime < b.lastTime ? 1 : a.lastTime > b.lastTime ? -1 : 0),
    );
    if (opts.limit) sessions = sessions.slice(0, opts.limit);
    const useJson = opts.json ?? program.opts().json;

    if (useJson) {
      process.stdout.write(JSON.stringify(sessions, null, 2));
      return;
    }
    if (sessions.length === 0) {
      process.stdout.write('No sessions found.\n');
      return;
    }
    process.stdout.write(`\n  ${c.bold('Sessions')} (${sessions.length} total)\n\n`);
    for (const s of sessions) {
      const title = truncate(s.title, 50);
      const project = c.dim(s.projectSlug);
      const time = c.dim(formatRelative(s.lastTime));
      const size = c.dim(formatSize(s.size));
      process.stdout.write(`  ${s.id.slice(0, 8)}  ${title}  ${project}  ${time}  ${size}\n`);
    }
    process.stdout.write('\n');
  });

// ─── show ───────────────────────────────────────────────────────────────────
program
  .command('show')
  .description('Show session details and messages')
  .argument('<session-id>', 'Session ID or unique prefix')
  .option('--messages <count>', 'Number of recent messages to show', '10')
  .option('--json', 'Output as JSON')
  .action(async (sessionId, opts) => {
    const { index } = await loadFreshIndex();
    const session = findSession(index, sessionId);
    const useJson = opts.json ?? program.opts().json;

    if (useJson) {
      const messages = await readLastMessages(session.filePath, parseInt(opts.messages) || 10);
      process.stdout.write(JSON.stringify({ session, messages }, null, 2));
      return;
    }

    process.stdout.write(`\n  ${c.bold('Title:')}   ${session.title}\n`);
    process.stdout.write(`  ${c.bold('Session:')} ${session.id}\n`);
    process.stdout.write(`  ${c.bold('Project:')} ${session.projectSlug}\n`);
    process.stdout.write(`  ${c.bold('Path:')}   ${session.projectPath}\n`);
    process.stdout.write(`  ${c.bold('Size:')}   ${formatSize(session.size)} (${session.lineCount} lines)\n`);
    process.stdout.write(`  ${c.bold('Start:')}  ${formatDateTime(session.startTime)}\n`);
    process.stdout.write(`  ${c.bold('Last:')}   ${formatDateTime(session.lastTime)} (${formatRelative(session.lastTime)})\n`);
    if (session.gitBranch) process.stdout.write(`  ${c.bold('Branch:')} ${session.gitBranch}\n`);

    if (session.tokenStats) {
      process.stdout.write(`  ${c.bold('Tokens:')} ${formatTokens(session.tokenStats.totalTokens)}\n`);
    }

    process.stdout.write(`\n  ${c.bold('Recent messages:')}\n\n`);
    const messages = await readLastMessages(session.filePath, parseInt(opts.messages) || 10);
    for (const msg of messages) {
      const role = msg.role === 'user' ? c.green('user') : c.cyan('assistant');
      const time = c.dim(formatDateTime(msg.timestamp));
      const text = truncate(msg.text, 120);
      const tool = msg.toolName ? c.yellow(` [tool:${msg.toolName}]`) : '';
      process.stdout.write(`  ${role} ${time}${tool}\n  ${c.dim('|')} ${text}\n\n`);
    }
  });

// ─── resume ─────────────────────────────────────────────────────────────────
program
  .command('resume')
  .description('Resume a session in Claude Code')
  .argument('<session-id>', 'Session ID or unique prefix')
  .action(async (sessionId) => {
    const { index } = await loadFreshIndex();
    const session = findSession(index, sessionId);
    process.stdout.write(`Resuming session ${session.id} in ${session.projectPath}...\n`);
    try {
      await resumeSession(session);
      process.exit(0);
    } catch (err) {
      console.error(c.red(`[csm] ${(err as Error).message}`));
      process.exit(1);
    }
  });

// ─── rm (delete) ────────────────────────────────────────────────────────────
program
  .command('rm')
  .description('Delete a session (move to trash)')
  .argument('<session-id>', 'Session ID or unique prefix')
  .action(async (sessionId) => {
    const { index } = await loadFreshIndex();
    const session = findSession(index, sessionId);
    const entry = await deleteSession(session);
    process.stdout.write(`Moved to trash: ${c.dim(entry.trashId)}\n`);
    process.stdout.write(`  Session: ${session.id}  Title: ${session.title}\n`);
    process.stdout.write(`  Use \`csm trash restore ${entry.trashId}\` to undo.\n`);
  });

// ─── trash ──────────────────────────────────────────────────────────────────
const trashCmd = program
  .command('trash')
  .description('Manage the trash (list, restore, purge)');

trashCmd
  .command('list')
  .description('List trashed sessions')
  .action(async () => {
    const entries = await listTrash();
    if (entries.length === 0) {
      process.stdout.write('Trash is empty.\n');
      return;
    }
    process.stdout.write(`\n  ${c.bold('Trash')} (${entries.length} items)\n\n`);
    for (const e of entries) {
      process.stdout.write(`  ${e.trashId}  ${truncate(e.title, 50)}  ${c.dim(e.projectSlug)}  ${c.dim(formatRelative(e.trashedAt))}\n`);
    }
    process.stdout.write('\n');
  });

trashCmd
  .command('restore')
  .description('Restore a session from trash')
  .argument('<trash-id>', 'Trash entry ID')
  .action(async (trashId) => {
    const entry = await restoreFromTrash(trashId);
    process.stdout.write(`Restored: ${entry.trashId}\n`);
    process.stdout.write(`  Session: ${entry.sessionId}  Title: ${entry.title}\n`);
  });

trashCmd
  .command('purge')
  .description('Permanently delete a trash entry')
  .argument('<trash-id>', 'Trash entry ID')
  .action(async (trashId) => {
    await purgeTrashEntry(trashId);
    process.stdout.write(`Purged: ${trashId}\n`);
  });

// ─── stats ──────────────────────────────────────────────────────────────────
program
  .command('stats')
  .description('Show token usage statistics')
  .option('-p, --project <slug>', 'Filter by project slug')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const { index } = await loadFreshIndex();
    const useJson = opts.json ?? program.opts().json;
    let sessions = Object.values(index.sessions);
    if (opts.project) {
      sessions = sessions.filter((s) => s.projectSlug === opts.project);
    }
    if (sessions.length === 0) {
      process.stdout.write('No sessions to analyze.\n');
      return;
    }

    if (!useJson) process.stdout.write('\n  Scanning tokens across sessions...\n');
    const tokenMap = await tokensForSessions(sessions);
    const projectStats = await buildProjectStats(sessions, tokenMap);
    const totals = sumTotals(projectStats);

    if (useJson) {
      process.stdout.write(JSON.stringify({ projects: projectStats, totals }, null, 2));
      return;
    }

    process.stdout.write(`\n  ${c.bold('Token Statistics')}\n\n`);
    for (const ps of projectStats) {
      process.stdout.write(`  ${c.cyan(ps.project.slug)}\n`);
      process.stdout.write(`    Sessions:  ${ps.sessionCount}\n`);
      process.stdout.write(`    Input:     ${formatTokens(ps.inputTokens)}\n`);
      process.stdout.write(`    Output:    ${formatTokens(ps.outputTokens)}\n`);
      process.stdout.write(`    Cache Rd:  ${formatTokens(ps.cacheReadTokens)}\n`);
      process.stdout.write(`    Cache Cr:  ${formatTokens(ps.cacheCreationTokens)}\n`);
      process.stdout.write(`    Total:     ${c.bold(formatTokens(ps.totalTokens))}\n\n`);
    }

    process.stdout.write(`  ${c.bold('Totals')}\n`);
    process.stdout.write(`    Projects:  ${totals.projectCount}\n`);
    process.stdout.write(`    Sessions:  ${totals.sessionCount}\n`);
    process.stdout.write(`    Total:     ${c.bold(formatTokens(totals.totalTokens))}\n\n`);
  });

// ─── backup ─────────────────────────────────────────────────────────────────
program
  .command('backup')
  .description('Backup sessions to a tar.gz archive')
  .argument('[session-id]', 'Session ID or unique prefix')
  .option('-p, --project <slug>', 'Backup all sessions in a project')
  .option('--all', 'Backup all sessions')
  .option('-o, --output <dir>', 'Output directory', process.cwd())
  .action(async (sessionId, opts) => {
    const { index } = await loadFreshIndex();
    let sessions: SessionInfo[] = [];

    if (sessionId) {
      sessions.push(findSession(index, sessionId));
    } else if (opts.project) {
      sessions = Object.values(index.sessions).filter((s) => s.projectSlug === opts.project);
    } else if (opts.all) {
      sessions = Object.values(index.sessions);
    } else {
      program.error('Provide a session id, --project, or --all');
    }

    if (sessions.length === 0) {
      process.stdout.write('No sessions to backup.\n');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (!fs.existsSync(opts.output)) {
      await fs.promises.mkdir(opts.output, { recursive: true });
    }
    const archivePath = path.join(opts.output, `${timestamp}_claude-sessions.tar.gz`);
    if (sessions.length === 1) {
      const single = await backupSingleSession(sessions[0]!, opts.output);
      process.stdout.write(`\n  ${c.bold('Backup created')}\n`);
      process.stdout.write(`  Archive: ${single}\n`);
      process.stdout.write(`  Sessions: 1\n`);
      return;
    }
    await backupSessions(sessions, archivePath);

    process.stdout.write(`\n  ${c.bold('Backup created')}\n`);
    process.stdout.write(`  Archive: ${archivePath}\n`);
    process.stdout.write(`  Sessions: ${sessions.length}\n`);
  });


// ─── restore ────────────────────────────────────────────────────────────────
program
  .command('restore')
  .description('Restore sessions from a backup archive')
  .argument('<archive>', 'Path to a .tar.gz backup file')
  .option('--remap <path>', 'Remap session cwd paths to this directory')
  .option('--skip-existing', 'Skip files that already exist')
  .option('--dry-run', 'Inspect the archive without restoring')
  .action(async (archive, opts) => {
    if (opts.dryRun) {
      const manifest = await inspectBackup(archive);
      process.stdout.write(`\n  ${c.bold('Backup manifest')}\n`);
      process.stdout.write(`  Created: ${manifest.createdAt}\n`);
      process.stdout.write(`  Sessions: ${manifest.sessions.length}\n\n`);
      for (const s of manifest.sessions) {
        process.stdout.write(`  ${s.sessionId}  ${truncate(s.title, 50)}  ${c.dim(s.projectSlug)}\n`);
        process.stdout.write(`    Original cwd: ${s.originalCwd}\n`);
      }
      process.stdout.write('\n');
      return;
    }

    process.stdout.write(`Restoring from ${archive}...\n`);
    const restored = await restoreBackup(archive, {
      remapCwd: opts.remap,
      skipExisting: opts.skipExisting,
    });
    process.stdout.write(`\n  ${c.bold('Restored')} ${restored.length} session(s)\n`);
    for (const f of restored) {
      process.stdout.write(`  ${c.dim(f)}\n`);
    }
    process.stdout.write('\n');
  });

// ─── TUI (default) ──────────────────────────────────────────────────────────
program
  .command('tui', { hidden: true })
  .description('Launch the TUI (default)')
  .action(async () => {
    process.stdout.write('Launching TUI...\n');
    // Lazy-import the TUI to avoid loading React on every CLI invocation.
    const { renderTui } = await import('./ui/index.js');
    await renderTui();
  });

// Default: if no command, launch TUI if TTY, else show help.
if (process.argv.slice(2).length === 0) {
  if (process.stdout.isTTY) {
    const { renderTui } = await import('./ui/index.js');
    await renderTui();
  } else {
    program.outputHelp();
  }
} else {
  program.parseAsync(process.argv).catch((err) => {
    console.error(c.red(`[csm] error: ${err.message}`));
    process.exit(1);
  });
}