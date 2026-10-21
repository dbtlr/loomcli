/**
 * The shells `completion install`, `update`, and `uninstall` act on: which shell the operator
 * means, where each one's script goes, what the script holds, and the startup line that loads it.
 */
import { dirname, join } from 'node:path';

import type { Host } from '@loomcli/core';

import { absoluteVariable, requiredHome } from '../application-folders.js';
import { exists } from '../installation/disk.js';
import { bashScript } from './bash.js';
import { fishScript } from './fish.js';
import { refusals } from './messages.js';
import { identifier, posixQuoted, powershellQuoted } from './name.js';
import { powershellScript } from './powershell.js';
import { zshInstalledScript } from './zsh.js';

/**
 * The shells completion installs for on Linux and macOS, in the order `uninstall` with no shell
 * follows. `pwsh` is PowerShell 7, which runs the script `completion powershell` prints.
 */
const shells = ['bash', 'zsh', 'fish', 'pwsh'] as const;

type Shell = (typeof shells)[number];

/** A shell whose startup file loads the script through a line: every one but Fish. */
type LineShell = Exclude<Shell, 'fish'>;

/** The shell a name is, or none for any other name. */
function shellNamed(name: string): Shell | undefined {
  return shells.find((shell) => shell === name);
}

/**
 * The shell `SHELL` names by its last segment, none when it is unset or empty, or the operator's
 * usage error for any other value.
 */
function loginShell(name: string, host: Host): Shell | undefined {
  const login = host.env.SHELL;
  if (login === undefined || login === '') {
    return undefined;
  }
  const shell = shellNamed(login.split('/').pop() ?? '');
  if (shell === undefined) {
    throw refusals.unknownShell(name, login);
  }
  return shell;
}

/**
 * The shell `install` acts on: its argument, else the last segment of `SHELL` when it names one of
 * the four. An unset, empty, or any other `SHELL` is the operator's usage error.
 */
function selectedShell(name: string, host: Host, argument: Shell | undefined): Shell {
  const shell = argument ?? loginShell(name, host);
  if (shell === undefined) {
    throw refusals.unknownShell(name, undefined);
  }
  return shell;
}

/** The data folder: an absolute `XDG_DATA_HOME`, else `.local/share` under the home. */
function dataFolder(name: string, host: Host): string {
  return (
    absoluteVariable(host, 'XDG_DATA_HOME') ?? join(requiredHome(name, host), '.local', 'share')
  );
}

/** The configuration folder: an absolute `XDG_CONFIG_HOME`, else `.config` under the home. */
function configFolder(name: string, host: Host): string {
  return absoluteVariable(host, 'XDG_CONFIG_HOME') ?? join(requiredHome(name, host), '.config');
}

/** The path of a shell's script, under the folders the host's environment names. */
function scriptPath(shell: Shell, name: string, host: Host): string {
  switch (shell) {
    case 'bash': {
      return join(dataFolder(name, host), name, 'completion', `${name}.bash`);
    }
    case 'zsh': {
      const file = `_loom_${identifier(name)}`;
      return join(dataFolder(name, host), name, 'completion', 'zsh', file);
    }
    case 'fish': {
      return join(configFolder(name, host), 'fish', 'completions', `${name}.fish`);
    }
    default: {
      return join(dataFolder(name, host), name, 'completion', `${name}.${shell}.ps1`);
    }
  }
}

/** The script a shell's file holds. */
function scriptContent(shell: Shell, name: string): string {
  switch (shell) {
    case 'bash': {
      return bashScript(name);
    }
    case 'zsh': {
      return zshInstalledScript(name);
    }
    case 'fish': {
      return fishScript(name);
    }
    default: {
      return powershellScript(name);
    }
  }
}

/** The Bash startup file on `darwin`: the first login file that exists, else `.bash_profile`. */
function darwinBashStartup(home: string): string {
  const candidates = ['.bash_profile', '.bash_login', '.profile'].map((file) => join(home, file));
  return candidates.find(exists) ?? join(home, '.bash_profile');
}

/**
 * The startup file of Bash or Zsh, which the plugin computes. Fish loads the script from its own
 * folder, and PowerShell reports its own startup file, which `profile.ts` asks it for.
 */
function startupPath(shell: 'bash' | 'zsh', name: string, host: Host): string {
  if (shell === 'zsh') {
    return join(absoluteVariable(host, 'ZDOTDIR') ?? requiredHome(name, host), '.zshrc');
  }
  const home = requiredHome(name, host);
  return host.platform === 'darwin' ? darwinBashStartup(home) : join(home, '.bashrc');
}

/** What every startup line ends with: a comment naming the install Command. */
function marker(name: string): string {
  return `# added by ${name} completion install`;
}

/** What a startup line names: the shell, the application, and the script's path. */
interface LineRequest {
  readonly shell: LineShell;
  readonly name: string;
  readonly script: string;
}

/** The line a shell's startup file holds to load the script at `script`. */
function startupLine({ name, script, shell }: LineRequest): string {
  switch (shell) {
    case 'bash': {
      const quoted = posixQuoted(script);
      return `if [ -n "\${BASH_VERSION-}" ] && [ -f ${quoted} ]; then . ${quoted}; fi ${marker(name)}`;
    }
    case 'zsh': {
      const quoted = posixQuoted(script);
      return `fpath=(${posixQuoted(dirname(script))} $fpath); if [ -f ${quoted} ]; then . ${quoted}; fi ${marker(name)}`;
    }
    default: {
      const quoted = powershellQuoted(script);
      return `if (Test-Path -LiteralPath ${quoted}) { . ${quoted} } ${marker(name)}`;
    }
  }
}

export type { LineShell, Shell };
export { scriptContent, scriptPath, selectedShell, shells, startupLine, startupPath };
