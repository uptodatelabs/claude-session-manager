import { describe, it, expect } from 'vitest';
import { toSlug, fromSlug, claudeProjectsDir, stateDir } from '../src/core/paths.js';

describe('toSlug', () => {
  it('converts a Windows path to a Claude Code slug', () => {
    expect(toSlug('F:\\Github\\Main')).toBe('F--Github-Main');
  });

  it('converts a forward-slash path', () => {
    expect(toSlug('F:/Github/MultiCode')).toBe('F--Github-MultiCode');
  });

  it('replaces non-ASCII and space characters with dashes', () => {
    const slug = toSlug('H:/한글 경로/내 프로젝트/Project/uptodatelabs');
    // Result must contain only [A-Za-z0-9-] and must match the character rule.
    expect(/^[A-Za-z0-9-]+$/.test(slug)).toBe(true);
    expect(slug.endsWith('-Project-uptodatelabs')).toBe(true);
    expect(slug.startsWith('H-')).toBe(true);
  });

  it('replaces underscores with dashes (verified against real Claude data)', () => {
    expect(toSlug('F:\\Github\\api_tester')).toBe('F--Github-api-tester');
  });

  it('handles a POSIX path', () => {
    expect(toSlug('/home/me/proj')).toBe('-home-me-proj');
  });

  it('keeps existing dashes but replaces dots', () => {
    expect(toSlug('C:/a.b_c-d')).toBe('C--a-b-c-d');
  });
});

describe('fromSlug', () => {
  it('reconstructs a drive path', () => {
    expect(fromSlug('F--Github-Main')).toBe('F:/Github/Main');
  });

  it('reconstructs a POSIX path', () => {
    expect(fromSlug('-home-me-proj')).toBe('/home/me/proj');
  });
});

describe('paths', () => {
  it('resolves claude projects dir under the home directory', () => {
    expect(claudeProjectsDir()).toMatch(/[\\/]\.claude[\\/]projects$/);
  });

  it('resolves state dir', () => {
    expect(stateDir()).toMatch(/[\\/]\.claude-session-manager$/);
  });
});
