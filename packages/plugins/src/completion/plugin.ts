import { Command, locate, plugin } from '@loomcli/core';
import type { ActionContext, Plugin } from '@loomcli/core';
import { oneOf } from '@loomcli/validators';

import { packageName } from '../constants.js';
import { exactText } from '../exact-text.js';
import { answer } from './answer.js';
import { bashScript } from './bash.js';
import { fishScript } from './fish.js';
import { installShell } from './install.js';
import { powershellScript } from './powershell.js';
import type { ChildRun } from './run.js';
import { shells } from './shells.js';
import { uninstallShells } from './uninstall.js';
import { updateShells } from './update.js';
import { zshScript } from './zsh.js';

/** One child that prints the script its shell sources, for the application it is installed in. */
function shellCommand(name: string, shell: string, script: (application: string) => string) {
  return new Command(name, { description: `Print the ${shell} completion script.` }).action(
    ({ graph, out }) => out.render(script(graph.name), exactText),
  );
}

// The words arrive after a bare `--`, so the parser never reads one of them as an option.
const answerCommand = new Command('__complete', {
  description: 'Answer a completion script.',
  hidden: true,
}).action(({ graph, out, passthrough }) =>
  out.render(answer(graph, locate(graph, passthrough)), exactText),
);

/** The four shell names `install` and `uninstall` accept. */
const shellInput = oneOf(shells);

/** What every installing child reads from its action context. */
type ChildContext = Pick<ActionContext<unknown>, 'graph' | 'host' | 'out' | 'signal'>;

/** The run an installing child acts on, read from its action context. */
function childRun({ graph, host, out, signal }: ChildContext): ChildRun {
  return {
    host,
    info: (message) => out.info(message),
    name: graph.name,
    print: (message) => out.print(message),
    signal,
    success: (message) => out.success(message),
    warn: (message) => out.warn(message),
  };
}

/** `install`: the script and startup line of the shell its argument names, or the login shell. */
const installCommand = new Command('install', {
  description: 'Install completion for your shell.',
})
  .argument('shell', {
    description: 'The shell: bash, zsh, fish, or pwsh. Your login shell when left out.',
    validate: shellInput,
  })
  .action((context) => installShell(childRun(context), context.args.shell));

/** `update`: every recorded shell's script and line brought up to this version. */
const updateCommand = new Command('update', {
  description: 'Bring installed completion up to date with this version.',
}).action((context) => updateShells(childRun(context)));

/** `uninstall`: the script and line of the shell its argument names, or of every installed shell. */
const uninstallCommand = new Command('uninstall', {
  description: 'Remove completion from your shell.',
})
  .argument('shell', {
    description: 'The shell: bash, zsh, fish, or pwsh. Every installed shell when left out.',
    validate: shellInput,
  })
  .action((context) => uninstallShells(childRun(context), context.args.shell));

// This package compiles outside any Application's registration, so the Command requires no globals.
const completionCommand = new Command('completion', {
  description: 'Print or install a shell completion script.',
})
  .command(shellCommand('bash', 'Bash', bashScript))
  .command(shellCommand('zsh', 'Zsh', zshScript))
  .command(shellCommand('fish', 'Fish', fishScript))
  .command(shellCommand('powershell', 'PowerShell', powershellScript))
  .command(installCommand)
  .command(updateCommand)
  .command(uninstallCommand)
  .command(answerCommand);

/**
 * A plugin that prints Bash, Zsh, Fish, and PowerShell completion scripts, installs them into the
 * operator's shell on Linux and macOS, and answers them. Its whole contribution is the `completion`
 * Command; it declares no option, middleware, or extension.
 */
export function completion(): Plugin {
  return plugin(`${packageName}/completion`, { commands: [completionCommand] });
}

export type { RefreshContext } from '../refresh.js';
export { refreshCompletion } from './refresh.js';
