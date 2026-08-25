import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { Dim } from './Dim.js';
import { theme } from './theme.js';
import { windowSlice } from './App.js';
import { formatRelative, formatSize } from '../utils/format.js';
import type { SessionInfo } from '../core/types.js';

export type Row =
  | { kind: 'project'; slug: string }
  | { kind: 'session'; session: SessionInfo };

const WINDOW = 12;

interface ListViewProps {
  rows: Row[];
  cursor: number;
  selectedId?: string;
}

/** Render the windowed session list with project group headers. */
export function ListView({ rows, cursor, selectedId }: ListViewProps): React.ReactElement {
  const visible = useMemo(() => windowSlice(rows, cursor, WINDOW), [rows, cursor]);

  // Project slug -> session count, computed from the full row list.
  const projectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.kind === 'session') {
        counts.set(row.session.projectSlug, (counts.get(row.session.projectSlug) ?? 0) + 1);
      }
    }
    return counts;
  }, [rows]);

  if (rows.length === 0) {
    return (
      <Box paddingY={2}>
        <Dim>No sessions match.</Dim>
      </Box>
    );
  }

  const items = visible.map((row) => {
    if (row.kind === 'project') {
      return (
        <Box key={`p:${row.slug}`} paddingTop={1}>
          <Text bold color={theme.primary}>
            {row.slug}
          </Text>
          <Dim>  ({projectCounts.get(row.slug) ?? 0})</Dim>
        </Box>
      );
    }
    const s = row.session;
    const isSelected = s.id === selectedId;
    return (
      <Box key={`s:${s.id}`} flexDirection="column">
        <Box paddingLeft={isSelected ? 0 : 1}>
          <Text color={isSelected ? theme.accent : undefined} bold={isSelected}>
            {isSelected ? '▶ ' : '  '}
            {s.id.slice(0, 8)}  {s.title}
          </Text>
        </Box>
        <Box paddingLeft={isSelected ? 4 : 5}>
          <Dim>
            {formatRelative(s.lastTime)} · {formatSize(s.size)}
            {s.gitBranch ? ` · ${s.gitBranch}` : ''}
          </Dim>
        </Box>
      </Box>
    );
  });

  return <Box flexDirection="column">{items}</Box>;
}
