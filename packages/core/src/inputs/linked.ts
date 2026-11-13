import type { StandardSchemaV1 } from '@standard-schema/spec';

import { foreignGraphCorrection } from '../diagnostics/rules.js';
import type { CommandGraph, CommandNode } from '../inspection/inspect.js';
import { graphMismatch, linkOf } from '../inspection/inspect.js';
import type { ActionContext } from '../invocation/types.js';
import { questionValidationOptions } from './context.js';

/**
 * One element of an input's value: the element of a collected input's list, or a single input's value.
 * The type reads the value, not the declaration, so a single-value input whose validated value is an
 * array reads as a collected input, and its element is the output's type.
 *
 * @public
 * @sealed
 */
type LinkedValue<Value> = [Value] extends [readonly (infer Element)[]] ? Element : Value;
/**
 * The run facts `validateLinkedValue` reads from an action context core built.
 *
 * @public
 */
type LinkedValueContext<Args, Options> = Pick<
  ActionContext<Args, Options>,
  'args' | 'options' | 'graph' | 'command' | 'host' | 'passthrough' | 'supplied'
>;
/**
 * The input a question links and its message: a local option by `option`, or an argument by
 * `argument`, never both.
 *
 * @public
 */
type ValueLink<Args, Options> =
  | { readonly message: string; readonly option: keyof Options & string; readonly argument?: never }
  | { readonly message: string; readonly argument: keyof Args & string; readonly option?: never };
/**
 * The validated output of one value of the input a link names.
 *
 * @public
 * @sealed
 */
type LinkedOutput<Args, Options, Link> = Link extends {
  readonly argument: infer Name extends keyof Args;
}
  ? LinkedValue<Args[Name]>
  : Link extends { readonly option: infer Key extends keyof Options }
    ? LinkedValue<Options[Key]>
    : never;

/** Authenticates the routed node against the graph registry before reading declarations. */
function linkedCommand(graph: CommandGraph, node: CommandNode) {
  const registered = linkOf(graph, foreignGraphCorrection);
  let command = registered.graph.root;
  for (const name of node.path) {
    const child = command.children.get(name);
    if (!child) {
      throw graphMismatch('The linked command is not in the inspected graph.');
    }
    command = child;
  }
  if (registered.nodes.get(command) !== node) {
    throw graphMismatch('The linked command is not the inspected graph’s own node.');
  }
  return command;
}

/**
 * Runs one value through the validator the linked input declares, in the question phase's
 * validation context, and resolves the validator's result. A context whose graph core did not
 * build throws under `@loomcli/core/foreign-graph`.
 *
 * @example
 * ```ts
 * import { Command, validateLinkedValue } from '@loomcli/core';
 *
 * import { targetSchema } from './schemas.js';
 *
 * export const deploy = new Command('deploy')
 *   .option('target', { type: 'string', validate: targetSchema })
 *   .action(async (context) => {
 *     const result = await validateLinkedValue(
 *       context,
 *       { message: 'Where to deploy?', option: 'target' },
 *       'staging',
 *     );
 *     context.out.print(result.issues === undefined ? 'valid' : 'invalid');
 *   });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/core/validation.md#validation-context
 * @public
 */
function validateLinkedValue<Args, Options, const Link extends ValueLink<Args, Options>>(
  context: LinkedValueContext<Args, Options>,
  link: Link,
  value: string,
): Promise<StandardSchemaV1.Result<LinkedOutput<Args, Options, Link>>>;
async function validateLinkedValue<Args, Options>(
  context: LinkedValueContext<Args, Options>,
  link: ValueLink<Args, Options>,
  value: string,
): Promise<StandardSchemaV1.Result<unknown>> {
  const command = linkedCommand(context.graph, context.command);
  const input = command.inputs.find(
    (entry) =>
      entry.kind === (link.option === undefined ? 'argument' : 'option') &&
      entry.name === (link.option ?? link.argument),
  );
  const validator = input && 'validate' in input.config ? input.config.validate : undefined;
  return validator === undefined
    ? { value }
    : validator['~standard'].validate(value, questionValidationOptions(context, link));
}
export { validateLinkedValue };
export type { LinkedValue, LinkedValueContext, ValueLink, LinkedOutput };
