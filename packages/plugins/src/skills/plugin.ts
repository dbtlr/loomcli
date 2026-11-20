import { Command, plugin } from '@loomcli/core';
import type { ActionContext, CommandGraph, Plugin } from '@loomcli/core';
import { oneOf } from '@loomcli/validators';

import { isEmpty } from '../help-cells.js';
import { json } from '../json-views.js';
import { skillCommand } from './extension.js';
import type { ChildRun } from './global.js';
import { recordedSkills, recordGraph } from './graphs.js';
import type { SkillsReader } from './graphs.js';
import { renderReferences } from './references.js';
import { recordCall } from './registry.js';
import { selectedCommands } from './selection.js';
import { identity, judgeSettings } from './settings.js';
import type { Declared } from './settings.js';
import { statusText } from './status-text.js';
import type { Target } from './targets.js';
import type {
  SkillStatus,
  CommandReferenceFile,
  CommandReferenceSettings,
  SkillFolder,
  SkillFoldersOptions,
  FolderSkillsSettings,
  SkillsSettings,
} from './types.js';

/** `claude`, or `agents` for Codex and the other agents that read the shared folder. */
const agentInput = oneOf(['claude', 'agents']);

/** What every child reads from its action context. */
type ChildContext = Pick<ActionContext<unknown>, 'graph' | 'host' | 'log' | 'out' | 'signal'>;

/** The run a child acts on, read from its action context. */
function childRun(context: ChildContext): ChildRun {
  const { graph, host, log, out, signal } = context;
  return {
    graph,
    host,
    info: (message) => out.info(message),
    log,
    name: graph.name,
    signal,
    success: (message) => out.success(message),
    warn: (message) => out.warn(message),
  };
}

/** What `install` reads from its options, beside the declared skills. */
interface InstallOptions {
  readonly skills: Declared;
  readonly agent: Target | undefined;
  readonly directory: string | undefined;
  readonly force: boolean;
  readonly project: boolean;
}

/** Installs into the project or the home folder, loading the child's work when it runs. */
async function install(run: ChildRun, options: InstallOptions): Promise<void> {
  const { agent, directory, force, project, skills: declared } = options;
  if (project) {
    const { installProject } = await import('./project.js');
    await installProject(run, { agent, directory, skills: declared });
    return;
  }
  if (directory !== undefined) {
    const { directoryNeedsProject } = await import('./project.js');
    throw directoryNeedsProject();
  }
  const { installGlobal } = await import('./global.js');
  await installGlobal(run, { agent, force, skills: declared, verb: 'install' });
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
      await install(childRun(context), { ...context.options, skills: declared });
    });
}

/** `update`: the skills of each target whose record lists folders, brought up to date. */
function updateCommand(declared: Declared) {
  return new Command('update', {
    description: 'Bring installed skills up to date with this version.',
  }).action(async (context) => {
    const { installGlobal } = await import('./global.js');
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
      const { uninstallGlobal } = await import('./global.js');
      await uninstallGlobal(childRun(context), context.options.agent);
    });
}

/** Reports each declared skill without changing its installation. */
function statusCommand(declared: Declared) {
  return new Command('status', {
    description: 'Report whether each skill is installed and up to date.',
  })
    .option('agent', {
      description: 'The agents to report on: claude or agents. Both when left out.',
      type: 'string',
      validate: agentInput,
    })
    .option('project', {
      description: "Report on the current repository's skills instead of your home folder's.",
      type: 'boolean',
    })
    .option('directory', {
      description: 'Find the repository from this directory instead of the current one.',
      short: 'C',
      type: 'string',
    })
    .rows<SkillStatus>({ views: { text: { row: statusText } } })
    .views({ json: json<readonly SkillStatus[]>() })
    .action(async (context) => {
      const { statusRows } = await import('./status.js');
      const result = await statusRows(childRun(context), declared, context.options);
      await context.out.results(result.rows);
      for (const notice of result.notices) {
        await context.out.info(notice);
      }
    });
}

/** The `skills` group and its four children. */
function skillsCommand(declared: Declared) {
  return new Command('skills', { description: "Install this application's agent skills." })
    .command(installCommand(declared))
    .command(updateCommand(declared))
    .command(uninstallCommand())
    .command(statusCommand(declared));
}

/**
 * The reader of one `skills()` call: every declared skill with every file an install writes,
 * read and generated as an install does. It reads no host fact, so a missing folder is named as
 * the setting names it, as an unbuilt run's is.
 */
