import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** The comment that splits the recipe into the part an installer runs first and the part it runs last. */
const splitPoint = '# Once the verified binary is at $target:\n';

/**
 * The installer script's recipe for `install.json`, read from the contract's own block in
 * docs/core.md, so a test runs the bytes an installer author copies. The block sits in a list item,
 * indented two spaces.
 */
export function installationRecipe(): string {
  const contract = readFileSync(new URL('../docs/core.md', import.meta.url), 'utf8');
  const block = /\n {2}```sh\n(?<body>(?: {2}.*\n|\n)*?) {2}```\n/gu;
  for (const match of contract.matchAll(block)) {
    const body = match.groups?.body ?? '';
    if (body.includes("# $app is the application's name")) {
      return body.replaceAll(/^ {2}/gmu, '');
    }
  }
  throw new Error('docs/core.md holds no install.json recipe.');
}

/**
 * The recipe's two parts, split at its `# Once the verified binary is at $target:` line: `prepare`,
 * the lines above it, which an installer runs before it downloads, and `record`, that line and the
 * rest, which it runs once the verified binary is in place. Together they are the whole recipe.
 */
export function installationRecipeParts(): { prepare: string; record: string } {
  const recipe = installationRecipe();
  const split = recipe.indexOf(splitPoint);
  if (split === -1 || recipe.includes(splitPoint, split + 1)) {
    throw new Error('The install.json recipe in docs/core.md holds no single split point.');
  }
  return { prepare: recipe.slice(0, split), record: recipe.slice(split) };
}

/**
 * One run of the recipe under `/bin/sh` with `set -e`, as an installer script runs it, for the
 * application `app` and the installed binary `target`, with only `PATH` and the supplied variables
 * in its environment.
 */
export function recordInstallation(
  app: string,
  target: string,
  env: Record<string, string | undefined>,
) {
  const result = spawnSync('/bin/sh', ['-c', `set -e\n${installationRecipe()}`], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...env, app, target },
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}
