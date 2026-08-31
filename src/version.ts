import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const pkg = require('../package.json') as {
  name: string;
  version: string;
  bin?: string | Record<string, string>;
  author?: string | { name?: string };
};

/** The executable name is derived from package.json's bin field. */
function binName(): string {
  if (typeof pkg.bin === 'string') return pkg.name;
  const keys = Object.keys(pkg.bin ?? {});
  return keys[0] ?? pkg.name;
}

/** Program label shown in the UI and CLI output. */
export const PROGRAM_NAME = binName();

/** Package version — package.json is the single source of truth. */
export const PROGRAM_VERSION = pkg.version;

/** Publisher / company name (package.json author field). */
export const COMPANY =
  typeof pkg.author === 'string' ? pkg.author : (pkg.author?.name ?? 'uptodatelabs');

/** One-line brand string, e.g. "csm v1.0.0 (uptodatelabs)". ASCII-only so it
 * renders correctly on legacy Windows codepages. */
export const BRAND = `${PROGRAM_NAME} v${PROGRAM_VERSION} (${COMPANY})`;
