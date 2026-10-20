import type { Background } from './background.js';
import type { Host } from './types.js';

type SwitchPolicy = 'auto' | 'always' | 'never';
interface RenderingPolicy {
  color?: SwitchPolicy | undefined;
  modifiers?: SwitchPolicy | undefined;
  hyperlinks?: SwitchPolicy | undefined;
  terminalControls?: 'strip' | 'preserve' | undefined;
  /** The author's background: `'dark'` or `'light'` states it, and `'auto'`, the default, leaves it to detection. */
  background?: 'auto' | Background | undefined;
}
interface Capabilities {
  color: boolean;
  modifiers: boolean;
  hyperlinks: boolean;
  terminalControls: boolean;
  depth: 16 | 256 | 'truecolor';
  mainGlyphs: boolean;
}

/**
 * One declared rendering policy, the Application's `rendering` option or `run()`'s, with each
 * setting it leaves undefined dropped, so a later policy spread over an earlier one keeps the
 * earlier setting.
 */
function renderingPolicy(value: RenderingPolicy | undefined): RenderingPolicy {
  const { background, color, hyperlinks, modifiers, terminalControls } = value ?? {};
  return {
    ...(background === undefined ? {} : { background }),
    ...(color === undefined ? {} : { color }),
    ...(hyperlinks === undefined ? {} : { hyperlinks }),
    ...(modifiers === undefined ? {} : { modifiers }),
    ...(terminalControls === undefined ? {} : { terminalControls }),
  };
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
  host: Pick<Host, 'env' | 'platform' | 'terminal'>,
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

/** A valid POSIX `COLUMNS`: ASCII digits alone, leading zeros allowed, a safe integer above zero. */
function columnsVariable(value: string | undefined): number | undefined {
  if (value === undefined || !/^[0-9]+$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** A width a terminal reports, when it reports a usable one. */
function reported(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * The effective width of one destination, read now: `undefined` off a terminal, and otherwise the
 * real width narrowed by a valid `COLUMNS`, or `COLUMNS` alone on a terminal that reports none.
 * `COLUMNS` only narrows, and `host.terminal` keeps the real reading.
 */
function columns(
  host: Pick<Host, 'env' | 'terminal'>,
  destination: 'stdout' | 'stderr',
): number | undefined {
  const terminal = host.terminal[destination];
  if (!terminal.isTTY) {
    return undefined;
  }
  const real = reported(terminal.columns);
  const narrowed = columnsVariable(host.env.COLUMNS);
  if (real === undefined || narrowed === undefined) {
    return real ?? narrowed;
  }
  return Math.min(real, narrowed);
}

/**
 * The plain form of a declared policy: as for a destination that supports no color, modifier, or
 * hyperlink, whatever the declared policy or `FORCE_COLOR` says, with the declared
 * `terminalControls`. An invocation by name resolves its output by it, and a failure form its text.
 */
function plainPolicy(declared: RenderingPolicy): RenderingPolicy {
  const plain: RenderingPolicy = { color: 'never', hyperlinks: 'never', modifiers: 'never' };
  return declared.terminalControls === undefined
    ? plain
    : { ...plain, terminalControls: declared.terminalControls };
}

export type { Capabilities, RenderingPolicy };
export { capabilities, columns, plainPolicy, renderingPolicy };
