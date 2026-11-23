import { called, elided, spelled } from '../diagnostics/diagnostic-text.js';
import type { Finding } from '../diagnostics/diagnostic-text.js';
import { callSite } from '../diagnostics/facts.js';
import type { InputSite } from '../diagnostics/facts.js';
import type { Host } from '../host/types.js';
import type { Phrase } from '../localization/phrase.js';
import type { ValidationLedger } from './ledger.js';
import type { OptionGroup } from './option-groups.js';
import type { OptionValues, SpellingTable } from './options.js';
import type { ArgumentConfig, InputIdentity, OptionConfig, StdinConfig } from './types.js';
import { inputSubject } from './wording.js';

/**
 * One declared input, typed by its literal name and its own config. The value type is derived from
 * the config, never claimed apart from it, so a declaration cannot be written under a value type
 * that its config does not produce. Untyped readers use the defaults.
 */
export interface ArgumentInput<
  Name extends string = string,
  Config extends ArgumentConfig = ArgumentConfig,
> {
  readonly kind: 'argument';
  readonly name: Name;
  readonly config: Config;
}
export interface OptionInput<
  Name extends string = string,
  Config extends OptionConfig = OptionConfig,
> {
  readonly kind: 'option';
  readonly name: Name;
  readonly config: Config;
}
export type InputDeclaration<Name extends string = string> =
  | ArgumentInput<Name>
  | OptionInput<Name>;

/**
 * The declared values validated before any token is parsed: each default, and each implied value a
 * bare spelling supplies. Values stay `unknown` here.
 */
export interface DeclaredValues {
  readonly defaults: ReadonlyMap<InputDeclaration, unknown>;
  readonly implied: ReadonlyMap<InputDeclaration, unknown>;
}

/** The declarations one pass reads, by the scope that holds them: the graph's, then a Command's. */
export interface ScopedInputs {
  globals: readonly InputDeclaration[];
  locals: readonly InputDeclaration[];
}

/** One declaration under its scope, which the context reports as part of its identity. */
export interface ScopedInput {
  global: boolean;
  input: InputDeclaration;
}

/**
 * What the input-source stage leaves for validation's messages, by option name: the label of each
 * value it filled, and the variable of each Boolean or counted option whose value is outside its
 * grammar. `unanswered` holds each option a configuration source would have filled had one of its own
 * options not been rejected; such an option reports no missing value and no absence rule judges it,
 * because the operator's configuration may hold it.
 */
export interface Provenance {
  /**
   * The options the configuration source filled, by option name, with the directory of the file
   * each answer came from, and whether the answer is strict. A rejected one is dropped unless it is
   * strict, and its validator reads that directory as `host.cwd`.
   */
  fills?: ReadonlyMap<string, { directory: string | undefined; strict: boolean }>;
  labels: ReadonlyMap<string, string>;
  rejected: ReadonlyMap<string, string>;
  unanswered?: ReadonlySet<InputDeclaration>;
  /**
   * The names of the options the stage withdrew as the losing members of an exclusive option group.
   * Each reads as unfilled; `oneRequired` counts it, and a `requiredTogether` group that holds it is
   * not checked.
   */
  withdrawn?: ReadonlySet<string>;
}

/** The raw tokens one invocation collected, keyed by declaration and by option name. */
export interface SuppliedValues {
  args: ReadonlyMap<InputDeclaration, string | string[]>;
  options: OptionValues;
}

