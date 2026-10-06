import { DeclarationError } from './errors.js';
import { partFinding } from './facts.js';
import type { FactSite } from './facts.js';
import { isPlainObject } from './plain.js';
import { renderingPolicyRule } from './plugin-rules.js';
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

/**
 * One declared rendering policy, checked against its closed sets. `site` is where it was declared,
 * the Application's `rendering` option or `run()`'s, which a fault marks.
 */
function renderingPolicy(value: unknown, site: FactSite): RenderingPolicy {
  if (value === undefined) {
    return {};
  }
  if (!isPlainObject(value)) {
    throw new DeclarationError(renderingPolicyRule, {
      correction: 'Supply an object, or omit rendering.',
      findings: [partFinding(site, [])],
      sentence: 'The rendering policy is not an object.',
    });
  }
  const result: RenderingPolicy = {};
  for (const field of ['color', 'modifiers', 'hyperlinks'] as const) {
    const policy = value[field];
    if (policy !== undefined && policy !== 'auto' && policy !== 'always' && policy !== 'never') {
      throw new DeclarationError(renderingPolicyRule, {
        correction: `Supply one of the three, or omit ${field}.`,
        findings: [partFinding(site, [field])],
        sentence: `Rendering ${field} is not auto, always, or never.`,
      });
    }
    if (policy !== undefined) {
      result[field] = policy;
    }
  }
  const controls = value.terminalControls;
  if (controls !== undefined && controls !== 'strip' && controls !== 'preserve') {
    throw new DeclarationError(renderingPolicyRule, {
      correction: 'Supply strip or preserve, or omit terminalControls.',
      findings: [partFinding(site, ['terminalControls'])],
      sentence: 'Rendering terminalControls is not strip or preserve.',
    });
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
export { capabilities, plainPolicy, renderingPolicy };
