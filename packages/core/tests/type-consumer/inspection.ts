import { Application, Command, DeclarationError, GlobalOptions } from '@loom/core';
import type { ArgumentNode, CommandGraph, CommandNode, OptionNode } from '@loom/core';

// `inspect()` answers in every authoring state, as `run()` and `name` do.
const globals = new GlobalOptions().option('file', { required: true, short: 'f', type: 'string' });
const fresh = new Application('fresh', { globals });
const partial = fresh.option('pretty', { type: 'boolean' });
const finished = partial.command(new Command('get', globals).action(() => {})).action(() => {});

const freshGraph: CommandGraph = fresh.inspect();
const partialGraph: CommandGraph = partial.inspect();
const graph: CommandGraph = finished.inspect();
const root: CommandNode = graph.root;
const globalOptions: readonly OptionNode[] = graph.globals;
const slots: readonly ArgumentNode[] = root.arguments;
const name: string | null = root.name;
const path: readonly string[] = root.path;
const aliases: readonly string[] = root.aliases;

// The option union reads by its `type` tag, and each form publishes its own spellings.
const spelling = (option: OptionNode) =>
  option.type === 'boolean' ? option.negative : option.default;

// @ts-expect-error TS2339: A boolean option publishes no default value.
graph.globals.map((option) => (option.type === 'boolean' ? option.default : null));
// @ts-expect-error TS2540: The graph is read-only data, so a consumer cannot rename it.
graph.name = 'other';
// @ts-expect-error TS2540: A node is read-only, so a consumer cannot restate its action.
root.hasAction = true;
// @ts-expect-error TS2339: A read-only list publishes no mutating call.
root.children.push(root);
// @ts-expect-error TS2339: The alias list is read-only too.
root.aliases.push('other');
// @ts-expect-error TS2339: The graph carries the globals once, never inside a Command node.
root.globals;

// The declaration error is a class, so a consumer narrows a caught value with `instanceof`.
function describe(error: unknown): string {
  if (error instanceof DeclarationError) {
    return error.message;
  }
  throw error;
}

void spelling;
void describe;
void freshGraph;
void partialGraph;
void globalOptions;
void slots;
void name;
void path;
void aliases;
