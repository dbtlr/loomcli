import { format } from 'node:util';

import { plugin } from '@loomcli/core';
import type { LiveRegionsHook, LiveRegionsHookContext, Out, Plugin, View } from '@loomcli/core';

import { packageName } from '../constants.js';

const identity = `${packageName}/patch-console`;

/** The members the plugin replaces, each with the stream it keeps. */
const streams = {
  debug: 'stdout',
  error: 'stderr',
  info: 'stdout',
  log: 'stdout',
  warn: 'stderr',
} as const;

type Member = keyof typeof streams;

const members: readonly Member[] = ['log', 'info', 'debug', 'warn', 'error'];

/**
 * The key of the process-wide record of the run whose span holds the console. A registered symbol
 * is the same for every copy of the package in one process, so two copies share one holder.
 */
const holderKey = Symbol.for(`${identity}/holder`);

/** The context of the run that holds the console, or `undefined` while none does. */
function holder(): unknown {
  return Reflect.get(globalThis, holderKey);
}

/** The view a routed text writes through: the text alone, a markup delimiter in it kept literal. */
const literal: View<string> = { render: (text, { style }) => style.escape(text) };

/**
 * Writes one routed call through the run's `out`: its arguments formatted as `util.format` does,
 * with one line break added, on the stream the replaced member writes to, at every verbosity.
 */
function route(out: Out, member: Member, data: readonly unknown[]): void {
  const text = `${format(...data)}\n`;
  if (streams[member] === 'stdout') {
    void out.print(text, literal);
  } else if (member === 'warn') {
    void out.warn(text, literal);
  } else {
    void out.error(text, literal);
  }
}

/** One member the plugin replaced: what it held before, and the function that replaced it. */
interface Replaced {
  readonly member: Member;
  readonly original: Console[Member];
  readonly replacement: Console[Member];
}

/** The members each run's span replaced, while that span holds the console. */
const patches = new WeakMap<LiveRegionsHookContext, readonly Replaced[]>();

/**
 * Replaces the five members for the span of the run `context` belongs to, unless another run's
 * span holds the console. A replacement routes while its run holds the console and calls the
 * member it replaced otherwise.
 */
function patch(context: LiveRegionsHookContext): void {
  if (holder() !== undefined) {
    return;
  }
  Reflect.set(globalThis, holderKey, context);
  const replaced = members.map((member): Replaced => {
    const original = console[member];
    const replacement = (...data: unknown[]): void => {
      if (holder() === context) {
        route(context.out, member, data);
      } else {
        Reflect.apply(original, console, data);
      }
    };
    console[member] = replacement;
    return { member, original, replacement };
  });
  patches.set(context, replaced);
}

/**
 * Puts back each member the span of `context`'s run replaced, unless another library replaced it
 * meanwhile, and gives up the console.
 */
function restore(context: LiveRegionsHookContext): void {
  const replaced = patches.get(context);
  if (replaced === undefined) {
    return;
  }
  patches.delete(context);
  for (const { member, original, replacement } of replaced) {
    if (console[member] === replacement) {
      console[member] = original;
    }
  }
  Reflect.deleteProperty(globalThis, holderKey);
}

const onLiveRegions: LiveRegionsHook = (state, context) => {
  if (state === 'drawn') {
    patch(context);
  } else {
    restore(context);
  }
};

/**
 * Keeps a dependency's `console` writes from tearing a live region. While a frame of the run is on
 * the stack, it replaces `console.log`, `info`, `debug`, `warn`, and `error`, and writes each call
 * through the run's `out`, above the regions, on the stream the member writes to and under the
 * run's rendering policy. It puts the console back when the last frame leaves the stack and before
 * the run ends. It patches a global the whole process shares, so an application installs it only
 * when its author chooses to.
 *
 * @example
 * ```ts
 * import { Application } from '@loomcli/core';
 * import { patchConsole } from '@loomcli/plugins/patch-console';
 *
 * export const app = new Application('ship', { plugins: [patchConsole()] });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/plugins/patch-console.md
 *
 * @public
 */
export function patchConsole(): Plugin {
  return plugin(identity, { onLiveRegions });
}

// The plugin pack's member of MessagePackages, which this entry's declarations load.
export type {} from '../registry.js';
