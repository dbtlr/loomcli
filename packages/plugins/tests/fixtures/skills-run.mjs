import { appendFileSync, readFileSync } from 'node:fs';

import { Application, Command } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { skills } from '@loomcli/plugins/skills';

/**
 * One run of an application that installs `skills()`. The scenario file, named by
 * `SKILLS_SCENARIO`, holds the skills with the files each loader answers, the host's environment,
 * working directory, and platform, the umask, and the file each loader call is appended to. A
 * skill with `throws` has a loader that rejects, and one with `result` answers that value as given.
 */
const scenario = JSON.parse(readFileSync(process.env.SKILLS_SCENARIO, 'utf8'));
const argv = process.argv.slice(2);

if (scenario.umask !== undefined) {
  process.umask(scenario.umask);
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