/** Everything one invocation validates: its declarations, its tokens, and where they were read. */
export interface Invocation {
  optionGroups: readonly OptionGroup[];
  interactive: boolean;
  stdin?: (StdinConfig & { readonly position: number }) | undefined;
  command: readonly string[];
  /** Every declared default and implied value, validated before any token was read. */
  declaredValues: DeclaredValues;
  host: Host;
  inputs: ScopedInputs;
  /**
   * Present for an invocation by name, which types no spelling, so every problem names an option by
   * its declared name. `unlowered` holds each input whose value no token spells, with the issue
   * that says what the input takes; each reports as a rejected value in authoring order.
   */
  named?: { unlowered: ReadonlyMap<InputDeclaration, Phrase> } | undefined;
  passthrough: readonly string[];
  /**
   * The declarations this pass validates, when it validates only some of `inputs`, such as a
   * configuration source's own options ahead of its call. Every declaration of `inputs` still
   * appears in the validation context's `supplied` record.
   */
  only?: ReadonlySet<InputDeclaration>;
  /** Where each declaration was declared, which a broken validator's finding rebuilds. */
  places: InputPlaces;
  /**
   * What the run's earlier passes settled, such as the one over a configuration source's own
   * options, which this pass reads and adds to. This pass reads each value an earlier pass accepted
   * and each problem it reported, in this pass's own order, and calls no validator a second time.
   */
  ledger: ValidationLedger;
  /** The run's cancellation signal, which stops this phase between two validator calls. */
  signal: AbortSignal;
  sources: Provenance;
  supplied: SuppliedValues;
  /** The routed Command's spelling table, which names each option the way a problem reports it. */
  table: SpellingTable;
}

/** Every declaration in validation order: the globals first, then the reading Command's own. */
export function scoped(inputs: ScopedInputs): ScopedInput[] {
  return [
    ...inputs.globals.map((input) => ({ global: true, input })),
    ...inputs.locals.map((input) => ({ global: false, input })),
  ];
}

export function identityOf({ global, input }: ScopedInput): InputIdentity {
  return { global, kind: input.kind, name: input.name };
}

/**
 * A declaration error names the declaration, because the author reads the declaration to fix it.
 * An argument declares and reads under one name, so the two namings differ for options alone.
 */
export function declarationSubject(input: InputDeclaration): string {
  return inputSubject({ kind: input.kind, spelling: input.name });
}

/** Where the call that declared one input sits: the call's name and the Command it is on. */
export type InputPlace = Pick<Finding, 'call' | 'path'>;

/**
 * Where one Command's own input was declared: its `argument()` or `option()` call on the Command at
 * `path`. A global option's site is the built table's, under `BuiltGlobals.sites`.
 */
export function inputPlace(input: InputDeclaration, path: readonly string[]): InputPlace {
  return { call: input.kind, path };
}

/**
 * The options an `options(set)` call declared. The author wrote that call and no `option()` call,
 * so every finding about one of them rebuilds the call that applied it.
 */
const appliedOptions = new WeakSet<InputDeclaration>();

/** Records that an `options(set)` call declared this option, before any rule judges it. */
export function markApplied(input: OptionInput): void {
  appliedOptions.add(input);
}

/**
 * The site of the call that declared one input at `place`, rebuilt as `call(name, config)`. Every
 * finding for an input's own call starts from it, so each marks the call the same way. `subject`
 * is the sentence's name for the input. An option a set applied is rebuilt as the call that
 * applied it, `options(optionSet({ name: config }))` with that entry alone, whose entry stands for
 * the name.
 */
export function declaringSite(
  input: InputDeclaration,
  place: InputPlace,
  subject: string = declarationSubject(input),
): InputSite {
  if (appliedOptions.has(input)) {
    const at = `0.0.${input.name}`;
    // `Object.fromEntries` defines the key as an own property whatever its name.
    const entry = Object.fromEntries([[input.name, input.config]]);
    const declaration = { arguments: [called('optionSet', [entry])], call: 'options' };
    return {
      at,
      declaration: place.path === undefined ? declaration : { ...declaration, path: place.path },
      named: at,
      subject,
    };
  }
  return callSite(subject, { arguments: [input.name, input.config], ...place });
}

/**
 * One input's site with its config printed elided, for a fault judged before the config is read,
 * such as an invalid name, so the fault reads none of the config.
 */
export function configUnread(site: InputSite): InputSite {
  const [name, config] = site.declaration.arguments;
  const shown = config === undefined ? [name] : [name, spelled(elided)];
  return { ...site, declaration: { ...site.declaration, arguments: shown } };
}

/**
 * The site of the call that declared each input, which a fault about its default or its validator
 * rebuilds: `globalOption()` or a plugin's `options` record for a global option, and the input's
 * own call on its Command for every other input.
 */
export type InputPlaces = ReadonlyMap<InputDeclaration, InputSite>;
