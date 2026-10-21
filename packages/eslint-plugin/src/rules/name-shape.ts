import { isDeclaredName, isPortableName } from '@loomcli/core';
import type { Rule } from 'eslint';
import type { CallExpression, NewExpression, Node } from 'estree';

import {
  authoringCallOf,
  constructorOf,
  literalString,
  positionalArguments,
  readProperty,
} from '../declarations.js';
import type { Argument, AuthoringCall } from '../declarations.js';
import { ruleUrl } from '../docs.js';

/** The correction core's portable-name diagnostic ends with, which the message repeats. */
const portableCorrection =
  'Use a nonempty name of A-Z, a-z, 0-9, ".", "_", and "-" that does not start with "-" or ".".';

/** The correction core's declared-name diagnostic ends with, which the message repeats. */
const declaredCorrection = 'Use a nonempty name without a leading hyphen, whitespace, or "=".';

/** The calls whose options take aliases, which answer the declared-name rule. */
const aliasedCalls: ReadonlySet<string> = new Set(['globalOption', 'option']);

/** The kind of declaration each call names with its first argument. */
const declaredNames: ReadonlyMap<string, string> = new Map([
  ['argument', 'Argument'],
  ['globalOption', 'Option'],
  ['option', 'Option'],
]);

/** The checks one lint run applies: each reports a literal name that core would reject. */
interface Checks {
  /** A name an operator types as a command: the application, a Command, and an alias. */
  readonly portable: (node: Node, subject: string) => void;
  /** A name the parser reads as a token: an option, an argument, and an option alias. */
  readonly declared: (node: Node, subject: string) => void;
}

/** The scope analysis the rule reads. */
type SourceCode = Rule.RuleContext['sourceCode'];

/** Each string literal among some arguments, skipping a spread and anything not literal. */
function literalArguments(args: readonly Argument[]): readonly Node[] {
  return args.filter((argument) => literalString(argument) !== undefined);
}

/** The literal aliases of an option's configuration, when it is an object literal without spread. */
function aliasesOf(configuration: Node | undefined): readonly Node[] {
  if (configuration?.type !== 'ObjectExpression') {
    return [];
  }
  const reading = readProperty(configuration, 'aliases');
  if (reading.kind !== 'found' || reading.value.type !== 'ArrayExpression') {
    return [];
  }
  return literalArguments(
    reading.value.elements.flatMap((element) => (element === null ? [] : [element])),
  );
}

/** Checks the name an option, an argument, or a global option takes, and an option's aliases. */
function checkDeclaredName(call: AuthoringCall, node: CallExpression, checks: Checks): void {
  const kind = declaredNames.get(call.method);
  const known = positionalArguments(node);
  if (kind === undefined || !known) {
    return;
  }
  const [name, configuration] = known;
  if (name) {
    checks.declared(name, kind);
  }
  if (aliasedCalls.has(call.method)) {
    for (const alias of aliasesOf(configuration)) {
      checks.declared(alias, 'Option alias');
    }
  }
}

/** Checks the names an authoring call declares, wherever the source spells them out. */
function checkCall(sourceCode: SourceCode, node: CallExpression, checks: Checks): void {
  const call = authoringCallOf(sourceCode, node);
  if (call?.method === 'alias') {
    for (const alias of literalArguments(node.arguments)) {
      checks.portable(alias, 'Alias');
    }
  } else if (call) {
    checkDeclaredName(call, node, checks);
  }
}

/** Checks the name a `new Command` or `new Application` takes. */
function checkConstruction(sourceCode: SourceCode, node: NewExpression, checks: Checks): void {
  const kind = constructorOf(sourceCode, node.callee);
  const known = kind === undefined ? undefined : positionalArguments(node);
  const [name] = known ?? [];
  if (kind !== undefined && name) {
    checks.portable(name, kind);
  }
}

/**
 * Reports a literal name that core rejects when the module loads: a Command or Application name
 * or an alias against the portable-name rule, and an option, an argument, or an option alias
 * against the declared-name rule.
 */
const nameShape: Rule.RuleModule = {
  create(context) {
    const { sourceCode } = context;
    const check =
      (isValid: (name: string) => boolean, messageId: string): Checks['portable'] =>
      (node, subject) => {
        const name = literalString(node);
        if (name !== undefined && !isValid(name)) {
          context.report({ data: { name: JSON.stringify(name), subject }, messageId, node });
        }
      };
    const checks: Checks = {
      declared: check(isDeclaredName, 'declared'),
      portable: check(isPortableName, 'portable'),
    };
    return {
      CallExpression(node) {
        checkCall(sourceCode, node, checks);
      },
      NewExpression(node) {
        checkConstruction(sourceCode, node, checks);
      },
    };
  },
  meta: {
    docs: {
      description:
        'Disallow a literal Command, Application, alias, option, or argument name that core rejects.',
      url: ruleUrl('name-shape'),
    },
    messages: {
      declared: `{{subject}} name {{name}} is invalid. ${declaredCorrection}`,
      portable: `{{subject}} name {{name}} is invalid. ${portableCorrection}`,
    },
    schema: [],
    type: 'problem',
  },
};

export { nameShape };
