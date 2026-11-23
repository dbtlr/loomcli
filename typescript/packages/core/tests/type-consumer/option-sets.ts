import { Application, Command, optionSet } from '@loomcli/core';
import type { ActionOptions, OptionSet } from '@loomcli/core';
import { z } from 'zod';

/**
 * `true` exactly when the two types are the same type. An annotation alone would also accept an
 * inferred `never` or `any`, so the checks below compare with this instead.
 */
type Equal<Left, Right> =
  (<Probe>(probe: Probe) => Probe extends Left ? 1 : 2) extends <Probe>(
    probe: Probe,
  ) => Probe extends Right ? 1 : 2
    ? true
    : false;

/** One object type with each member read out, so an intersection compares member by member. */
type Members<Value> = { [Key in keyof Value]: Value[Key] };

/** Compiles only for `true`. */
function holds<Check extends true>(check: Check): Check {
  return check;
}

const port = z.string().transform(Number);

const output = optionSet({
  json: { description: 'Print JSON.', type: 'boolean' },
  level: { default: '1', type: 'string', validate: port },
  tag: { multiple: true, short: 't', type: 'string' },
  verbose: { short: 'v', type: 'count' },
  yaml: { description: 'Print YAML.', type: 'boolean' },
}).exclusive('json', 'yaml');

// A Command built with a set reads the same option types as one built one by one.
// An exported Command that applies a set emits declarations like any other.
const withSet = new Command('list').options(output).action(() => undefined);
const oneByOne = new Command('list')
  .option('json', { description: 'Print JSON.', type: 'boolean' })
  .option('level', { default: '1', type: 'string', validate: port })
  .option('tag', { multiple: true, short: 't', type: 'string' })
  .option('verbose', { short: 'v', type: 'count' })
  .option('yaml', { description: 'Print YAML.', type: 'boolean' })
  .exclusive('json', 'yaml')
  .action(() => undefined);
holds<Equal<Members<ActionOptions<typeof withSet>>, Members<ActionOptions<typeof oneByOne>>>>(true);

// A Command with no action yet, and the root, emit their declarations too.
const unfinished = new Command('show').options(output);
const root = new Application('app').options(output);
const rootFinished = root.action(({ options }) => {
  const level: number = options.level;
  const tags: string[] = options.tag;
  const count: number = options.verbose;
  const json: boolean = options.json;
  return { count, json, level, tags };
});

// A set's option sits beside the Command's own, and a later group may name both.
new Command('show')
  .option('wide', { type: 'boolean' })
  .options(output)
  .exclusive('json', 'wide')
  .action(({ options }) => {
    const wide: boolean = options.wide;
    const json: boolean = options.json;
    return { json, wide };
  });

// A group call returns a set of the same members, so a set still applies after it.
const grouped: OptionSet<{ first: { type: 'boolean' }; second: { type: 'boolean' } }> = optionSet({
  first: { type: 'boolean' },
  second: { type: 'boolean' },
})
  .oneRequired('first', 'second')
  .requiredTogether('first', 'second');
new Command('pair').options(grouped).action(({ options }) => options.first && options.second);

// An empty set applies and adds nothing.
new Command('empty').options(optionSet({})).action(({ options }) => options);

// @ts-expect-error TS2345: A name the Command already declares is a compile error.
new Command('twice').option('json', { type: 'boolean' }).options(output);

new Application('app')
  .globalOption('json', { type: 'boolean' })
  // @ts-expect-error TS2345: A name the global options hold is a compile error.
  .options(output);

// @ts-expect-error TS2345: A group that names an option outside the set fails to compile.
optionSet({ json: { type: 'boolean' }, yaml: { type: 'boolean' } }).exclusive('json', 'csv');

// @ts-expect-error TS2555: A group names at least two of the set's options.
optionSet({ json: { type: 'boolean' }, yaml: { type: 'boolean' } }).exclusive('json');

const invalidLevel = {
  default: 'medium',
  type: 'string',
  validate: z.enum(['low', 'high']),
} as const;
optionSet({
  // @ts-expect-error TS2322: A default outside the validator's input type fails as option() fails.
  level: invalidLevel,
});

optionSet({
  // @ts-expect-error TS2322: A multiple option's validator accepts one string, as option() requires.
  points: { multiple: true, type: 'string', validate: z.array(z.string()) },
});

optionSet({
  // @ts-expect-error TS2322: A local option carries no run-wide mark, as option() requires.
  color: { color: true, type: 'string' },
});

const keys: readonly string[] = ['name'];
const computed = keys[0] ?? 'name';
// @ts-expect-error TS2345: A computed key typed string is not one literal name.
optionSet({ [computed]: { type: 'boolean' } });

new Command('closed')
  .action(() => undefined)
  // @ts-expect-error TS2339: action() closes options() as it closes option().
  .options(output);

export { oneByOne, output, root, rootFinished, unfinished, withSet };
