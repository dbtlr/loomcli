import { basename } from 'node:path';

import type { Rule, Scope, SourceCode } from 'eslint';
import type {
  ExportAllDeclaration,
  ExportNamedDeclaration,
  ImportDeclaration,
  ImportExpression,
  Node,
  Pattern,
  Program,
} from 'estree';

import { importedName } from '../declarations.js';
import { ruleUrl } from '../docs.js';

/*
 * A run reads every process fact and starts every child program through its process handle, which
 * a test replaces with a mock. This rule reports code that reaches the process around that handle:
 * the global `process`, an import of `process`, the user's folders from `os`, and `child_process`.
 * It reads scope analysis and import declarations alone, so a binding the code declares itself is
 * never the global, and a use it cannot trace is not reported.
 */

/** The specifiers that name the process module, with and without the `node:` scheme. */
const processModules: ReadonlySet<string> = new Set(['node:process', 'process']);

/** The specifiers that name the operating-system module. */
const osModules: ReadonlySet<string> = new Set(['node:os', 'os']);

/** The specifiers that name the child-process module. */
const childModules: ReadonlySet<string> = new Set(['child_process', 'node:child_process']);

/** The objects whose `process` member is the global `process`. */
const globalObjects: ReadonlySet<string> = new Set(['global', 'globalThis']);

/** What a member of `process` reads, and the member of the run to use instead. */
const processMembers: Readonly<Record<string, string>> = {
  arch: 'host.arch',
  argv: 'host.argv',
  cwd: 'host.cwd',
  env: 'host.env',
  exit: 'a result the action returns, or a failure it throws,',
  exitCode: 'a result the action returns, or a failure it throws,',
  getuid: 'host.uid',
  on: "onShutdown, onSuspend, onResume, and the run's signal,",
  once: "onShutdown, onSuspend, onResume, and the run's signal,",
  platform: 'host.platform',
  stderr: 'out',
  stdin: 'host.stdin',
  stdout: 'out',
};

/** The members of `process` a reader calls, which a message names with parentheses. */
const processMethods: ReadonlySet<string> = new Set(['cwd', 'exit', 'getuid', 'on', 'once']);

/** What each reported member of `os` reads, and the member of the run to use instead. */
const osMembers: Readonly<Record<string, string>> = {
  homedir: 'host.home instead',
  tmpdir: 'host.tmpdir instead',
  userInfo: 'host.uid for who the user is, and host.env.USER for the name to show',
};

/** The length of a list that holds nothing. */
const none = 0;

/** The replacement any use of `process` the table does not name reads. */
const anyProcessUse = "the run's host instead";

/** The name a member expression's property spells, when it spells one the source can read. */
function memberName(node: Node | null, object: Node): string | undefined {
  if (node?.type !== 'MemberExpression' || node.object !== object) {
    return undefined;
  }
  const { computed, property } = node;
  if (!computed && property.type === 'Identifier') {
    return property.name;
  }
  return property.type === 'Literal' && typeof property.value === 'string'
    ? property.value
    : undefined;
}

/** Whether an import declaration or one of its specifiers is a type-only import, which runs nothing. */
function typeOnly(node: object): boolean {
  return Reflect.get(node, 'importKind') === 'type';
}

/** The literal specifier of a static or dynamic import or a re-export, when it is a string. */
function specifierOf(
  node: ImportDeclaration | ImportExpression | ExportNamedDeclaration | ExportAllDeclaration,
): string | undefined {
  const { source } = node;
  return source?.type === 'Literal' && typeof source.value === 'string' ? source.value : undefined;
}

/** The name an identifier or a string literal spells, as an import or export specifier holds it. */
function spelled(node: Node): string | undefined {
  if (node.type === 'Identifier') {
    return node.name;
  }
  return node.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined;
}

/** The report data for a use of `process`: what it reached, and what to use instead. */
function processReach(prefix: string, member: string | undefined) {
  if (member === undefined || !Object.hasOwn(processMembers, member)) {
    return {
      instead: anyProcessUse,
      reached: member === undefined ? prefix : `${prefix}.${member}`,
    };
  }
  return {
    instead: `${processMembers[member]} instead`,
    reached: `${prefix}.${member}${processMethods.has(member) ? '()' : ''}`,
  };
}

/** The report data for a member of `os`. */
function osReach(member: string) {
  return { instead: osMembers[member] ?? anyProcessUse, reached: `${member}()` };
}

/** The global variable under a name: a host global the source never declares, if one is defined. */
function globalVariable(scope: Scope.Scope, name: string): Scope.Variable | undefined {
  const variable = scope.set.get(name);
  return variable !== undefined && variable.defs.length === none ? variable : undefined;
}

/** The identifiers of every reference to a global the source never declares, under one name. */
function globalIdentifiers(scope: Scope.Scope, name: string): object[] {
  const through = scope.through.filter((reference) => reference.identifier.name === name);
  const resolved = globalVariable(scope, name)?.references ?? [];
  return [...through, ...resolved].map((reference) => reference.identifier);
}

