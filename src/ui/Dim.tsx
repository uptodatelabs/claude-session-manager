import React from 'react';
import { Text } from 'ink';

/**
 * Renders gray-dimmed text. Ink 5 has no built-in `dim` prop, so we use
 * a gray color to simulate dimmed/less-emphasised text. An explicit `color`
 * overrides the default gray.
 */
export function Dim({ children, color }: { children: React.ReactNode; color?: string }): React.ReactElement {
  return <Text color={color ?? 'gray'}>{children}</Text>;
}