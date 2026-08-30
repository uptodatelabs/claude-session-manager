import React from 'react';
import { Box, Text } from 'ink';
import { Dim } from './Dim.js';
import { theme } from './theme.js';
import { windowSlice } from './App.js';
import { formatSize, formatRelative } from '../utils/format.js';
import type { BackupArchive } from '../core/actions.js';

interface RestoreViewProps {
  archives: BackupArchive[];
  cursor: number;
  confirm: boolean;
}

const WINDOW = 12;

/** Archive picker for restoring backups created by `csm backup` / TUI `b`. */
export function RestoreView({ archives, cursor, confirm }: RestoreViewProps): React.ReactElement {
  if (archives.length === 0) {
    return (
      <Box flexDirection="column" paddingY={2}>
        <Dim>No backup archives found.</Dim>
        <Dim>Create one with `b` on a session, or `csm backup --all`.</Dim>
      </Box>
    );
  }

  const visible = windowSlice(archives, cursor, WINDOW);

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold color={theme.primary}>
        Restore from backup
      </Text>
      <Dim>  {archives.length} archive(s)</Dim>
      <Box flexDirection="column" marginTop={1}>
        {visible.map((a) => {
          const isSelected = archives.indexOf(a) === cursor;
          return (
            <Box key={a.path} flexDirection="column">
              <Box paddingLeft={isSelected ? 0 : 1}>
                <Text color={isSelected ? theme.accent : undefined} bold={isSelected}>
                  {isSelected ? '▶ ' : '  '}
                  {a.name}
                </Text>
              </Box>
              <Box paddingLeft={isSelected ? 4 : 5}>
                <Dim>
                  {formatRelative(new Date(a.mtimeMs).toISOString())} · {formatSize(a.size)}
                </Dim>
              </Box>
            </Box>
          );
        })}
      </Box>
      {confirm && (
        <Box marginTop={1}>
          <Text color={theme.warn} bold>
            ⚠ Restore will overwrite existing session files. Press Enter again to confirm.
          </Text>
        </Box>
      )}
    </Box>
  );
}
