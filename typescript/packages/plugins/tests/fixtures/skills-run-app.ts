import { Application, Command } from '@loomcli/core';
import type { ReleaseFacts } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';

import { runOnMock } from './in-process.ts';
import { skillsDeclaration } from './skills-declaration.mjs';
import type { SkillEntry } from './skills-declaration.mjs';

interface Scenario {
  cwd: string;
  env: Record<string, string | undefined>;
  loaded: string;
  skills: readonly SkillEntry[];
  platform?: string | undefined;
  release?: ReleaseFacts;
  columns?: number | undefined;
}

/** The same declarations serve the isolated run and the process fixture's ceiling trap. */
function skillsApplication(scenario: Scenario) {
  return new Application('notes', {
    description: 'Keep notes in sync.',
    plugins: [help(), skillsDeclaration(scenario.skills, scenario.loaded)],
  }).command(
    new Command('ping', { description: 'Answer.' }).action(({ out }) => out.print('pong')),
  );
}

async function run(argv: string[], scenario: Scenario) {
  return await runOnMock(skillsApplication(scenario), {
    argv,
    cwd: scenario.cwd,
    env: scenario.env,
    home: scenario.env.HOME ?? '',
    platform: scenario.platform ?? 'linux',
    release: scenario.release ?? { build: 'distributed' },
    ...(scenario.columns === undefined
      ? {}
      : { terminal: { columns: scenario.columns, rows: 24 } }),
  });
}

export { run, skillsApplication };
export type { Scenario };
