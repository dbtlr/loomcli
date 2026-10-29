import type { Rule, Scope } from 'eslint';
import type { CallExpression, Identifier, Node } from 'estree';

import {
  followConstant,
  importedName,
  importOf,
  isNode,
  positionalArguments,
  readProperty,
  unwrapped,
} from '../declarations.js';
import { ruleUrl } from '../docs.js';

/*
 * Zod reports an unknown key in a strict object as an issue on the object itself, so the
 * configuration plugin drops the whole object. This rule reports a zod strict object it can trace
 * into the schema a `configuration()` call names. It follows what the source itself builds: a
 * call on a zod import, the schemas a call takes or is called on, and a `const` in the module.
 * valibot and ArkType name the unknown key itself, and a `.strict()` whose receiver does not trace
 * to zod means something else, such as yup's skip-coercion mode, so neither is reported: a false
 * report is worse than a missed one. For the same reason the walk stops where a strict object no
 * longer reaches the schema as one: at a property read such as `.shape`, at a method that makes
 * an object loose, and at a function body such as a `refine` callback.
 */

/** The module the configuration plugin is imported from. */
const configModule = '@loomcli/plugins/config';

/** The specifiers that load zod: version 4 classic and mini, and version 3. */
const zodModules: ReadonlySet<string> = new Set([
  'zod',
  'zod/mini',
  'zod/v3',
  'zod/v4',
  'zod/v4-mini',
  'zod/v4/mini',
]);

/** The zod methods that return a loose copy of an object, which reports no unknown key on itself. */
const looseningMethods: ReadonlySet<string> = new Set([
  'catchall',
  'loose',
  'passthrough',
  'strip',
]);

/** The name zod exports its whole module under, as in `import { z } from 'zod'`. */
const zodNamespace = 'z';

/** The scope analysis the rule reads. */
type SourceCode = Rule.RuleContext['sourceCode'];

/** Whether an identifier is the whole zod module: a namespace, a default, or the named `z` import. */
function isZodModule(sourceCode: SourceCode, identifier: Identifier): boolean {
  const imported = importOf(sourceCode, identifier);
  if (!imported || typeof imported.source !== 'string' || !zodModules.has(imported.source)) {
    return false;
  }
  return imported.specifier.type === 'ImportSpecifier'
    ? importedName(imported.specifier) === zodNamespace
    : true;
}

/**
 * The zod export a callee calls, as `strictObject` from a named import or as `z.strictObject`
 * through the whole module, or `undefined` for a callee that does not trace to zod.
 */
function zodExportOf(sourceCode: SourceCode, callee: Node): string | undefined {
  if (callee.type === 'Identifier') {
    const imported = importOf(sourceCode, callee);
    return typeof imported?.source === 'string' && zodModules.has(imported.source)
      ? importedName(imported.specifier)
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
    return (
      imported?.source === configModule && importedName(imported.specifier) === 'configuration'
    );
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
  return (
    imported?.source === configModule && imported.specifier.type === 'ImportNamespaceSpecifier'
  );
}

/**
 * Whether a child of a node is a name rather than a value: a key that is not computed. It refers
 * to no variable.
 */
function isNameOnly(parent: Node, key: string): boolean {
  return (
    key === 'key' &&
    (parent.type === 'Property' ||
      parent.type === 'MethodDefinition' ||
      parent.type === 'PropertyDefinition') &&
    !parent.computed
  );
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

/**
 * Whether a strict object inside a node cannot reach the schema as one. TypeScript type syntax is
 * not part of the value; the assertions that wrap a value unwrap to it, so they are walked. A
 * property read takes a field off a value, such as `.shape`, and a function body, such as a
 * `refine` callback, runs on the parsed value rather than describing it.
 */
function isOutsideSchema(node: Node): boolean {
  return (
    (node.type.startsWith('TS') && unwrapped(node) === node) ||
    node.type === 'MemberExpression' ||
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression'
  );
}

/**
 * The receiver a call carries into its result, which the walk judges: the object of a method call,
 * unless the method makes an object loose. A plain function call carries none.
 */
function carriedReceiver(call: CallExpression): Node | undefined {
  const { callee } = call;
  if (callee.type !== 'MemberExpression') {
    return undefined;
  }
  const loosens =
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    looseningMethods.has(callee.property.name);
  return loosens ? undefined : callee.object;
}

/**
 * The children of a node a strict object can reach the schema through: a call's arguments and the
 * receiver it carries, or every value child of any other node.
 */
function schemaChildren(node: Node): Node[] {
  if (node.type !== 'CallExpression') {
    return valueChildren(node);
  }
  const receiver = carriedReceiver(node);
  return receiver === undefined ? [...node.arguments] : [receiver, ...node.arguments];
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
      if (isOutsideSchema(node)) {
        return;
      }
      reportStrict(node);
      for (const child of schemaChildren(node)) {
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
