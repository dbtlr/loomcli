import type { Rule, Scope } from 'eslint';
import type { CallExpression, Identifier, Node } from 'estree';

import {
  followConstant,
  importedName,
  importOf,
  isConfigurationCallee,
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
 * longer reaches the schema as one: at a property read such as `.shape`, at a method whose result
 * is no strict object, such as `.loose()`, and at a function that runs on the parsed value, such
 * as a `refine` callback.
 */

/** The specifiers that load zod: version 4 classic and mini, and version 3. */
const zodModules: ReadonlySet<string> = new Set([
  'zod',
  'zod/mini',
  'zod/v3',
  'zod/v4',
  'zod/v4-mini',
  'zod/v4/mini',
]);

/**
 * The zod methods, and zod mini's functions of the same names, whose result is no strict object,
 * so it reports no unknown key on itself: a loose copy of the object, or the enum of its keys.
 */
const unstrictMethods: ReadonlySet<string> = new Set([
  'catchall',
  'keyof',
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
 * `refine` callback, runs on the parsed value rather than describing it. The functions that do
 * describe it, `z.lazy`'s and a getter's, are judged by what they return instead.
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
 * unless the method's result is no strict object. A plain function call carries none.
 */
function carriedReceiver(call: CallExpression): Node | undefined {
  const { callee } = call;
  if (callee.type !== 'MemberExpression') {
    return undefined;
  }
  const unstricts =
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    unstrictMethods.has(callee.property.name);
  return unstricts ? undefined : callee.object;
}

/**
 * What a function returns: an arrow's expression body, or the argument of each `return` at the top
 * of its block. Any other node stands for itself.
 */
function returnedValues(node: Node): Node[] {
  if (node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression') {
    return [node];
  }
  const { body } = node;
  if (body.type !== 'BlockStatement') {
    return [body];
  }
  return body.body.flatMap((statement) =>
    statement.type === 'ReturnStatement' && statement.argument ? [statement.argument] : [],
  );
}

/**
 * The arguments a call carries into its result: every argument, with what a function returns in
 * place of the function for `z.lazy`, and without the object for a zod function whose result is no
 * strict object, such as zod mini's `z.keyof(object)` and `z.catchall(object, rest)`.
 */
function carriedArguments(sourceCode: SourceCode, call: CallExpression): Node[] {
  const exported = zodExportOf(sourceCode, call.callee);
  if (exported === 'lazy') {
    return call.arguments.flatMap((argument) => returnedValues(argument));
  }
  if (exported === undefined || !unstrictMethods.has(exported)) {
    return [...call.arguments];
  }
  const [, ...rest] = call.arguments;
  return rest;
}

/** The children a call carries into its result: its arguments, and the receiver of a method call. */
function callChildren(sourceCode: SourceCode, call: CallExpression): Node[] {
  const values = carriedArguments(sourceCode, call);
  const receiver = carriedReceiver(call);
  return receiver === undefined ? values : [receiver, ...values];
}

/**
 * The children of a node a strict object can reach the schema through: what a call carries, what
 * a getter in an object literal returns, or every value child of any other node.
 */
function schemaChildren(sourceCode: SourceCode, node: Node): Node[] {
  if (node.type === 'CallExpression') {
    return callChildren(sourceCode, node);
  }
  if (node.type === 'Property' && node.kind === 'get') {
    return returnedValues(node.value);
  }
  return valueChildren(node);
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
    // A constant several sections share is walked once, so shared sections cost no more than one.
    const walked = new Set<Node>();

    /** Whether the walk reaches a node for the first time, which it records. */
    function firstWalk(node: Node): boolean {
      if (walked.has(node)) {
        return false;
      }
      walked.add(node);
      return true;
    }

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
      if (isOutsideSchema(node) || !firstWalk(node)) {
        return;
      }
      reportStrict(node);
      for (const child of schemaChildren(sourceCode, node)) {
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