/** What an identifier the rule traces stands for: the global `process`, a global object, or an `os` binding. */
type Traced =
  | { readonly kind: 'process' }
  | { readonly kind: 'global'; readonly name: string }
  | { readonly kind: 'os' };

/** What a check reports through and records into. */
interface Check {
  readonly report: (node: Node, data: { instead: string; reached: string }) => void;
  // Keyed by the identifier node a reference holds, which is the node the Identifier visitor receives.
  readonly traced: Map<object, Traced>;
  readonly sourceCode: SourceCode;
}

/** Traces every reference of the variables an `os` default, namespace, or awaited import declares. */
function traceOs(check: Check, variables: readonly Scope.Variable[]): void {
  for (const variable of variables) {
    for (const reference of variable.references) {
      check.traced.set(reference.identifier, { kind: 'os' });
    }
  }
}

/** The specifiers of an import that run: every specifier that is not a type-only one. */
function runtimeSpecifiers(node: ImportDeclaration): ImportDeclaration['specifiers'] {
  return node.specifiers.filter((specifier) => !typeOnly(specifier));
}

/** Reports each member an `os` import names, and traces its default or namespace bindings. */
function checkOs(check: Check, node: ImportDeclaration): void {
  for (const specifier of runtimeSpecifiers(node)) {
    const imported = importedName(specifier);
    if (imported === undefined) {
      traceOs(check, check.sourceCode.getDeclaredVariables(specifier));
    } else if (Object.hasOwn(osMembers, imported)) {
      check.report(specifier, osReach(imported));
    }
  }
}

/** Reports an import of `process`: each named member as the table names it, and any other import whole. */
function checkProcess(check: Check, node: ImportDeclaration): void {
  if (node.specifiers.length === none) {
    check.report(node, processReach('process', undefined));
  }
  for (const specifier of runtimeSpecifiers(node)) {
    check.report(specifier, processReach('process', importedName(specifier)));
  }
}

/** Reports each banned `os` member an object pattern destructures, by the key it reads. */
function checkOsPattern(check: Check, pattern: Pattern): void {
  if (pattern.type !== 'ObjectPattern') {
    return;
  }
  for (const property of pattern.properties) {
    const key =
      property.type === 'Property' && !property.computed ? spelled(property.key) : undefined;
    if (key !== undefined && Object.hasOwn(osMembers, key)) {
      check.report(property, osReach(key));
    }
  }
}

/** What re-exporting all of `os` reaches: every folder the rule names. */
const allOsReach = { instead: 'host.home, host.tmpdir, and host.uid instead' };

/** The named re-exports that run, or `undefined` for a re-export of the whole module. */
type Reexported = ExportNamedDeclaration['specifiers'] | undefined;

/** Reports a re-export of `process`: each named member as the table names it, or the whole module. */
function reexportProcess(check: Check, node: Node, named: Reexported): void {
  if (named === undefined) {
    check.report(node, processReach('process', undefined));
  }
  for (const part of named ?? []) {
    check.report(part, processReach('process', spelled(part.local)));
  }
}

/** Reports a re-export of `os`: each banned member it passes on, or the whole module. */
function reexportOs(
  check: Check,
  node: ExportNamedDeclaration | ExportAllDeclaration,
  named: Reexported,
): void {
  if (named === undefined) {
    check.report(node, { ...allOsReach, reached: specifierOf(node) ?? 'os' });
  }
  for (const part of named ?? []) {
    const member = spelled(part.local);
    if (member !== undefined && Object.hasOwn(osMembers, member)) {
      check.report(part, osReach(member));
    }
  }
}

/**
 * Reports a re-export of a module the rule names, as an import of it is reported: each banned
 * member a named re-export passes on, and a re-export of the whole module. A type-only re-export
 * runs nothing.
 */
function checkReexport(check: Check, node: ExportNamedDeclaration | ExportAllDeclaration): void {
  const specifier = specifierOf(node);
  if (specifier === undefined || Reflect.get(node, 'exportKind') === 'type') {
    return;
  }
  const named: Reexported =
    node.type === 'ExportNamedDeclaration'
      ? node.specifiers.filter((part) => Reflect.get(part, 'exportKind') !== 'type')
      : undefined;
  if (named?.length === none) {
    return;
  }
  if (childModules.has(specifier)) {
    check.report(node, { instead: 'host.spawn instead', reached: specifier });
  } else if (processModules.has(specifier)) {
    reexportProcess(check, node, named);
  } else if (osModules.has(specifier)) {
    reexportOs(check, node, named);
  }
}