function readerOf(declared: Declared): SkillsReader {
  return async (graph, options) => {
    const { loadSkills } = await import('./load.js');
    const loaded = await loadSkills(declared, {
      build: 'source',
      graph,
      moduleDirectory: options.moduleDirectory,
    });
    return loaded.skills;
  };
}

/**
 * A plugin that installs the application's agent skills where coding agents read them, keeps them
 * current with the binary, and removes them, and generates a command reference for each Command a
 * skill selects. It contributes the `skills` group, the `skillCommand` extension, and a graph hook
 * that judges the Commands each skill selects and records which call built the graph. Each call is
 * recorded in the registry `loom build` reads to carry the skills folder, and each child loads its
 * work when it runs.
 *
 * @example
 * ```ts
 * import { Application, Command } from '@loomcli/core';
 * import { skills } from '@loomcli/plugins/skills';
 *
 * export const app = new Application('notes', {
 *   plugins: [
 *     skills({
 *       folder: new URL('../skills/', import.meta.url),
 *       skills: [{ name: 'notes', commands: [['note']] }],
 *     }),
 *   ],
 * }).command(new Command('note', { description: 'Work with notes.' }).action(() => {}));
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/skills.md
 *
 * @public
 */
function skills(settings: SkillsSettings | FolderSkillsSettings): Plugin {
  const declared = judgeSettings(settings);
  recordCall(declared);
  const read = readerOf(declared);
  return plugin(identity, {
    commands: [skillsCommand(declared)],
    extensions: [skillCommand],
    onGraphBuilt: (graph) => {
      for (const { commands, name } of declared.selections) {
        if (!isEmpty(commands)) {
          selectedCommands(graph, commands, { skill: name });
        }
      }
      recordGraph(graph, read);
      return undefined;
    },
  });
}

/**
 * Renders the command references the given paths select, as a skill's `commands` selects them:
 * `index.md` first, then each Command's file in graph order, each by its file name alone. It
 * judges the paths as the build does and throws the first fault's `DeclarationError`; paths that
 * select no Command an operator can find give no file. It is synchronous, reads no host, writes
 * nothing, and gives the same bytes for the same graph and settings.
 *
 * @example
 * ```ts
 * import { Application, Command } from '@loomcli/core';
 * import { commandReferences } from '@loomcli/plugins/skills';
 *
 * const app = new Application('notes', { version: '1.4.0' }).command(
 *   new Command('list', { description: 'List the notes.' }).action(() => {}),
 * );
 *
 * export const files = commandReferences(app.inspect(), { commands: [[]], guidance: false });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/skills.md#reading-skills-outside-an-install
 *
 * @public
 */
function commandReferences(
  graph: CommandGraph,
  settings: CommandReferenceSettings,
): readonly CommandReferenceFile[] {
  return renderReferences(graph, settings);
}

/**
 * Resolves to each skill the graph's application declares, in install order, with every file an
 * install writes in the skill's folder, the generated command references included. It reads the
 * skills folder and calls each loader as an install in the same process does, resolving a relative
 * folder setting against `moduleDirectory`, and writes nothing. It resolves to `undefined` when the
 * application installed no skills plugin, the graph did not come from a build, or the
 * application's copy of `@loomcli/plugins` recorded nothing.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { skillFolders, skills } from '@loomcli/plugins/skills';
 *
 * const app = new Application('notes', {
 *   plugins: [
 *     skills({
 *       skills: [{ commands: [[]], files: () => [{ content: '# Notes\n', path: 'SKILL.md' }], name: 'notes' }],
 *     }),
 *   ],
 * });
 *
 * export const folders = await skillFolders(app.inspect());
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/skills.md#reading-skills-outside-an-install
 *
 * @public
 */
async function skillFolders(
  graph: CommandGraph,
  options: SkillFoldersOptions = {},
): Promise<readonly SkillFolder[] | undefined> {
  return await recordedSkills(graph, options);
}

export type {
  CommandReferenceFile,
  CommandReferenceSettings,
  FolderSkillCommands,
  RefreshContext,
  Skill,
  SkillState,
  SkillStatus,
  SkillFile,
  SkillFolder,
  SkillFoldersOptions,
  FolderSkillsSettings,
  SkillsSettings,
} from './types.js';
export { refreshSkills } from './refresh.js';
export { commandReferences, skillFolders, skills };

// The plugin pack's member of MessagePackages, which this entry's declarations load.
export type {} from '../registry.js';
