import { Command, plugin } from '@loomcli/core';
import type { ActionContext, Plugin } from '@loomcli/core';
import { oneOf } from '@loomcli/validators';

import { installGlobal, uninstallGlobal } from './global.js';
import type { ChildRun } from './global.js';
import { directoryNeedsProject, installProject } from './project.js';
import { recordCall } from './registry.js';
import { identity, judgeSettings } from './settings.js';
import type { Declared } from './settings.js';
import type { SkillsSettings } from './types.js';

/** `claude`, or `agents` for Codex and the other agents that read the shared folder. */
const agentInput = oneOf(['claude', 'agents']);

/** What every child reads from its action context. */
type ChildContext = Pick<ActionContext<unknown>, 'graph' | 'host' | 'out' | 'signal'>;

/** The run a child acts on, read from its action context. */
function childRun(context: ChildContext): ChildRun {
  const { graph, host, out, signal } = context;
  return {
    host,
    info: (message) => out.info(message),
    name: graph.name,
    signal,
    success: (message) => out.success(message),
    warn: (message) => out.warn(message),
  };
}

/** `install`: global folders recorded in the installation record, or `--project` copies at the repository root. */
function installCommand(declared: Declared) {
  return new Command('install', { description: 'Install the skills for your coding agents.' })
    .option('agent', {
      description:
        'The agents to install for: claude, or agents for Codex and others. Both when left out.',
      type: 'string',
      validate: agentInput,
    })
    .option('project', {
      description: 'Install into the current repository instead of your home folder.',
      type: 'boolean',
    })
    .option('directory', {
      description: 'Find the repository from this directory instead of the current one.',
      short: 'C',
      type: 'string',
    })
    .option('force', {
      description: 'Replace skill files that something else wrote or that you changed.',
      type: 'boolean',
    })
    .action(async (context) => {
      const { agent, directory, force, project } = context.options;
      const run = childRun(context);
      if (project) {
        await installProject(run, { agent, directory, skills: declared });
        return;
      }
      if (directory !== undefined) {
        throw directoryNeedsProject();
      }
      await installGlobal(run, { agent, force, skills: declared, verb: 'install' });
    });
}

/** `update`: the skills of each target whose record lists folders, brought up to date. */
function updateCommand(declared: Declared) {
  return new Command('update', {
    description: 'Bring installed skills up to date with this version.',
  }).action(async (context) => {
    await installGlobal(childRun(context), {
      agent: undefined,
      force: false,
      skills: declared,
      verb: 'update',
    });
  });
}

/** `uninstall`: every recorded folder of the selected targets, removed whole. */
function uninstallCommand() {
  return new Command('uninstall', { description: 'Remove the skills from your coding agents.' })
    .option('agent', {
      description: 'The agents to remove the skills from: claude or agents. Both when left out.',
      type: 'string',
      validate: agentInput,
    })
    .action(async (context) => {
      await uninstallGlobal(childRun(context), context.options.agent);
    });
}

/** The `skills` group and its three children. */
function skillsCommand(declared: Declared) {
  return new Command('skills', { description: "Install this application's agent skills." })
    .command(installCommand(declared))
    .command(updateCommand(declared))
    .command(uninstallCommand());
}

/**
 * A plugin that installs the application's agent skills where coding agents read them, keeps them
 * current with the binary, and removes them. Its whole contribution is the `skills` group. Each
 * call is recorded in the registry `loom build` reads to carry the skills folder.
 */
function skills(settings: SkillsSettings): Plugin {
  const declared = judgeSettings(settings);
  recordCall(declared);
  return plugin(identity, { commands: [skillsCommand(declared)] });
}

export type { RefreshContext, Skill, SkillFile, SkillsSettings } from './types.js';
export { refreshSkills } from './refresh.js';
export { skills };
