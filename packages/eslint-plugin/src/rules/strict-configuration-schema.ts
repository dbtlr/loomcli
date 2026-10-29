import type { Rule, Scope } from 'eslint';
import type { CallExpression, Expression, Identifier, ImportDeclaration, Node } from 'estree';

import {
  constantInit,
  isNode,
  positionalArguments,
  readProperty,
  unwrapped,
  variableOf,
} from '../declarations.js';
import { ruleUrl } from '../docs.js';

/*
 * Zod reports an unknown key in a strict object as an issue on the object itself, so the
 * configuration plugin drops the whole object. This rule reports a zod strict object it can trace
 * into the schema a `configuration()` call names. It follows what the source itself builds: a
 * call on a zod import, and a `const` in the module. valibot and ArkType name the unknown key
 * itself, and a `.strict()` whose receiver does not trace to zod means something else, such as
 * yup's skip-coercion mode, so neither is reported: a false report is worse than a missed one.
 */

/** The module the configuration plugin is imported from. */
const configModule = '@loomcli/plugins/config';

/** The specifiers that load zod, classic and mini. */
const zodModules: ReadonlySet<string> = new Set(['zod', 'zod/mini', 'zod/v4', 'zod/v4/mini']);

/** The name zod exports its whole module under, as in `import { z } from 'zod'`. */
const zodNamespace = 'z';

/** The scope analysis the rule reads. */
type SourceCode = Rule.RuleContext['sourceCode'];

/** One specifier of an import declaration: a named, a default, or a namespace import. */
type ImportBinding = ImportDeclaration['specifiers'][number];

/** The import a variable is bound by, with the module it comes from, or `undefined` for any other binding. */
function importOf(
  sourceCode: SourceCode,
  identifier: Identifier,
): { readonly binding: ImportBinding; readonly module: unknown } | undefined {
  const variable = variableOf(sourceCode, identifier);
  const [definition, redeclaration] = variable?.defs ?? [];
  if (!definition || redeclaration || definition.type !== 'ImportBinding') {
    return undefined;
  }
  return { binding: definition.node, module: definition.parent.source.value };
}

/** The name a named import takes from its module, or `undefined` for a default or namespace import. */
function importedName(binding: ImportBinding): string | undefined {
  if (binding.type !== 'ImportSpecifier') {
    return undefined;
  }
  const { imported } = binding;
  return imported.type === 'Identifier' ? imported.name : String(imported.value);
}

/** Whether an identifier is the whole zod module: a namespace, a default, or the named `z` import. */
function isZodModule(sourceCode: SourceCode, identifier: Identifier): boolean {
  const imported = importOf(sourceCode, identifier);
  if (!imported || typeof imported.module !== 'string' || !zodModules.has(imported.module)) {
    return false;
  }
  return imported.binding.type === 'ImportSpecifier'
    ? importedName(imported.binding) === zodNamespace
    : true;
}

/**
 * The zod export a callee calls, as `strictObject` from a named import or as `z.strictObject`
 * through the whole module, or `undefined` for a callee that does not trace to zod.
 */
function zodExportOf(sourceCode: SourceCode, callee: Node): string | undefined {
  if (callee.type === 'Identifier') {
    const imported = importOf(sourceCode, callee);
    return typeof imported?.module === 'string' && zodModules.has(imported.module)
      ? importedName(imported.binding)
      : undefined;
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.property.type === 'Identifier' &&
    isZodModule(sourceCode, callee.object)
  ) {
    return callee.property.name;
  }
  return undefined;
}

/**
 * The initializer of the `const` an identifier names, with `traced` grown by that constant, or
 * `undefined` for any other binding and for a constant already followed, so a constant that names
 * itself ends the walk.
 */
function followConstant(
  sourceCode: SourceCode,
  identifier: Identifier,
  traced: ReadonlySet<Scope.Variable>,
): { readonly init: Expression; readonly traced: ReadonlySet<Scope.Variable> } | undefined {
  const variable = variableOf(sourceCode, identifier);
  const init = variable && !traced.has(variable) ? constantInit(variable) : undefined;
  return variable && init ? { init, traced: new Set([...traced, variable]) } : undefined;
}

/**
 * Whether a value is a zod schema the source builds: a call on a zod import, a method call on
 * one, or a `const` that holds one.
 */
function isZodSchema(
  sourceCode: SourceCode,
  node: Node,
  traced: ReadonlySet<Scope.Variable>,
): boolean {
  const target = unwrapped(node);
  if (target.type === 'Identifier') {
    const followed = followConstant(sourceCode, target, traced);
    return followed !== undefined && isZodSchema(sourceCode, followed.init, followed.traced);
  }
  if (target.type !== 'CallExpression') {
    return false;
  }
  const { callee } = target;
  return (
    zodExportOf(sourceCode, callee) !== undefined ||
    (callee.type === 'MemberExpression' &&
      !callee.computed &&
      isZodSchema(sourceCode, callee.object, traced))
  );
}

