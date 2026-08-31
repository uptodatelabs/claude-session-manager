import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { ListView } from './ListView.js';
import { DetailView } from './DetailView.js';
import { StatsView } from './StatsView.js';
import { RestoreView } from './RestoreView.js';
import { Dim } from './Dim.js';
import { theme } from './theme.js';
import {
  deleteSession,
  backupSessionToPath,
  defaultBackupArchivePath,
  listBackupArchives,
  restoreBackup,
  type BackupArchive,
} from '../core/actions.js';
import { backupsDir } from '../core/paths.js';
import { loadFreshIndex } from '../utils/io.js';
import type { IndexData, SessionInfo } from '../core/types.js';

export type View = 'list' | 'detail' | 'stats' | 'restore';

interface AppProps {
  initialIndex: IndexData;
  scannedCount: number;
  onResume: (session: SessionInfo) => void;
}

/** Filter sessions by a case-insensitive query over common fields. */
export function filterSessions(sessions: SessionInfo[], query: string): SessionInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q) ||
      s.projectSlug.toLowerCase().includes(q) ||
      s.projectPath.toLowerCase().includes(q) ||
      s.firstPrompt.toLowerCase().includes(q),
  );
}

/**
 * Build a flat display row list: project headers interleaved with sessions.
 * Sessions within a project are sorted newest-first; projects are ordered by
 * their most recent activity.
 */
export function buildRows(sessions: SessionInfo[]): Array<{ kind: 'project'; slug: string } | { kind: 'session'; session: SessionInfo }> {
  const byProject = new Map<string, SessionInfo[]>();
  for (const s of sessions) {
    const list = byProject.get(s.projectSlug) ?? [];
    list.push(s);
    byProject.set(s.projectSlug, list);
  }
  const projects = [...byProject.entries()].sort((a, b) => {
    const lastA = Math.max(...a[1].map((s) => new Date(s.lastTime).getTime()));
    const lastB = Math.max(...b[1].map((s) => new Date(s.lastTime).getTime()));
    return lastB - lastA;
  });
  const rows: Array<{ kind: 'project'; slug: string } | { kind: 'session'; session: SessionInfo }> = [];
  for (const [slug, list] of projects) {
    const sorted = [...list].sort((a, b) => (a.lastTime < b.lastTime ? 1 : -1));
    rows.push({ kind: 'project', slug });
    for (const session of sorted) rows.push({ kind: 'session', session });
  }
  return rows;
}

/** Windowed slice of a list around the cursor for bounded rendering. */
export function windowSlice<T>(list: T[], cursor: number, size: number): T[] {
  if (list.length <= size) return list;
  let start = cursor - Math.floor(size / 2);
  start = Math.max(0, Math.min(start, list.length - size));
  return list.slice(start, start + size);
}

