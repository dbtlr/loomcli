import type { DiagnosticRule, Finding } from './diagnostic-text.js';
import { DeclarationError, quoted } from './errors.js';

/**
 * One character outside Unicode `White_Space`, so a line holds prose and not only spacing.
 * The class covers the tab, the space, the line terminators, the no-break space, and every other
 * space separator. A format character such as the zero-width space is outside it, so it is prose.
 */
const prose = /\P{White_Space}/u;

/**
 * Every character that ends a line, so a line of prose holds none.
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

/**
 * The note a finding carries for what a plugin declared on the author's behalf, such as an input
 * its hook declares or the settings its factory takes, so the diagnostic names the declarer.
 */
export function declarerNote(identity: string): string {
  return `declared by plugin ${quoted(identity)}`;
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
 * The label a configuration source answers with reads this rule, and a plugin whose setting prints
 * inside one line may read it too.
 */
export function isProseLine(value: unknown): value is string {
  return typeof value === 'string' && prose.test(value) && !lineTerminator.test(value);
}
