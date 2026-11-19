import type { StandardSchemaV1 } from '@standard-schema/spec';

import { partOf, siteFinding } from '../diagnostics/facts.js';
import type { InputSite } from '../diagnostics/facts.js';
import { DeclarationError } from '../failures/errors.js';
import type { Host } from '../host/types.js';
import { declarationSubject, identityOf, scoped } from './declarations.js';
import type {
  DeclaredValues,
  InputDeclaration,
  InputPlaces,
  ScopedInputs,
} from './declarations.js';
import { invalidDefault, invalidImplied } from './rules.js';
import type { ValidationContext } from './types.js';
import { messages, reported, validate, validateDeclared } from './validation.js';

/** A declared `default: undefined` is a default, so presence is the key, never the value. */
function hasDefault(input: InputDeclaration) {
  return Object.hasOwn(input.config, 'default');
}

/** How each declared value names itself when its validator rejects it, and the fix. */
const declaredFaults = {
  default: {
    correction: 'Fix the default or its validator.',
    noun: 'default',
    rule: invalidDefault,
  },
  implied: {
    correction: 'Fix the implied value or its validator.',
    noun: 'implied value',
    rule: invalidImplied,
  },
} as const;

/**
 * The output of a declared value its validator accepted, or the declaration fault it is when the
 * validator rejected it, one line per issue under the sentence, marking the key that declares it.
 */
function declaredOutput(
  input: InputDeclaration,
  result: StandardSchemaV1.Result<unknown>,
  declared: { fault: keyof typeof declaredFaults; site: InputSite | undefined },
): unknown {
  if (result.issues === undefined) {
    return result.value;
  }
  const { fault, site } = declared;
  const { correction, noun, rule } = declaredFaults[fault];
  throw new DeclarationError(rule, {
    correction,
    findings: site === undefined ? [] : [siteFinding(site, partOf(site, fault))],
    sentence: [
      `${declarationSubject(input)} has an invalid ${noun}.`,
      ...messages({ kind: input.kind, spelling: input.name }, reported(result.issues)),
    ].join('\n'),
  });
}

/** The implied value a string option declares, which a bare spelling supplies, or `undefined`. */
function impliedOf(input: InputDeclaration): string | undefined {
  return input.kind === 'option' && input.config.type === 'string'
    ? input.config.implied
    : undefined;
}

/**
 * Every declared default and implied value, validated before any token is read, in declaration
 * order, a declaration's default before its implied value. The host is captured by then, so each
 * validator reads the same Host its action will, under the `default` phase. `places` says where each
 * declaration sits, which a rejected value's finding rebuilds. An implied value is judged whether or
 * not an invocation holds a bare spelling, because the author declared it.
 */
export async function prepareDeclaredValues(
  inputs: ScopedInputs,
  host: Host,
  places: InputPlaces,
): Promise<DeclaredValues> {
  const defaults = new Map<InputDeclaration, unknown>();
  const implied = new Map<InputDeclaration, unknown>();
  for (const entry of scoped(inputs)) {
    const { input } = entry;
    const call = {
      context: (): ValidationContext => ({ host, input: identityOf(entry), phase: 'default' }),
      site: places.get(input),
    };
    if (hasDefault(input)) {
      const result = await validateDeclared(input, input.config.default, call);
      defaults.set(input, declaredOutput(input, result, { fault: 'default', site: call.site }));
    }
    const value = impliedOf(input);
    if (value !== undefined) {
      // A bare spelling supplies one value, so even a multiple option's validator reads it alone.
      const result = await validate(input, value, { context: call.context(), site: call.site });
      implied.set(input, declaredOutput(input, result, { fault: 'implied', site: call.site }));
    }
  }
  return { defaults, implied };
}
