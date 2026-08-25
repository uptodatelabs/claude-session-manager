import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Dim } from './Dim.js';
import { theme } from './theme.js';
import { readFirstMessages, readLastMessages, aggregateTokens } from '../core/reader.js';
import { formatDateTime, formatRelative, formatSize, formatTokens, truncate } from '../utils/format.js';
import type { SessionInfo, SessionMessage, TokenStats } from '../core/types.js';

interface DetailViewProps {
  session: SessionInfo;
}

const HEAD_MSGS = 6;
const TAIL_MSGS = 12;

/** Session detail: metadata header plus first/last messages and token usage. */
export function DetailView({ session }: DetailViewProps): React.ReactElement {
  const [head, setHead] = useState<SessionMessage[]>([]);
  const [tail, setTail] = useState<SessionMessage[]>([]);
  const [tokens, setTokens] = useState<TokenStats | undefined>(session.tokenStats);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [h, t] = await Promise.all([
        readFirstMessages(session.filePath, HEAD_MSGS),
        readLastMessages(session.filePath, TAIL_MSGS),
      ]);
      const tok = await aggregateTokens(session.filePath).catch(() => undefined);
      if (!cancelled) {
        setHead(h);
        setTail(t);
        if (tok) setTokens(tok);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.filePath]);

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>{session.title}</Text>
        <Dim>Session {session.id}</Dim>
        <Dim>{session.projectSlug}</Dim>
        <Dim>
          {formatDateTime(session.startTime)} → {formatDateTime(session.lastTime)} ({formatRelative(session.lastTime)})
        </Dim>
        <Dim>
          {formatSize(session.size)} · {session.lineCount} lines
          {session.gitBranch ? ` · ${session.gitBranch}` : ''}
        </Dim>
        {tokens && <Text color={theme.warn}>tokens: {formatTokens(tokens.totalTokens)}</Text>}
      </Box>

      <Box flexDirection="column">
        <Text bold color={theme.primary}>
          Beginning
        </Text>
        {head.length === 0 && loading ? <Dim>Loading…</Dim> : head.map((m, i) => <MessageRow key={`h${i}`} msg={m} />)}
      </Box>

      {tail.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={theme.primary}>
            Recent
          </Text>
          {tail.map((m, i) => (
            <MessageRow key={`t${i}`} msg={m} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function MessageRow({ msg }: { msg: SessionMessage }): React.ReactElement {
  const role = msg.role === 'user' ? theme.success : theme.primary;
  const label = msg.role === 'user' ? 'user' : 'asst';
  const time = msg.timestamp ? ` ${formatDateTime(msg.timestamp).slice(11)}` : '';
  const tool = msg.toolName ? ` [tool:${msg.toolName}]` : '';
  const text = truncate(msg.text || (msg.toolName ? `(tool call: ${msg.toolName})` : '(no text)'), 160);
  return (
    <Box flexDirection="column" paddingY={0}>
      <Dim color={role}>
        {label}
        {time}
        <Text color={role}>
          {tool}
        </Text>
      </Dim>
      <Box paddingLeft={2}>
        <Text>{text}</Text>
      </Box>
    </Box>
  );
}
