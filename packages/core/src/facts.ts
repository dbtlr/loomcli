import { misplacedListingFact, notOneLine } from './command-rules.js';
import type { DiagnosticRule, Finding } from './diagnostic-text.js';
import { DeclarationError } from './errors.js';
import { flagNotBoolean } from './input-rules.js';

/**
 * One character outside Unicode `White_Space`, so a fact holds prose and not only spacing.
 * The class covers the tab, the space, the line terminators, the no-break space, and every other
 * space separator. A format character such as the zero-width space is outside it, so it is prose.
 */
const prose = /\P{White_Space}/u;

/**
 * Every character that ends a line, so a fact a projection prints on one line holds none.
 * The seven are LF, VT, FF, CR, NEL, LS, and PS, each of them `White_Space` too.
 */
const lineTerminator = /[\n\v\f\r\u0085\u2028\u2029]/u;

/**
 * Where one fact was declared: the subject its sentence names, the call that declared it, and the
 * dotted path among that call's arguments to the object that holds the fact, which a finding marks.
 */
export interface FactSite {
  readonly subject: string;
  readonly declaration: Omit<Finding, 'mark' | 'note'>;
  readonly at: string;
}

/** The finding for the call one site holds, marking one part of it, with a note when given. */
export function siteFinding(site: FactSite, mark: string, note?: string): Finding {
  const finding = { ...site.declaration, mark };
  return note === undefined ? finding : { ...finding, note };
}

/**
 * Where one key of a declaration's options object sits, rebuilt with that key alone, as
 * `plugin(identity, { middleware })` or `new Application(name, { plugins })`, at `1.<key>`. A fault
 * about one slot shows the slot, not every other one the author declared beside it.
 */
export function slotSite(
  declaration: { call: string; named: unknown; subject: string },
  key: string,
  value: unknown,
): FactSite {
  const { call, named, subject } = declaration;
  // `Object.fromEntries` defines the key as an own property whatever its name.
  return {
    at: `1.${key}`,
    declaration: { arguments: [named, Object.fromEntries([[key, value]])], call },
    subject,
  };
}

/**
 * The dotted path to one part inside the value a site holds, such as `1.middleware.activate` for
 * `activate` under a site at `1.middleware`. A site at the call's own arguments has an empty path.
 */
export function partOf(site: Pick<FactSite, 'at'>, ...keys: readonly (number | string)[]): string {
  return [site.at, ...keys.map(String)].filter((key) => key !== '').join('.');
}

/** The finding that marks one part inside the value a site holds, with a note when given. */
export function partFinding(
  site: FactSite,
  keys: readonly (number | string)[],
  note?: string,
): Finding {
  return siteFinding(site, partOf(site, ...keys), note);
}

/**
 * One fact's fault, which marks the fact inside the call that declared it. Every rule about one key
 * of a declaration's config object reports through it, so each marks the key the same way.
 */
export function factFault(
  rule: DiagnosticRule,
  site: FactSite,
  parts: { fact: string; sentence: string; correction: string },
): DeclarationError {
  const { correction, fact, sentence } = parts;
  return new DeclarationError(rule, {
    correction,
    findings: [siteFinding(site, `${site.at}.${fact}`)],
    sentence,
  });
}

/**
 * One yes-or-no declaration key that holds a value other than a Boolean, such as `required` or
 * `hidden`. Every such key reports under one rule, in one sentence and with one correction.
 */
export function flagFault(site: FactSite, flag: string): DeclarationError {
  return factFault(flagNotBoolean, site, {
    correction: 'Use true or false.',
    fact: flag,
    sentence: `${site.subject} declares ${flag} that is not a Boolean.`,
  });
}

/**
 * Where one input was declared: the site of its config object, and the dotted path to its declared
 * name, which a fault about the name or about the whole input marks.
 */
export interface InputSite extends FactSite {
  readonly named: string;
}

