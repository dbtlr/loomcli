/**
 * The shells `completion install`, `update`, and `uninstall` act on: which shell the operator
 * means, where each one's script goes, what the script holds, and the startup line that loads it.
 */
import { dirname, join } from 'node:path';

import { escapeControlCharacters } from '@loomcli/core';
import type { Host } from '@loomcli/core';

import { absoluteVariable, homeRefusal, requiredHome } from '../application-folders.js';
import { exists } from '../installation/disk.js';
import { bashScript } from './bash.js';
import { fishScript } from './fish.js';
import { refusals } from './messages.js';
import { identifier, posixQuoted, powershellQuoted, scriptName } from './name.js';
import { powershellScript } from './powershell.js';
import { zshInstalledScript } from './zsh.js';

/** The shells completion installs for, in the order `uninstall` with no shell follows. */
const shells = ['bash', 'zsh', 'fish', 'powershell', 'pwsh'] as const;

type Shell = (typeof shells)[number];

/** A shell whose startup file loads the script through a line: every one but Fish. */
type LineShell = Exclude<Shell, 'fish'>;

/** Whether a shell runs PowerShell's script, whose startup file PowerShell reports. */
function isPowershell(shell: Shell): shell is 'powershell' | 'pwsh' {
  return shell === 'powershell' || shell === 'pwsh';
}

/** The shell a name is, or none for any other name. */
function shellNamed(name: string): Shell | undefined {
  return shells.find((shell) => shell === name);
}

/** A variable of the host's environment, read without case on `win32`, where names have none. */
function variable(host: Host, name: string): string | undefined {
  if (host.platform !== 'win32') {
    return host.env[name];
  }
  const wanted = name.toLowerCase();
  const found = Object.keys(host.env).find((key) => key.toLowerCase() === wanted);
  return found === undefined ? undefined : host.env[found];
}

/** The index `slice` reads the last two entries of a list from. */
const lastTwo = -2;

/** The folders of a path, split at `/` and `\`, with empty ones left out. */
function foldersOf(path: string): string[] {
  return path.split(/[/\\]/u).filter((part) => part !== '');
}

/**
 * Whether `PSModulePath` lists a folder whose last two folders are `PowerShell` and `Modules`,
 * compared without case: a module folder PowerShell 7 adds to every program it starts.
 */
function listsPowershell7Modules(modulePath: string | undefined): boolean {
  return (modulePath ?? '').split(';').some((entry) => {
    const [edition, modules] = foldersOf(entry).slice(lastTwo);
    return edition?.toLowerCase() === 'powershell' && modules?.toLowerCase() === 'modules';
  });
}

/**
 * The shell `SHELL` names by its last segment, none when it is unset or empty, or the operator's
 * usage error for any other value.
 */
function loginShell(name: string, host: Host): Shell | undefined {
  const login = variable(host, 'SHELL');
  if (login === undefined || login === '') {
    return undefined;
  }
  const shell = shellNamed(login.split(/[/\\]/u).pop() ?? '');
  if (shell === undefined) {
    throw refusals.unknownShell(name, login);
  }
  return shell;
}

/**
 * The shell `install` acts on: its argument, else the last segment of `SHELL` when it names one of
 * the five, else, on `win32` with `SHELL` unset or empty, `pwsh` or `powershell` by `PSModulePath`.
 * Any other `SHELL` is the operator's usage error.
 */
function selectedShell(name: string, host: Host, argument: Shell | undefined): Shell {
  const shell = argument ?? loginShell(name, host);
  if (shell !== undefined) {
    return shell;
  }
  if (host.platform === 'win32') {
    return listsPowershell7Modules(variable(host, 'PSModulePath')) ? 'pwsh' : 'powershell';
  }
  throw refusals.unknownShell(name, undefined);
}

/** The data folder: `LOCALAPPDATA` on `win32`, else an absolute `XDG_DATA_HOME`, else under the home. */
function dataFolder(name: string, host: Host): string {
  if (host.platform === 'win32') {
    const local = absoluteVariable(host, 'LOCALAPPDATA');
    if (local === undefined) {
      throw homeRefusal(name, 'LOCALAPPDATA');
    }
    return local;
  }
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
      const file = `_loom_${identifier(scriptName(name))}`;
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

/** The PowerShell script's path on `win32`, through `LOCALAPPDATA`, so the line is ASCII. */
function localAppDataScript(name: string, shell: 'powershell' | 'pwsh'): string {
  return `"$env:LOCALAPPDATA\\${name}\\completion\\${name}.${shell}.ps1"`;
}

/** What a startup line names: the shell, the application, the script's path, and the platform. */
interface LineRequest {
  readonly shell: LineShell;
  readonly name: string;
  readonly script: string;
  readonly platform: string;
}

/** The line a shell's startup file holds to load the script at `script`. */
function startupLine({ name, platform, script, shell }: LineRequest): string {
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
      const quoted =
        platform === 'win32' ? localAppDataScript(name, shell) : powershellQuoted(script);
      return `if (Test-Path -LiteralPath ${quoted}) { . ${quoted} } ${marker(name)}`;
    }
  }
}

/** Whether a path holds a control character, which a startup line cannot carry. */
function holdsControlCharacter(path: string): boolean {
  return escapeControlCharacters(path) !== path;
}

export type { LineShell, Shell };
export {
  holdsControlCharacter,
  isPowershell,
  scriptContent,
  scriptPath,
  selectedShell,
  shells,
  startupLine,
  startupPath,
  variable,
};
