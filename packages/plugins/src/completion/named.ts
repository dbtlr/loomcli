import type { Host, Log, WordPosition } from '@loomcli/core';

import type {
  Completer,
  CompletionSettings,
  CompletionValue,
  CompletionValues,
} from './completer.js';
import { completerFailedEvent } from './messages.js';

/** One offered value of a completer, before the plugin's own rules apply. */
interface NamedOffer {
  readonly word: string;
  readonly description?: string | undefined;
}

/** What a named completer gave: its values, or `failed` when it threw, rejected, or was aborted. */
type NamedAnswer = { readonly offers: readonly NamedOffer[] } | { readonly failed: true };

/** What the run gives a completer beyond the position. */
interface NamedRun {
  readonly host: Host;
  readonly log: Log;
  readonly signal: AbortSignal;
}

/** The completer a settings record holds under a name, read only from its own entries. */
function completerOf(settings: CompletionSettings, name: string): Completer | undefined {
  const { values } = settings;
  return values !== undefined && Object.hasOwn(values, name) ? values[name] : undefined;
}

/** One value as an offered word and its description. */
function offerOf(value: CompletionValue): NamedOffer {
  return typeof value === 'string'
    ? { word: value }
    : { description: value.description, word: value.value };
}

/** The values a completer's result holds, each read as the completer wrote it. */
function offersOf(values: CompletionValues): NamedOffer[] {
  return Array.from(values, (value) => offerOf(value));
}

/** The promise an abort of the signal settles, so a completer that ignores it cannot hold the run. */
function aborted(signal: AbortSignal): Promise<'aborted'> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve('aborted');
      return;
    }
    signal.addEventListener('abort', () => resolve('aborted'), { once: true });
  });
}

/**
 * Calls one completer for the word being completed, with the typed inputs of the position. A
 * completer that throws or rejects gives no values and a `warn` event; an abort of the run's signal
 * gives no values and no event.
 */
async function callCompleter(
  completer: { readonly function: Completer; readonly name: string },
  position: Extract<WordPosition, { kind: 'argument' | 'command' | 'value' }>,
  run: NamedRun,
): Promise<NamedAnswer> {
  const { host, log, signal } = run;
  try {
    const context = { host, signal, typed: position.typed, word: position.prefix };
    const given = await Promise.race([
      (async () => completer.function(context))(),
      aborted(signal),
    ]);
    return given === 'aborted' ? { failed: true } : { offers: offersOf(given) };
  } catch (error) {
    if (!signal.aborted) {
      log.warn(completerFailedEvent, { completer: completer.name, error });
    }
    return { failed: true };
  }
}

/**
 * What the completer an input names offers at the position, or `undefined` when the settings define
 * no completer of that name, which the graph build already reported.
 */
async function namedAnswer(
  settings: CompletionSettings,
  position: { readonly name: string; readonly at: WordPosition },
  run: NamedRun,
): Promise<NamedAnswer | undefined> {
  const completer = completerOf(settings, position.name);
  const { at } = position;
  if (
    completer === undefined ||
    (at.kind !== 'argument' && at.kind !== 'command' && at.kind !== 'value')
  ) {
    return undefined;
  }
  return await callCompleter({ function: completer, name: position.name }, at, run);
}

export type { NamedAnswer, NamedOffer };
export { completerOf, namedAnswer };