/** Whether a call builds a zod strict object: `strictObject(...)`, or `.strict()` on a zod schema. */
function isStrictObject(sourceCode: SourceCode, call: CallExpression): boolean {
  const { callee } = call;
  if (zodExportOf(sourceCode, callee) === 'strictObject') {
    return true;
  }
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'strict' &&
    isZodSchema(sourceCode, callee.object, new Set())
  );
}

/** Whether a callee is `configuration` from the configuration plugin, by name or through a namespace. */
function isConfigurationCallee(sourceCode: SourceCode, callee: Node): boolean {
  if (callee.type === 'Identifier') {
    const imported = importOf(sourceCode, callee);
    return imported?.module === configModule && importedName(imported.binding) === 'configuration';
  }
  if (
    callee.type !== 'MemberExpression' ||
    callee.computed ||
    callee.object.type !== 'Identifier' ||
    callee.property.type !== 'Identifier' ||
    callee.property.name !== 'configuration'
  ) {
    return false;
  }
  const imported = importOf(sourceCode, callee.object);
  return imported?.module === configModule && imported.binding.type === 'ImportNamespaceSpecifier';
}

/**
 * Whether a child of a node is a name rather than a value: a key that is not computed, or the
 * property of a member read that is not computed. Neither refers to a variable.
 */
function isNameOnly(parent: Node, key: string): boolean {
  if (key === 'key') {
    return (
      (parent.type === 'Property' ||
        parent.type === 'MethodDefinition' ||
        parent.type === 'PropertyDefinition') &&
      !parent.computed
    );
  }
  return key === 'property' && parent.type === 'MemberExpression' && !parent.computed;
}

/** A child slot of a node as a list: an array slot as it is, any other slot as one entry. */
function slotEntries(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [value];
}

/** The value children of a node, skipping the parent link and children that are only names. */
function valueChildren(node: Node): Node[] {
  return Object.entries(node)
    .filter(([key]) => key !== 'parent' && !isNameOnly(node, key))
    .flatMap(([, value]) => slotEntries(value))
    .filter((child) => isNode(child));
}

/** Whether a node is TypeScript type syntax, which is not part of a value. */
function isTypeSyntax(node: Node): boolean {
  // The assertions that wrap a value unwrap to it; every other TypeScript node is a type.
  return node.type.startsWith('TS') && unwrapped(node) === node;
}

/**
 * Reports a strict configuration schema: every zod strict object inside the `schema` of a
 * `configuration()` call's settings object literal, following each `const` the schema names.
 */
const strictConfigurationSchema: Rule.RuleModule = {
  create(context) {
    const { sourceCode } = context;
    // A constant two schemas share holds one strict object, which is reported once.
    const reported = new Set<Node>();

    /** Reports a node that builds a zod strict object, once. */
    function reportStrict(node: Node): void {
      if (
        node.type === 'CallExpression' &&
        !reported.has(node) &&
        isStrictObject(sourceCode, node)
      ) {
        reported.add(node);
        context.report({ messageId: 'strict', node });
      }
    }

    /** Judges a schema expression at every depth, following each `const` it names. */
    function judge(node: Node, traced: ReadonlySet<Scope.Variable>): void {
      if (node.type === 'Identifier') {
        const followed = followConstant(sourceCode, node, traced);
        if (followed) {
          judge(followed.init, followed.traced);
        }
        return;
      }
      if (isTypeSyntax(node)) {
        return;
      }
      reportStrict(node);
      for (const child of valueChildren(node)) {
        judge(child, traced);
      }
    }

    return {
      CallExpression(node) {
        if (!isConfigurationCallee(sourceCode, node.callee)) {
          return;
        }
        const [settings] = positionalArguments(node) ?? [];
        if (settings?.type !== 'ObjectExpression') {
          return;
        }
        const schema = readProperty(settings, 'schema');
        if (schema.kind === 'found') {
          judge(schema.value, new Set());
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        'Disallow a zod strict object in the configuration schema, because one unknown key drops its whole section.',
      url: ruleUrl('strict-configuration-schema'),
    },
    messages: {
      strict:
        'A zod strict object drops its whole section from the configuration when the file holds a key it does not list. Use z.object, which strips unknown keys.',
    },
    schema: [],
    type: 'suggestion',
  },
};

export { strictConfigurationSchema };