/** Reports a static import of a module the rule names. A type-only import runs nothing. */
function checkImport(check: Check, node: ImportDeclaration): void {
  const specifier = specifierOf(node);
  if (specifier === undefined || typeOnly(node)) {
    return;
  }
  if (processModules.has(specifier)) {
    checkProcess(check, node);
  } else if (osModules.has(specifier)) {
    checkOs(check, node);
  } else if (
    childModules.has(specifier) &&
    (node.specifiers.length === none || runtimeSpecifiers(node).length > none)
  ) {
    check.report(node, { instead: 'host.spawn instead', reached: specifier });
  }
}

/** Reports what `await import('os')` reads: a member read off it, or the members of its binding. */
function checkAwaitedOs(check: Check, awaited: Rule.Node): void {
  const holder = awaited.parent;
  if (holder === null) {
    return;
  }
  const member = memberName(holder, awaited);
  if (member !== undefined && Object.hasOwn(osMembers, member)) {
    check.report(holder, osReach(member));
  } else if (holder.type === 'VariableDeclarator') {
    if (holder.id.type === 'ObjectPattern') {
      checkOsPattern(check, holder.id);
    } else {
      traceOs(check, check.sourceCode.getDeclaredVariables(holder));
    }
  }
}

/** Reports a dynamic import with a literal specifier, which counts as an import. */
function checkDynamic(check: Check, node: ImportExpression & Rule.NodeParentExtension): void {
  const specifier = specifierOf(node);
  if (specifier === undefined) {
    return;
  }
  if (processModules.has(specifier)) {
    check.report(node, processReach('process', undefined));
  } else if (childModules.has(specifier)) {
    check.report(node, { instead: 'host.spawn instead', reached: specifier });
  } else if (osModules.has(specifier) && node.parent.type === 'AwaitExpression') {
    checkAwaitedOs(check, node.parent);
  }
}

/** Reports `globalThis.process` or `global.process`, and the member read off it. */
function checkGlobalProcess(check: Check, holder: Rule.Node, name: string): void {
  const outer = holder.parent;
  const read = memberName(outer, holder);
  const reported = read === undefined || outer === null ? holder : outer;
  check.report(reported, processReach(`${name}.process`, read));
}

/** Reports a use of a traced `os` binding: a banned member read off it, or destructured from it. */
function checkOsUse(check: Check, node: Rule.Node, member: string | undefined): void {
  const { parent } = node;
  if (member !== undefined && Object.hasOwn(osMembers, member)) {
    check.report(parent ?? node, osReach(member));
  } else if (parent?.type === 'VariableDeclarator' && parent.init === node) {
    checkOsPattern(check, parent.id);
  }
}

/** Reports a traced identifier's use: the global `process`, a member of `os`, or `globalThis.process`. */
function checkTraced(check: Check, node: Rule.Node, held: Traced): void {
  const { parent } = node;
  if (parent === null) {
    return;
  }
  const member = memberName(parent, node);
  if (held.kind === 'process') {
    check.report(member === undefined ? node : parent, processReach('process', member));
  } else if (held.kind === 'os') {
    checkOsUse(check, node, member);
  } else if (member === 'process') {
    checkGlobalProcess(check, parent, held.name);
  }
}

/**
 * Traces, before any use is visited, every reference to the global `process` and to the global
 * objects, and every binding of an `os` default or namespace import.
 */
function traceProgram(check: Check, program: Program): void {
  const scope = check.sourceCode.getScope(program);
  for (const identifier of globalIdentifiers(scope, 'process')) {
    check.traced.set(identifier, { kind: 'process' });
  }
  for (const name of globalObjects) {
    for (const identifier of globalIdentifiers(scope, name)) {
      check.traced.set(identifier, { kind: 'global', name });
    }
  }
}

/**
 * Reports code that reads the process around the run's host. A test file, whose name holds
 * `.test.` or `.spec.`, is left alone, because a test is where a machine fact is handed to a mock.
 */
const hostBypass: Rule.RuleModule = {
  create(context) {
    const file = basename(context.filename);
    if (file.includes('.test.') || file.includes('.spec.')) {
      return {};
    }
    const check: Check = {
      report: (node, data) => {
        context.report({ data, messageId: 'bypass', node });
      },
      sourceCode: context.sourceCode,
      traced: new Map(),
    };
    return {
      ExportAllDeclaration: (node) => checkReexport(check, node),
      ExportNamedDeclaration: (node) => checkReexport(check, node),
      Identifier(node) {
        const held = check.traced.get(node);
        if (held !== undefined) {
          checkTraced(check, node, held);
        }
      },
      ImportDeclaration: (node) => checkImport(check, node),
      ImportExpression: (node) => checkDynamic(check, node),
      Program: (program) => traceProgram(check, program),
    };
  },
  meta: {
    docs: {
      description:
        "Disallow reading the process around the run's host, which a test's mock process does not replace.",
      url: ruleUrl('host-bypass'),
    },
    messages: {
      bypass: '`{{reached}}` reads the machine around the run. Use {{instead}}.',
    },
    schema: [],
    type: 'problem',
  },
};

export { hostBypass };
