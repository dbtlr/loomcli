import fs, { appendFileSync, readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname, isAbsolute, relative, sep } from 'node:path';

import { Application, Command } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { skills } from '@loomcli/plugins/skills';

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
 */
const scenario = JSON.parse(readFileSync(process.env.SKILLS_SCENARIO, 'utf8'));
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

/** A file as the loader answers it: text, or the bytes the scenario lists. */
function fileOf({ bytes, content, executable, path }) {
  return {
    content: bytes === undefined ? content : Uint8Array.from(bytes),
    ...(executable === undefined ? {} : { executable }),
    path,
  };
}

/** The skill a scenario entry describes, its loader recording each call. */
function skillOf(entry) {
  return {
    files: async () => {
      appendFileSync(scenario.loaded, `${entry.name}\n`);
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
}).command(new Command('ping', { description: 'Answer.' }).action(({ out }) => out.print('pong')));

process.exitCode = await app.run({
  host: {
    argv,
    cwd: scenario.cwd,
    env: scenario.env,
    platform: scenario.platform ?? 'linux',
    release: scenario.release ?? { build: 'distributed' },
  },
});
