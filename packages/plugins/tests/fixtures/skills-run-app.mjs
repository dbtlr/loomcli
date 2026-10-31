import { createRequire, syncBuiltinESMExports } from 'node:module';
import { basename, dirname, isAbsolute, relative, sep } from 'node:path';

import { mockProcess } from '@loomcli/testing';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';

/** Runs the fixture on isolated process facts and returns its recorded output. */
async function run(args = [], given = {}) {
  const env = given.env ?? {};
  let status = 0;
  const output = mockProcess({ env });
  const handles = [output];
  let captured = output;
  const capture = (fields) => {
    const { terminal, ...facts } = fields;
    const handle = mockProcess({
      env,
      ...facts,
      ...(terminal !== undefined
        ? {
            terminal: {
              columns: terminal.stdout?.columns ?? terminal.stderr?.columns,
              rows: 24,
              streams: ['stdout', 'stderr'].filter((name) => terminal[name]?.isTTY),
              ...(terminal.background === undefined ? {} : { background: terminal.background }),
            },
          }
        : {}),
    });
    handles.push(handle);
    captured = handle;
    return handle;
  };

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

  const scenario = given;

  const argv = args;

  /** Whether a path lies outside the ceiling. */
  function aboveCeiling(path) {
    const inside = relative(scenario.ceiling, path);
    return inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside);
  }

  const originalLstat = fs.lstatSync;
  try {
    if (scenario.ceiling !== undefined) {
      const lstat = fs.lstatSync;
      fs.lstatSync = (path, options) =>
        options?.throwIfNoEntry === false &&
        basename(path) === '.git' &&
        aboveCeiling(dirname(path))
          ? undefined
          : lstat(path, options);
      syncBuiltinESMExports();
    }

    const { Application, Command } = await import('@loomcli/core');

    const { help } = await import('@loomcli/plugins/help');

    const { skills } = await import('@loomcli/plugins/skills');

    /** A file as the loader answers it: text, or the bytes the scenario lists. */

    /** The skill a scenario entry describes, its loader recording each call. */
    function skillOf(entry) {
      return {
        files: async () => {
          fs.appendFileSync(scenario.loaded, `${entry.name}\n`);
          if (entry.throws) {
            throw new Error(`The ${entry.name} loader failed.`);
          }
          return 'result' in entry ? entry.result : entry.files.map(fileOf);
        },
        name: entry.name,
      };
    }

    const app = new Application('notes', {
      description: 'Keep notes in sync.',
      plugins: [help(), skills({ skills: scenario.skills.map(skillOf) })],
    }).command(
      new Command('ping', { description: 'Answer.' }).action(({ out }) => out.print('pong')),
    );

    status = await app.run({
      process: capture({
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
  } finally {
    fs.lstatSync = originalLstat;
    syncBuiltinESMExports();
  }
  return {
    status: captured.exitCode ?? status,
    stderr: handles.map((handle) => handle.stderr.text).join(''),
    stdout: handles.map((handle) => handle.stdout.text).join(''),
  };
}

function fileOf({ bytes, content, executable, path }) {
  return {
    content: bytes === undefined ? content : Uint8Array.from(bytes),
    ...(executable === undefined ? {} : { executable }),
    path,
  };
}

export { run };