/** The site of an input a call declared as `call(name, config)`, such as `option()`. */
export function callSite(subject: string, declaration: Omit<Finding, 'mark' | 'note'>): InputSite {
  return { at: '1', declaration, named: '0', subject };
}

/**
 * The site of one option a plugin declared, rebuilt as `plugin(identity, { options })` from the
 * options the plugin holds. The option's entry in the record stands for its name.
 */
export function pluginOptionSite(
  plugin: { identity: string; options: unknown },
  name: string,
  subject: string,
): InputSite {
  const at = `1.options.${name}`;
  return {
    at,
    declaration: { arguments: [plugin.identity, { options: plugin.options }], call: 'plugin' },
    named: at,
    subject,
  };
}

/**
 * One line of prose: a string that holds a character other than whitespace and no line terminator.
 * Every one-line fact reads this rule, and so does the label a configuration source answers with.
 */
export function isProseLine(value: unknown): value is string {
  return typeof value === 'string' && prose.test(value) && !lineTerminator.test(value);
}

/**
 * The `description` core fact: one line of prose every projection reads. A value that is not a
 * string fails the same way a blank one does, because the author reads one rule for one fact.
 * An omitted description is absent, not a fault, so it passes through as `undefined`.
 */
export function checkDescription(site: FactSite, value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isProseLine(value)) {
    throw factFault(notOneLine, site, {
      correction: 'Supply a one-line summary.',
      fact: 'description',
      sentence: `${site.subject} description must hold a character other than whitespace and no line terminator.`,
    });
  }
  return value;
}

/**
 * The `hidden` core fact: whether a listing omits this member. It is a Boolean, because a listing
 * asks one question of it, and an omitted declaration reads `false`. Routing selects and parsing
 * binds without reading it, so a hidden member behaves as any other.
 */
export function checkHidden(site: FactSite, value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw flagFault(site, 'hidden');
  }
  return value;
}

/**
 * The `deprecated` core fact: the one-line migration message a listing shows beside the member.
 * It answers the rule a description answers, because both are one line of prose a projection
 * prints. A bare `true` is rejected with every other value that is not prose: a deprecation with
 * no migration path leaves an operator or an agent with nothing to do.
 */
export function checkDeprecated(site: FactSite, value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isProseLine(value)) {
    throw factFault(notOneLine, site, {
      correction: 'Supply a one-line migration path, such as "Use get instead.".',
      fact: 'deprecated',
      sentence: `${site.subject} deprecated message must hold a character other than whitespace and no line terminator.`,
    });
  }
  return value;
}

/**
 * The declarations that carry neither listing fact: an argument, which cannot leave the grammar it
 * sits in, and the root, which is every page's entry point. The types remove both keys there, and
 * a JavaScript author, or a TypeScript author whose argument config is inferred from a value,
 * reaches this rule instead.
 */
export function checkNoListingFacts(site: FactSite, declared: object): void {
  for (const fact of ['hidden', 'deprecated'] as const) {
    if (fact in declared) {
      throw factFault(misplacedListingFact, site, {
        correction: 'Remove it.',
        fact,
        sentence: `${site.subject} declares ${fact}, which applies to named Commands and options alone.`,
      });
    }
  }
}

/**
 * The `version` core fact, which the Application alone carries. Core reads it as an opaque string,
 * because the convention is the package manifest's own field and no scheme is imposed on it. An
 * omitted version is `0.0.0`, which means unversioned, and core keeps no record of which one the
 * author wrote.
 */
export function checkVersion(site: FactSite, value: unknown): string {
  if (value === undefined) {
    return '0.0.0';
  }
  if (!isProseLine(value)) {
    throw factFault(notOneLine, site, {
      correction: 'Supply a string such as "1.2.0".',
      fact: 'version',
      sentence: `${site.subject} version must be a string that holds a character other than whitespace and no line terminator.`,
    });
  }
  return value;
}