export function App({ initialIndex, scannedCount, onResume }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [sessions, setSessions] = useState<SessionInfo[]>(() => Object.values(initialIndex.sessions));
  const [view, setView] = useState<View>('list');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [archives, setArchives] = useState<BackupArchive[]>([]);
  const [restoreCursor, setRestoreCursor] = useState(0);
  const [confirmRestore, setConfirmRestore] = useState(false);
  // Backup confirmation: preview the exact archive path before writing it.
  const [backupPreview, setBackupPreview] = useState<{ session: SessionInfo; path: string } | null>(null);

  const filtered = useMemo(() => filterSessions(sessions, query), [sessions, query]);
  const rows = useMemo(() => buildRows(filtered), [filtered]);
  // Session rows only (project headers are not selectable).
  const sessionRows = useMemo(
    () => rows.filter((r): r is { kind: 'session'; session: SessionInfo } => r.kind === 'session'),
    [rows],
  );

  const detailSession = useMemo(
    () => sessions.find((s) => s.id === detailId),
    [sessions, detailId],
  );

  const selectedSession = sessionRows[cursor]?.session;
  // Flat index into `rows` (project headers + sessions) for windowing.
  const flatCursor = useMemo(() => {
    if (!selectedSession) return 0;
    return rows.findIndex((r) => r.kind === 'session' && r.session.id === selectedSession.id);
  }, [rows, selectedSession]);

  // Keep cursor in range when the list shrinks.
  useEffect(() => {
    if (cursor >= sessionRows.length && sessionRows.length > 0) {
      setCursor(sessionRows.length - 1);
    }
  }, [sessionRows.length, cursor]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const handleDelete = useCallback(async () => {
    const target = sessionRows[cursor];
    if (!target) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      flash('Press d again to confirm deletion');
      return;
    }
    setConfirmDelete(false);
    try {
      const entry = await deleteSession(target.session);
      setSessions((prev) => prev.filter((s) => s.id !== target.session.id));
      flash(`Deleted → ${entry.trashId}`);
    } catch (err) {
      flash(`Delete failed: ${(err as Error).message}`);
    }
  }, [sessionRows, cursor, confirmDelete, flash]);

  const handleResume = useCallback(() => {
    const target = detailSession ?? sessionRows[cursor]?.session;
    if (target) onResume(target);
  }, [detailSession, sessionRows, cursor, onResume]);

  /** Show the destination path and ask for confirmation before backing up. */
  const askBackup = useCallback(() => {
    const target = detailSession ?? sessionRows[cursor]?.session;
    if (!target) return;
    setBackupPreview({ session: target, path: defaultBackupArchivePath(target, backupsDir()) });
  }, [detailSession, sessionRows, cursor]);

  /** Execute the backup to the path shown in the confirmation prompt. */
  const handleBackup = useCallback(async () => {
    const preview = backupPreview;
    if (!preview) return;
    setBackupPreview(null);
    flash('Backing up…');
    try {
      const archive = await backupSessionToPath(preview.session, preview.path);
      flash(`Backed up → ${archive}`);
    } catch (err) {
      flash(`Backup failed: ${(err as Error).message}`);
    }
  }, [backupPreview, flash]);

  /** Cancel the pending backup confirmation. */
  const cancelBackup = useCallback(() => setBackupPreview(null), []);

  /** Open the restore picker, loading archives from the backups dir. */
  const openRestore = useCallback(async () => {
    setView('restore');
    setRestoreCursor(0);
    setConfirmRestore(false);
    const list = await listBackupArchives();
    setArchives(list);
  }, []);

  /** Restore the highlighted archive (Enter twice to confirm), then refresh. */
  const handleRestore = useCallback(async () => {
    const target = archives[restoreCursor];
    if (!target) return;
    if (!confirmRestore) {
      setConfirmRestore(true);
      flash('Press Enter again to confirm restore');
      return;
    }
    setConfirmRestore(false);
    flash('Restoring…');
    try {
      const restored = await restoreBackup(target.path);
      const { index } = await loadFreshIndex();
      setSessions(Object.values(index.sessions));
      flash(
        `Restored ${restored.sessions.length} session(s), ${restored.configFiles.length} config file(s)`,
      );
      setView('list');
    } catch (err) {
      flash(`Restore failed: ${(err as Error).message}`);
    }
  }, [archives, restoreCursor, confirmRestore, flash]);

  useInput(
    (input, key) => {
      // ── Search input mode ──────────────────────────────────────────────
      if (searching) {
        if (key.escape) {
          setSearching(false);
          setQuery('');
        }
        return;
      }

      // ── Backup confirmation (y/n) ──────────────────────────────────────
      if (backupPreview) {
        if (input === 'y') void handleBackup();
        else if (input === 'n' || key.escape) cancelBackup();
        return;
      }

      // ── Detail view keys ───────────────────────────────────────────────
      if (view === 'detail') {
        if (key.escape || input === 'q' || key.leftArrow) {
          setView('list');
          setDetailId(null);
        } else if (input === 'r') {
          handleResume();
        } else if (input === 'd') {
          handleDelete();
        } else if (input === 'b') {
          askBackup();
        }
        return;
      }

      // ── Stats view keys ────────────────────────────────────────────────
      if (view === 'stats') {
        if (key.escape || input === 'q' || key.leftArrow) setView('list');
        return;
      }

      // ── Restore picker keys ────────────────────────────────────────────
      if (view === 'restore') {
        if (key.escape || input === 'q') setView('list');
        else if (key.upArrow || input === 'k') setRestoreCursor((c) => Math.max(0, c - 1));
        else if (key.downArrow || input === 'j')
          setRestoreCursor((c) => Math.min(archives.length - 1, c + 1));
        else if (key.return) void handleRestore();
        return;
      }

      // ── List view keys ─────────────────────────────────────────────────
      if (key.upArrow || input === 'k') setCursor((c) => Math.max(0, c - 1));
      else if (key.downArrow || input === 'j') setCursor((c) => Math.min(sessionRows.length - 1, c + 1));
      else if (key.pageUp) setCursor((c) => Math.max(0, c - 10));
      else if (key.pageDown) setCursor((c) => Math.min(sessionRows.length - 1, c + 10));
      else if (input === '/' || input === 'f') setSearching(true);
      else if (input === 'g') setCursor(0);
      else if (input === 'G') setCursor(sessionRows.length - 1);
      else if (input === 's') setView('stats');
      else if (input === 'r') handleResume();
      else if (input === 'd') handleDelete();
      else if (input === 'b') askBackup();
      else if (input === 'R') void openRestore();
      else if (key.return) {
        const target = sessionRows[cursor];
        if (target) {
          setDetailId(target.session.id);
          setView('detail');
        }
      } else if (input === 'q') {
        exit();
      }
    },
    { isActive: !searching },
  );

  return (
    <Box flexDirection="column" height="100%">
      <Header count={filtered.length} total={sessions.length} view={view} scanned={scannedCount} />
      <SearchBar
        searching={searching}
        query={query}
        onChange={setQuery}
        onDone={() => setSearching(false)}
      />

      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        {view === 'list' && (
          <ListView rows={rows} cursor={flatCursor} selectedId={selectedSession?.id} />
        )}
        {view === 'detail' && detailSession && <DetailView session={detailSession} />}
        {view === 'stats' && <StatsView sessions={sessions} onBack={() => setView('list')} />}
        {view === 'restore' && (
          <RestoreView archives={archives} cursor={restoreCursor} confirm={confirmRestore} />
        )}
      </Box>

      {backupPreview && <BackupConfirm target={backupPreview} />}
      <Toast message={toast} />
      <Footer view={view} searching={searching} />
    </Box>
  );
}

