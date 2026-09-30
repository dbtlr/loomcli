import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const roots: string[] = [];

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

// Commits carry a fixed date so fragment order and history stay reproducible.
export function git(root: string, args: string[], date = '2026-01-01T12:00:00Z') {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
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

// Initializes a repository from the supplied files and commits them as its first commit.
export function repository(options: {
  files: Record<string, string>;
  prefix: string;
  tag?: string | undefined;
}) {
  const root = temporaryRoot(options.prefix);
  git(root, ['init', '-q']);
  git(root, ['config', 'core.autocrlf', 'false']);
  for (const [path, body] of Object.entries(options.files)) {
    put(root, path, body);
  }
  const base = commit(root);
  if (options.tag !== undefined) {
    git(root, ['tag', options.tag]);
  }
  return { base, root };
}
