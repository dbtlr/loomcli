/**
 * The shells `completion install`, `update`, and `uninstall` act on: which shell the operator
 * means, where each one's script goes, what the script holds, and the startup line that loads it.
 */
import { dirname, join } from 'node:path';

import { InputError } from '@loomcli/core';
import type { Host } from '@loomcli/core';

import { absoluteVariable, requiredHome } from '../application-folders.js';
import { exists } from '../installation/disk.js';
import { identifier, posixQuoted, powershellQuoted } from '../shell-quoting.js';
import { bashScript } from './bash.js';
import { fishScript } from './fish.js';
import { nuScript } from './nu.js';
import { completionPhrase } from './phrases.js';
import { powershellScript } from './powershell.js';
import { shells } from './shell-names.js';
import type { Shell } from './shell-names.js';
import { zshInstalledScript } from './zsh.js';

/** A shell that loads the script from a folder of its own: Fish and Nushell. */
type FolderShell = Extract<Shell, 'fish' | 'nu'>;

/** A shell whose startup file loads the script through a line: every one but Fish and Nushell. */
type LineShell = Exclude<Shell, FolderShell>;

/** The shell a name is, or none for any other name. */
function shellNamed(name: string): Shell | undefined {
  return shells.find((shell) => shell === name);
}

/** The usage error of a `SHELL` that names none of the five shells, on the `shell` argument. */
function unknownShell(name: string, login: string | undefined): InputError {
  return new InputError(completionPhrase('shellUnknown', name, login), [
    {
      input: { global: false, kind: 'argument', name: 'shell' },
      reason: 'missing',
      spelling: 'shell',
    },
  ]);
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
    throw unknownShell(name, login);
  }
  return shell;
}

/**
 * The shell `install` acts on: its argument, else the last segment of `SHELL` when it names one of
 * the five. An unset, empty, or any other `SHELL` is the operator's usage error.
 */
function selectedShell(name: string, host: Host, argument: Shell | undefined): Shell {
  const shell = argument ?? loginShell(name, host);
  if (shell === undefined) {
    throw unknownShell(name, undefined);
  }
  return shell;
}

/** The data folder: an absolute `XDG_DATA_HOME`, else `.local/share` under the home. */
function dataFolder(name: string, host: Host): string {
  return (
    absoluteVariable(host, 'XDG_DATA_HOME') ?? join(requiredHome(name, host), '.local', 'share')
  );
}

/**
 * The data folder Nushell reads its vendor autoload folder from: an absolute `XDG_DATA_HOME` on
 * every platform, else the platform's data folder, which on `darwin` is `Library/Application
 * Support` under the home and elsewhere `.local/share`.
 */
function nushellDataFolder(name: string, host: Host): string {
  const variable = absoluteVariable(host, 'XDG_DATA_HOME');
  if (variable !== undefined) {
    return variable;
  }
  return host.platform === 'darwin'
    ? join(requiredHome(name, host), 'Library', 'Application Support')
    : dataFolder(name, host);
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
    case 'nu': {
      return join(nushellDataFolder(name, host), 'nushell', 'vendor', 'autoload', `${name}.nu`);
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
    case 'nu': {
      return nuScript(name);
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
 * The startup file of Bash or Zsh, which the plugin computes. Fish and Nushell load the script from
 * their own folders, and PowerShell reports its own startup file, which `profile.ts` asks it for.
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

export type { FolderShell, LineShell };
export { scriptContent, scriptPath, selectedShell, startupLine, startupPath };
