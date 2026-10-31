import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll } from 'vite-plus/test';

import { childEnvironment } from '../../../scripts/test-process.js';

const roots: string[] = [];

/** Pristine repositories live for the file; every test works on its own complete copy. */
const templates = new Map<string, { base: string; root: string }>();

afterAll(() => {
  for (const { root } of templates.values()) {
    rmSync(root, { force: true, recursive: true });
  }
  templates.clear();
});

// Creates a temporary directory that removeRoots() deletes when the test ends.
export function temporaryRoot(prefix: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

export function removeRoots() {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
}

/**
 * Runs git in a fixture repository. Commits carry a fixed date so fragment order and history stay
 * reproducible, and git runs in the fixture's environment, so a developer's git configuration, such
 * as tag signing, never applies.
 */
export function git(root: string, args: string[], date = '2026-01-01T12:00:00Z') {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: childEnvironment({ GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }),
  });
  if (result.status !== 0) {
    throw new Error(result.stderr);
  }
  return result.stdout.trim();
}

export function put(root: string, path: string, body: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body);
}

export function commit(root: string, date?: string) {
  git(root, ['add', '.']);
  git(
    root,
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'],
    date,
  );
  return git(root, ['rev-parse', 'HEAD']);
}

// Initializes each distinct starting history once, then copies it without sharing mutable Git state.
export function repository(options: {
  files: Record<string, string>;
  prefix: string;
  tag?: string | undefined;
}) {
  const key = JSON.stringify({ files: options.files, tag: options.tag });
  let template = templates.get(key);
  if (template === undefined) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), options.prefix)));
    git(root, ['init', '-q']);
    git(root, ['config', 'core.autocrlf', 'false']);
    for (const [path, body] of Object.entries(options.files)) {
      put(root, path, body);
    }
    const base = commit(root);
    if (options.tag !== undefined) {
      git(root, ['tag', options.tag]);
    }
    template = { base, root };
    templates.set(key, template);
  }
  const root = temporaryRoot(options.prefix);
  cpSync(template.root, root, { recursive: true });
  return { base: template.base, root };
}

// A breaking fragment body with the change bullet and the five migration labels.
export const migration = `- Remove the old call.

### Migration

**Affected surface.** The call.

**Why.** Remove ambiguity.

**Before and after.**

\`\`\`ts
old();
\`\`\`

\`\`\`ts
updated();
\`\`\`

**Steps.**

1. Replace the call.

**Validation.** Run the tests.
`;
