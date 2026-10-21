import type { Rule } from 'eslint';
import type { CallExpression, NewExpression, Node, Property } from 'estree';

import {
  authoringCallOf,
  constructorOf,
  coreCalleeOf,
  literalString,
  memberKey,
  positionalArguments,
  readProperty,
  unwrapped,
} from '../declarations.js';
import type { AuthoringCall } from '../declarations.js';
import { ruleUrl } from '../docs.js';

/** What a call declares that a description can describe, and whether the call names it first. */
interface Described {
  readonly kind: string;
  readonly named: boolean;
}

/** The authoring calls that declare something a description can describe, by method. */
const describedCalls: ReadonlyMap<string, Described> = new Map([
  ['argument', { kind: 'Argument', named: true }],
  ['globalOption', { kind: 'Global option', named: true }],
  ['option', { kind: 'Option', named: true }],
  ['stdin', { kind: 'Stdin', named: false }],
]);

/** Reports one declaration, under the subject that names it. */
type Report = (node: Node, subject: string) => void;

/** The scope analysis the rule reads. */
type SourceCode = Rule.RuleContext['sourceCode'];

/**
 * Whether a configuration is an object literal that leaves its description out: the argument is
 * absent, or an object literal with no spread and no computed key that names no `description` or
 * names it `undefined`. Core's own rule reads an absent description and no other, so a blank
 * string answers to the types, not to this rule. Anything else is untraceable and passes.
 */
function leavesOutDescription(configuration: Node | undefined): boolean {
  if (configuration === undefined) {
    return true;
  }
  if (configuration.type !== 'ObjectExpression') {
    return false;
  }
  const reading = readProperty(configuration, 'description');
  if (reading.kind === 'absent') {
    return true;
  }
  return (
    reading.kind === 'found' &&
    reading.value.type === 'Identifier' &&
    reading.value.name === 'undefined'
  );
}

/** The declared name in quotes after the kind, or the kind alone when the name is not a literal. */
function subjectOf(kind: string, name: string | undefined): string {
  return name === undefined ? kind : `${kind} ${JSON.stringify(name)}`;
}

/** The options of a `plugin()` definition that are object literals, each with the key naming it. */
function pluginOptions(definition: Node | undefined): readonly Property[] {
  if (definition?.type !== 'ObjectExpression') {
    return [];
  }
  const reading = readProperty(definition, 'options');
  if (reading.kind !== 'found' || reading.value.type !== 'ObjectExpression') {
    return [];
  }
  return reading.value.properties.filter(
    (member): member is Property =>
      member.type === 'Property' && unwrapped(member.value).type === 'ObjectExpression',
  );
}

/** Reports an option, an argument, a global option, or a stdin whose configuration has no description. */
function reportDescribedCall(call: AuthoringCall, known: readonly Node[], report: Report): void {
  const described = describedCalls.get(call.method);
  if (!described) {
    return;
  }
  const [first, second] = known;
  const [name, configuration] = described.named ? [first, second] : [undefined, first];
  if (leavesOutDescription(configuration)) {
    report(call.property, subjectOf(described.kind, literalString(name)));
  }
}

/** Reports each option a `plugin()` definition declares as an object literal without a description. */
function reportPluginOptions(known: readonly Node[], report: Report): void {
  const [, definition] = known;
  for (const member of pluginOptions(definition)) {
    if (leavesOutDescription(unwrapped(member.value))) {
      report(member.key, subjectOf('Plugin option', memberKey(member)));
    }
  }
}

/** Reports a call that declares something without a description, wherever the source can read it. */
function reportCall(sourceCode: SourceCode, node: CallExpression, report: Report): void {
  const known = positionalArguments(node);
  if (!known) {
    return;
  }
  const call = authoringCallOf(sourceCode, node);
  if (call) {
    reportDescribedCall(call, known, report);
  } else if (coreCalleeOf(sourceCode, node.callee) === 'plugin') {
    reportPluginOptions(known, report);
  }
}

/** Reports a `new Command` or `new Application` whose options leave the description out. */
function reportConstruction(sourceCode: SourceCode, node: NewExpression, report: Report): void {
  const kind = constructorOf(sourceCode, node.callee);
  const known = kind === undefined ? undefined : positionalArguments(node);
  if (kind === undefined || !known) {
    return;
  }
  const [name, options] = known;
  if (leavesOutDescription(options)) {
    report(node.callee, subjectOf(kind, literalString(name)));
  }
}

/** Reports a Command, an Application, an option, an argument, or a stdin declared without a description. */
const undescribed: Rule.RuleModule = {
  create(context) {
    const { sourceCode } = context;
    const report: Report = (node, subject) => {
      context.report({ data: { subject }, messageId: 'undescribed', node });
    };
    return {
      CallExpression(node) {
        reportCall(sourceCode, node, report);
      },
      NewExpression(node) {
        reportConstruction(sourceCode, node, report);
      },
    };
  },
  meta: {
    docs: {
      description:
        'Require a description on every Command, Application, option, argument, and stdin declaration.',
      url: ruleUrl('undescribed'),
    },
    messages: {
      undescribed:
        '{{subject}} has no description. Give it a description of one line, which help, agents, MCP tools, and the manifest read.',
    },
    schema: [],
    type: 'suggestion',
  },
};

export { undescribed };