/** Prompt shown before a backup writes anything: destination + y/n. */
function BackupConfirm(props: { target: { session: SessionInfo; path: string } }): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={theme.warn} bold>
        Back up "{props.target.session.title}"?
      </Text>
      <Text> → {props.target.path}</Text>
      <Dim>  includes session, project config (memory/CLAUDE.md), project-root files and global settings. y/n</Dim>
    </Box>
  );
}

function Header(props: { count: number; total: number; view: View; scanned: number }): React.ReactElement {
  return (
    <Box paddingX={1} paddingTop={1} paddingBottom={1}>
      <Text bold color={theme.primary}>
        {'█'} csm
      </Text>
      <Dim>  Claude Session Manager</Dim>
      <Box flexGrow={1} />
      <Dim>
        {props.view === 'list' ? `${props.count}/${props.total} sessions` : props.view}
        {props.scanned > 0 ? `  ·  ${props.scanned} new` : ''}
      </Dim>
    </Box>
  );
}

function SearchBar(props: {
  searching: boolean;
  query: string;
  onChange: (v: string) => void;
  onDone: () => void;
}): React.ReactElement {
  return (
    <Box paddingX={1}>
      {props.searching ? (
        <>
          <Text color={theme.warn}>/ </Text>
          <TextInput value={props.query} onChange={props.onChange} onSubmit={props.onDone} />
          <Dim>  (Enter to search, Esc to cancel)</Dim>
        </>
      ) : (
        <Dim>Press / to search</Dim>
      )}
    </Box>
  );
}

function Toast(props: { message: string | null }): React.ReactElement | null {
  if (!props.message) return null;
  return (
    <Box paddingX={1}>
      <Text color={theme.success}>{props.message}</Text>
    </Box>
  );
}

function Footer(props: { view: View; searching: boolean }): React.ReactElement {
  if (props.searching) return <Box height={1} />;
  const binds =
    props.view === 'list'
      ? '↑/↓ navigate  / search  Enter view  r resume  b backup  R restore  d delete  s stats  q quit'
      : props.view === 'detail'
        ? 'r resume  b backup  d delete  Esc back  q quit'
        : props.view === 'restore'
          ? '↑/↓ select  Enter restore (press twice)  Esc back'
          : 'Esc back  q quit';
  return (
    <Box paddingX={1} paddingBottom={1}>
      <Dim>{binds}</Dim>
    </Box>
  );
}
