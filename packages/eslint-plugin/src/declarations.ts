import type { Rule, Scope } from 'eslint';
import type {
  Expression,
  Identifier,
  ImportNamespaceSpecifier,
  ImportSpecifier,
  Node,
  ObjectExpression,
  Property,
  SpreadElement,
} from 'estree';

/*
 * What the rules can trace without type information: a Loom declaration is a value the source
 * itself builds from `@loomcli/core`. A value the source cannot follow, such as a parameter, a
 * spread options object, or a computed name, is never a declaration, because a false report is
 * worse than a missed one.
 */

/** The package whose `Command` and `Application` constructors start a declaration. */
const corePackage = '@loomcli/core';

/** The constructors of `@loomcli/core` that build a declaration. */
const constructorNames: ReadonlySet<string> = new Set(['Application', 'Command']);

/**
 * The calls on an Application or a Command that return a new declaration. Declarations are
 * immutable, so a result nothing uses is a call that did nothing.
 */
const authoringMethods: ReadonlySet<string> = new Set([
  'action',
  'alias',
  'argument',
  'command',
  'exclusive',
  'extend',
  'globalOption',
  'oneRequired',
  'option',
  'requiredTogether',
  'result',
  'rows',
  'stdin',
  'views',
]);

/** The TypeScript syntax that changes the type of a value and leaves the value as it was. */
const typeWrappers: ReadonlySet<string> = new Set([
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
]);

/** The scope analysis the rules read, which both ESLint and oxlint provide. */
type SourceCode = Rule.RuleContext['sourceCode'];

/** What a call's argument list holds: an expression, or a spread whose length is unknown. */
type Argument = Expression | SpreadElement;

/** One authoring call on a declaration: its method, and the identifier that names the method. */
interface AuthoringCall {
  readonly method: string;
  readonly property: Identifier;
}

/** Whether a value is a syntax node, which the parser's own node types then narrow further. */
function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'type' in value;
}

/** The value under any `as`, `satisfies`, `!`, or angle-bracket assertion that wraps it. */
function unwrapped(node: Node): Node {
  let current = node;
  while (typeWrappers.has(current.type) && 'expression' in current && isNode(current.expression)) {
    current = current.expression;
  }
  return current;
}

/** The nearest variable an identifier refers to, or `undefined` for an undeclared name. */
function variableOf(sourceCode: SourceCode, identifier: Identifier): Scope.Variable | undefined {
  for (
    let scope: Scope.Scope | null = sourceCode.getScope(identifier);
    scope;
    scope = scope.upper
  ) {
    const variable = scope.set.get(identifier.name);
    if (variable) {
      return variable;
    }
  }
  return undefined;
}

/** The one import specifier that declares a variable, or `undefined` for any other binding. */
function importSpecifierOf(
  variable: Scope.Variable,
): { specifier: ImportNamespaceSpecifier | ImportSpecifier; source: unknown } | undefined {
  const [definition, redeclaration] = variable.defs;
  if (!definition || redeclaration || definition.type !== 'ImportBinding') {
    return undefined;
  }
  const { node, parent } = definition;
  if (node.type === 'ImportDefaultSpecifier') {
    return undefined;
  }
  return { source: parent.source.value, specifier: node };
}

/** The name an import specifier takes from its module, which may be spelled as a string. */
function importedName(specifier: ImportSpecifier): string {
  const { imported } = specifier;
  return imported.type === 'Identifier' ? imported.name : String(imported.value);
}

/**
 * The name `@loomcli/core` exports that an identifier imports, following a renamed import, or
 * `undefined` for an identifier bound any other way.
 */
function coreExportOf(sourceCode: SourceCode, identifier: Identifier): string | undefined {
  const variable = variableOf(sourceCode, identifier);
  const imported = variable && importSpecifierOf(variable);
  if (imported?.source !== corePackage || imported.specifier.type !== 'ImportSpecifier') {
    return undefined;
  }
  return importedName(imported.specifier);
}

/** Whether an identifier is a namespace import of `@loomcli/core`, as in `import * as loom`. */
function isCoreNamespace(sourceCode: SourceCode, identifier: Identifier): boolean {
  const variable = variableOf(sourceCode, identifier);
  const imported = variable && importSpecifierOf(variable);
  return imported?.source === corePackage && imported.specifier.type === 'ImportNamespaceSpecifier';
}

/**
 * The name `@loomcli/core` exports that a callee refers to, as `plugin` or as `core.plugin`
 * through a namespace import, or `undefined` for a callee the source cannot trace to it.
 */
function coreCalleeOf(sourceCode: SourceCode, callee: Node): string | undefined {
  if (callee.type === 'Identifier') {
    return coreExportOf(sourceCode, callee);
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.property.type === 'Identifier' &&
    isCoreNamespace(sourceCode, callee.object)
  ) {
    return callee.property.name;
  }
  return undefined;
}

