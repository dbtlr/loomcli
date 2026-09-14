import { DeclarationError } from './errors.js';
import { isPlainObject } from './facts.js';
import type { Host } from './types.js';

type SwitchPolicy = 'auto' | 'always' | 'never';
interface RenderingPolicy {
  color?: SwitchPolicy | undefined;
  modifiers?: SwitchPolicy | undefined;
  hyperlinks?: SwitchPolicy | undefined;
  terminalControls?: 'strip' | 'preserve' | undefined;
}
interface Capabilities {
  color: boolean;
  modifiers: boolean;
  hyperlinks: boolean;
  terminalControls: boolean;
  depth: 16 | 256 | 'truecolor';
  mainGlyphs: boolean;
}

function renderingPolicy(value: unknown): RenderingPolicy {
  if (value === undefined) {
    return {};
  }
  if (!isPlainObject(value)) {
    throw new DeclarationError('The rendering policy must be an object.');
  }
  const result: RenderingPolicy = {};
  for (const field of ['color', 'modifiers', 'hyperlinks'] as const) {
    const policy = value[field];
    if (policy !== undefined && policy !== 'auto' && policy !== 'always' && policy !== 'never') {
      throw new DeclarationError(`Rendering ${field} must be auto, always, or never.`);
    }
    if (policy !== undefined) {
      result[field] = policy;
    }
  }
  const controls = value.terminalControls;
  if (controls !== undefined && controls !== 'strip' && controls !== 'preserve') {
    throw new DeclarationError('Rendering terminalControls must be strip or preserve.');
  }
  if (controls !== undefined) {
    result.terminalControls = controls;
  }
  return result;
}

function colorDepth(env: Host['env']): Capabilities['depth'] {
  if (
    env.COLORTERM === 'truecolor' ||
    env.COLORTERM === '24bit' ||
    ['xterm-kitty', 'xterm-ghostty', 'wezterm'].includes(env.TERM ?? '')
  ) {
    return 'truecolor';
  }
  if (env.TERM_PROGRAM === 'iTerm.app') {
    const major = /^\d+/u.exec(env.TERM_PROGRAM_VERSION ?? '')?.[0];
    return major !== undefined && Number(major) >= 3 ? 'truecolor' : 256;
  }
  return env.TERM_PROGRAM === 'Apple_Terminal' || /-256(?:color)?$/iu.test(env.TERM ?? '')
    ? 256
    : 16;
}

function mainGlyphs({ env, platform }: Pick<Host, 'env' | 'platform'>): boolean {
  if (platform !== 'win32') {
    return env.TERM !== 'linux';
  }
  return (
    Boolean(env.CI || env.WT_SESSION || env.TERMINUS_SUBLIME) ||
    env.ConEmuTask === '{cmd::Cmder}' ||
    env.TERM_PROGRAM === 'Terminus-Sublime' ||
    env.TERM_PROGRAM === 'vscode' ||
    env.TERM === 'xterm-256color' ||
    env.TERM === 'alacritty' ||
    env.TERMINAL_EMULATOR === 'JetBrains-JediTerm'
  );
}

function enabled(policy: SwitchPolicy | undefined, automatic: boolean): boolean {
  return policy === 'always' || (policy !== 'never' && automatic);
}

/** A run owns captured facts; stdout and stderr each resolve this one policy independently. */
function capabilities(
  host: Host,
  destination: 'stdout' | 'stderr',
  policy: RenderingPolicy,
): Capabilities {
  const tty = host.terminal[destination].isTTY;
  const capable = tty && host.env.TERM !== 'dumb';
  const forced = Boolean(host.env.FORCE_COLOR);
  return {
    color: enabled(policy.color, forced || (!host.env.NO_COLOR && capable)),
    depth: colorDepth(host.env),
    hyperlinks: enabled(policy.hyperlinks, tty),
    mainGlyphs: mainGlyphs(host),
    modifiers: enabled(policy.modifiers, forced || capable),
    terminalControls: policy.terminalControls === 'preserve',
  };
}

export type { Capabilities, RenderingPolicy };
export { capabilities, renderingPolicy };
