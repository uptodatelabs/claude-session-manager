import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Dim } from './Dim.js';
import { theme } from './theme.js';
import { tokensForSessions, buildProjectStats, sumTotals, type ProjectStats, type Totals } from '../core/stats.js';
import { formatTokens } from '../utils/format.js';
import type { SessionInfo } from '../core/types.js';

interface StatsViewProps {
  sessions: SessionInfo[];
  onBack: () => void;
}

/** Token statistics: per-project rows plus a global total. */
export function StatsView({ sessions }: StatsViewProps): React.ReactElement {
  const [projects, setProjects] = useState<ProjectStats[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const tokenMap = await tokensForSessions(sessions);
        const ps = await buildProjectStats(sessions, tokenMap);
        const totals = sumTotals(ps);
        if (!cancelled) {
          setProjects(ps);
          setTotals(totals);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessions]);

  if (error) {
    return <Text color={theme.danger}>Failed to load stats: {error}</Text>;
  }
  if (!projects || !totals) {
    return <Dim>Computing token statistics…</Dim>;
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold color={theme.primary}>
        Token Statistics
      </Text>
      <Box marginTop={1} flexDirection="column">
        {projects.map((p) => (
          <Box key={p.project.slug} flexDirection="column" marginBottom={1}>
            <Text bold>
              {p.project.slug}
            </Text>
            <Box paddingLeft={2}>
              <Dim>
                {p.sessionCount} sessions · in {formatTokens(p.inputTokens)} · out {formatTokens(p.outputTokens)} · cache rd {formatTokens(p.cacheReadTokens)} · cache cr {formatTokens(p.cacheCreationTokens)}
              </Dim>
            </Box>
            <Box paddingLeft={2}>
              <Text color={theme.warn}>total {formatTokens(p.totalTokens)}</Text>
            </Box>
          </Box>
        ))}
      </Box>
      {totals && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Totals</Text>
          <Box paddingLeft={2}>
            <Dim>
              {totals.projectCount} projects · {totals.sessionCount} sessions
            </Dim>
          </Box>
          <Box paddingLeft={2}>
            <Text color={theme.warn}>total {formatTokens(totals.totalTokens)}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