/** `Command` or `Application` when a `new` callee is that constructor from `@loomcli/core`. */
function constructorOf(sourceCode: SourceCode, callee: Node): string | undefined {
  const name = coreCalleeOf(sourceCode, callee);
  return name !== undefined && constructorNames.has(name) ? name : undefined;
}

/** The initializer of the `const` a variable is, when a plain declarator holds it. */
function constantInit(variable: Scope.Variable): Expression | undefined {
  const [definition, redeclaration] = variable.defs;
  if (!definition || redeclaration || definition.type !== 'Variable') {
    return undefined;
  }
  const { id, init } = definition.node;
  return definition.parent.kind === 'const' && id.type === 'Identifier'
    ? (init ?? undefined)
    : undefined;
}

/** The authoring call a node is, when its receiver is a Loom declaration, else `undefined`. */
function authoringCallOf(
  sourceCode: SourceCode,
  node: Node,
  traced: ReadonlySet<Scope.Variable> = new Set(),
): AuthoringCall | undefined {
  const call = unwrapped(node);
  if (call.type !== 'CallExpression') {
    return undefined;
  }
  const { callee } = call;
  if (
    callee.type !== 'MemberExpression' ||
    callee.computed ||
    callee.property.type !== 'Identifier' ||
    !authoringMethods.has(callee.property.name) ||
    !isDeclaration(sourceCode, callee.object, traced)
  ) {
    return undefined;
  }
  return { method: callee.property.name, property: callee.property };
}

/**
 * Whether a node is a Loom declaration: a `new Command` or `new Application` from `@loomcli/core`,
 * an authoring call on one, or an identifier whose `const` holds one. `traced` holds the constants
 * already followed, so a constant that names itself ends the walk.
 */
function isDeclaration(
  sourceCode: SourceCode,
  node: Node,
  traced: ReadonlySet<Scope.Variable>,
): boolean {
  const target = unwrapped(node);
  switch (target.type) {
    case 'NewExpression': {
      return constructorOf(sourceCode, target.callee) !== undefined;
    }
    case 'CallExpression': {
      return authoringCallOf(sourceCode, target, traced) !== undefined;
    }
    case 'Identifier': {
      const variable = variableOf(sourceCode, target);
      const init = variable && !traced.has(variable) ? constantInit(variable) : undefined;
      return variable !== undefined && init !== undefined
        ? isDeclaration(sourceCode, init, new Set([...traced, variable]))
        : false;
    }
    default: {
      return false;
    }
  }
}

/**
 * The arguments of a call without the type assertions around them, or `undefined` when a spread
 * makes the position of one unknown.
 */
function positionalArguments(call: {
  readonly arguments: readonly Argument[];
}): readonly Node[] | undefined {
  const nodes: Node[] = [];
  for (const argument of call.arguments) {
    if (argument.type === 'SpreadElement') {
      return undefined;
    }
    nodes.push(unwrapped(argument));
  }
  return nodes;
}

/** The text of a string literal or of a template with no substitution, else `undefined`. */
function literalString(node: Node | null | undefined): string | undefined {
  const target = node && unwrapped(node);
  if (target?.type === 'Literal' && typeof target.value === 'string') {
    return target.value;
  }
  if (target?.type !== 'TemplateLiteral') {
    return undefined;
  }
  // A template with no substitution has the one quasi and nothing after it.
  const [only, next] = target.quasis;
  return next === undefined ? (only?.value.cooked ?? undefined) : undefined;
}

/** What reading one property of an object literal found. */
type PropertyReading =
  | { readonly kind: 'found'; readonly property: Property; readonly value: Node }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unknown' };

/** The name an object key spells, as an identifier or as a string or numeric literal. */
function keyName(key: Property['key']): string | undefined {
  if (key.type === 'Identifier') {
    return key.name;
  }
  return key.type === 'Literal' ? String(key.value) : undefined;
}

/** The key a member spells, or `undefined` for a spread and for a computed key that is no literal. */
function memberKey(member: Property | SpreadElement): string | undefined {
  if (member.type === 'SpreadElement') {
    return undefined;
  }
  return member.computed ? literalString(member.key) : keyName(member.key);
}

/**
 * One property of an object literal. A spread or a computed key makes the answer `unknown`,
 * because either may supply or replace the property.
 */
function readProperty(object: ObjectExpression, name: string): PropertyReading {
  if (object.properties.some((member) => memberKey(member) === undefined)) {
    return { kind: 'unknown' };
  }
  const found = object.properties.find(
    (member): member is Property => member.type === 'Property' && memberKey(member) === name,
  );
  return found
    ? { kind: 'found', property: found, value: unwrapped(found.value) }
    : { kind: 'absent' };
}

export {
  authoringCallOf,
  constructorOf,
  coreCalleeOf,
  literalString,
  memberKey,
  positionalArguments,
  readProperty,
  unwrapped,
};
export type { Argument, AuthoringCall, PropertyReading };
