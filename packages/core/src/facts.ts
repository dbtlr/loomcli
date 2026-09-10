import { DeclarationError } from './errors.js';

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
 * The `description` core fact: one line of prose every projection reads. A value that is not a
 * string fails the same way a blank one does, because the author reads one rule for one fact.
 * An omitted description is absent, not a fault, so it passes through as `undefined`.
 */
export function checkDescription(subject: string, value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !prose.test(value) || lineTerminator.test(value)) {
    throw new DeclarationError(
      `${subject} description must hold a character other than whitespace and no line terminator. Supply a one-line summary.`,
    );
  }
  return value;
}

/**
 * The `hidden` core fact: whether a listing omits this member. It is a Boolean, because a listing
 * asks one question of it, and an omitted declaration reads `false`. Routing selects and parsing
 * binds without reading it, so a hidden member behaves as any other.
 */
export function checkHidden(subject: string, value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw new DeclarationError(
      `${subject} hidden must be a Boolean. Supply true or false, or omit it.`,
    );
  }
  return value;
}

/**
 * The `deprecated` core fact: the one-line migration message a listing shows beside the member.
 * It answers the rule a description answers, because both are one line of prose a projection
 * prints. A bare `true` is rejected with every other value that is not prose: a deprecation with
 * no migration path leaves an operator or an agent with nothing to do.
 */
export function checkDeprecated(subject: string, value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !prose.test(value) || lineTerminator.test(value)) {
    throw new DeclarationError(
      `${subject} deprecated message must hold a character other than whitespace and no line terminator. Supply a one-line migration path, such as "Use get instead.".`,
    );
  }
  return value;
}

/**
 * The declarations that carry neither listing fact: an argument, which cannot leave the grammar it
 * sits in, and the root, which is every page's entry point. The types remove both keys there, and
 * a JavaScript author, or a TypeScript author whose argument config is inferred from a value,
 * reaches this rule instead.
 */
export function checkNoListingFacts(subject: string, declared: object): void {
  for (const fact of ['hidden', 'deprecated'] as const) {
    if (fact in declared) {
      throw new DeclarationError(
        `${subject} declares ${fact}, which applies to named Commands and options alone. Remove it.`,
      );
    }
  }
}

/**
 * The `version` core fact, which the Application alone carries. Core reads it as an opaque string,
 * because the convention is the package manifest's own field and no scheme is imposed on it. An
 * omitted version is `0.0.0`, which means unversioned, and core keeps no record of which one the
 * author wrote.
 */
export function checkVersion(value: unknown): string {
  if (value === undefined) {
    return '0.0.0';
  }
  if (typeof value !== 'string' || !prose.test(value) || lineTerminator.test(value)) {
    throw new DeclarationError(
      'The Application version must be a string that holds a character other than whitespace and no line terminator. Supply a string such as "1.2.0".',
    );
  }
  return value;
}

/**
 * A structural value core reads as plain data: an object literal, and never a declaration that
 * carries state of its own. The options slots read it to reject a value that is not an options
 * object, and inspection reads it to copy a declared value faithfully.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
