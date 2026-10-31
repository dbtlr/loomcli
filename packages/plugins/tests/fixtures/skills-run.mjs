import { createRequire, syncBuiltinESMExports } from 'node:module';
import { basename, dirname, isAbsolute, relative, sep } from 'node:path';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';

/**
 * One run of an application that installs `skills()`. The scenario file, named by
 * `SKILLS_SCENARIO`, holds the skills with the files each loader answers, the host's environment,
 * working directory, and platform, the umask, the file each loader call is appended to, and the
 * ceiling. A skill with `throws` has a loader that rejects, and one with `result` answers that
 * value as given.
 *
 * The ceiling is the sandbox root. A `.git` entry outside it reads as missing to an `lstatSync`
 * that answers `undefined` for a missing entry, as the project install's walk to a repository root
 * asks, so the walk never leaves the sandbox, whatever sits above the temporary directory on the
 * machine running the tests. The trap replaces `lstatSync` and resyncs the builtin's ESM exports.
 * Bun fixes a builtin's ESM exports at the first ESM import and ignores the resync, so the fixture
 * reads `node:fs` through `require` and imports the application only after the trap.
 */
const fs = createRequire(import.meta.url)('node:fs');
const scenario = JSON.parse(fs.readFileSync(process.env.SKILLS_SCENARIO, 'utf8'));
const argv = process.argv.slice(2);

if (scenario.umask !== undefined) {
  process.umask(scenario.umask);
}

/** Whether a path lies outside the ceiling. */
function aboveCeiling(path) {
  const inside = relative(scenario.ceiling, path);
  return inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside);
}

if (scenario.ceiling !== undefined) {
  const lstat = fs.lstatSync;
  fs.lstatSync = (path, options) =>
    options?.throwIfNoEntry === false && basename(path) === '.git' && aboveCeiling(dirname(path))
      ? undefined
      : lstat(path, options);
  syncBuiltinESMExports();
}

const { processHandle } = await import('@loomcli/core');
const { skillsApplication } = await import('./skills-run-app.ts');

process.exitCode = await skillsApplication(scenario).run({
  process: processHandle({
    argv,
    cwd: scenario.cwd,
    env: scenario.env,
    // The handle's home is the test's HOME as given, never the user database's.
    home: fixtureHome(scenario.env),
    platform: scenario.platform ?? 'linux',
    release: scenario.release ?? { build: 'distributed' },
    // A scenario with `columns` runs on a terminal that wide, so lanes wrap.
    ...(scenario.columns === undefined
      ? {}
      : {
          terminal: {
            stderr: { columns: scenario.columns, isTTY: true, rows: 24 },
            stdin: { isTTY: false },
            stdout: { columns: scenario.columns, isTTY: true, rows: 24 },
          },
        }),
  }),
});
