import { Application, Command, DeclarationError } from '@loomcli/core';
import type {
  ArgumentNode,
  CommandGraph,
  CommandNode,
  OptionNode,
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from '@loomcli/core';

// `inspect()` answers in every authoring state, as `run()` and `name` do.

const fresh = new Application('fresh').globalOption('file', {
  required: true,
  short: 'f',
  type: 'string',
});
const partial = fresh.option('pretty', { type: 'boolean' });
const finished = partial.command(new Command('get').action(() => {})).action(() => {});

const freshGraph: CommandGraph = fresh.inspect();
const partialGraph: CommandGraph = partial.inspect();
const graph: CommandGraph = finished.inspect();
const root: CommandNode = graph.root;
const globalOptions: readonly OptionNode[] = graph.globals;
const slots: readonly ArgumentNode[] = root.arguments;
const name: string | null = root.name;
const path: readonly string[] = root.path;
const aliases: readonly string[] = root.aliases;

// `version` is never absent, and every other core fact reads as an optional string.
const version: string = graph.version;
const summary: string | undefined = graph.description;
const rootSummary: string | undefined = root.description;
const argumentSummary = (slot: ArgumentNode): string | undefined => slot.description;
const optionSummary = (option: OptionNode): string | undefined => option.description;

// Every Command and option node carries the two listing facts, and no argument node does.
const rootHidden: boolean = root.hidden;
const rootDeprecated: string | undefined = root.deprecated;
const optionHidden = (option: OptionNode): boolean => option.hidden;
const optionDeprecated = (option: OptionNode): string | undefined => option.deprecated;
// @ts-expect-error TS2339: An argument carries neither listing fact.
slots.map((slot) => slot.hidden);

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

// Every input node carries the input schema, a plain read-only record or null, on both option forms.
const argumentSchema = (slot: ArgumentNode): Readonly<Record<string, unknown>> | null =>
  slot.schema;
const optionSchema = (option: OptionNode): Readonly<Record<string, unknown>> | null =>
  option.schema;
// @ts-expect-error TS2542: The published schema is read-only, so a consumer cannot edit it.
graph.globals.map((option) => (option.schema === null ? null : (option.schema.type = 'number')));

// A hand-written schema declares its converter with the standard's own type beside the validator.
const digits: StandardSchemaV1<string, number> & StandardJSONSchemaV1<string, number> = {
  '~standard': {
    jsonSchema: {
      input: () => ({ pattern: '^[0-9]+$', type: 'string' }),
      output: () => ({ type: 'integer' }),
    },
    validate: (value: unknown) =>
      typeof value === 'string' && /^[0-9]+$/.test(value)
        ? { value: Number(value) }
        : { issues: [{ message: 'Use decimal digits.' }] },
    vendor: 'consumer',
    version: 1,
  },
};
const converted = new Application('converted')
  .option('size', { type: 'string', validate: digits })
  .action(({ options }) => {
    const size: number = options.size ?? 0;
    void size;
  });

// The declaration error is a class, so a consumer narrows a caught value with `instanceof`.
function describe(error: unknown): string {
  if (error instanceof DeclarationError) {
    return error.message;
  }
  throw error;
}

void spelling;
void describe;
void argumentSchema;
void optionSchema;
void converted;
void freshGraph;
void partialGraph;
void globalOptions;
void slots;
void name;
void path;
void aliases;
void version;
void summary;
void rootSummary;
void argumentSummary;
void optionSummary;
void rootHidden;
void rootDeprecated;
void optionHidden;
void optionDeprecated;
