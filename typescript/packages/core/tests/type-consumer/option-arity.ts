import { Application, Command } from '@loomcli/core';
import type { PluginOptions, StringOption } from '@loomcli/core';
import { z } from 'zod';

const integer = z.string().transform(Number);

// A literal arity reads a tuple of that length, of the validator's output or of the raw words.
new Command('arity')
  .option('point', { arity: 2, type: 'string', validate: integer })
  .option('rename', { arity: 2, required: true, type: 'string' })
  .option('box', { arity: 3, default: ['1', '2', '3'], type: 'string', validate: integer })
  .action(({ options }) => {
    const point: [number, number] | undefined = options.point;
    const rename: [string, string] = options.rename;
    const box: [number, number, number] = options.box;
    // @ts-expect-error TS2322: An omitted optional arity option reads undefined.
    const present: [number, number] = options.point;
    // @ts-expect-error TS2322: The tuple has the declared length.
    const longer: [string, string, string] = options.rename;
    return { box, longer, point, present, rename };
  });

// A multiple arity option reads one tuple per occurrence, and an omitted one reads [].
new Command('points')
  .option('point', { arity: 2, multiple: true, type: 'string', validate: integer })
  .option('pair', { arity: 2, default: [['a', 'b']], multiple: true, type: 'string' })
  .action(({ options }) => {
    const points: [number, number][] = options.point;
    const pairs: [string, string][] = options.pair;
    // @ts-expect-error TS2322: A multiple arity option is never undefined.
    const absent: undefined = options.point;
    return { absent, pairs, points };
  });

// A union of counts reads a union of tuples, one per count, so a longer occurrence keeps its words.
const either: 2 | 3 = Number('2') > 1 ? 2 : 3;
new Command('either')
  .option('words', { arity: either, required: true, type: 'string' })
  .action(({ options }) => {
    const words: [string, string] | [string, string, string] = options.words;
    const three: [string, string, string] | [string, string] = words;
    // @ts-expect-error TS2322: The value may hold three words, so it is not always a pair.
    const pair: [string, string] = options.words;
    return { pair, three, words };
  });

// An arity typed as the wide number reads an array of the output.
const count = Number('2');
new Command('wide')
  .option('words', { arity: count, required: true, type: 'string' })
  .action(({ options }) => {
    const words: string[] = options.words;
    return words;
  });

// A scalar arity option binds a variable beside the delimiter that splits it, on a global option too.
new Application('bound')
  .globalOption('size', { arity: 2, env: 'BOX_SIZE', envDelimiter: 'x', type: 'string' })
  .option('origin', { arity: 2, env: ['ORIGIN', 'OLD_ORIGIN'], envDelimiter: ',', type: 'string' });

const pluginOptions = {
  size: { arity: 2, env: 'BOX_SIZE', envDelimiter: 'x', type: 'string' },
} satisfies PluginOptions;

// @ts-expect-error TS2345: A scalar arity option that binds env declares an envDelimiter.
new Command('bad').option('size', { arity: 2, env: 'BOX_SIZE', type: 'string' });
// @ts-expect-error TS2345: A multiple arity option binds no variable.
new Command('bad').option('point', {
  arity: 2,
  env: 'POINT',
  envDelimiter: ',',
  multiple: true,
  type: 'string',
});
// @ts-expect-error TS2345: An empty variable never fills an arity, so it takes no envAllowEmpty.
new Command('bad').option('size', {
  arity: 2,
  env: 'BOX_SIZE',
  envAllowEmpty: true,
  envDelimiter: 'x',
  type: 'string',
});
// @ts-expect-error TS2345: An arity option takes its words separately, so it implies none.
new Command('bad').option('point', { arity: 2, implied: '0', type: 'string' });
// @ts-expect-error TS2345: An arity option sends no omission to its validator.
new Command('bad').option('point', { arity: 2, type: 'string', validateOmitted: true });
// @ts-expect-error TS2345: A Boolean option declares no arity.
new Command('bad').option('force', { arity: 2, type: 'boolean' });
// @ts-expect-error TS2345: A counted option declares no arity.
new Command('bad').option('verbose', { arity: 2, type: 'count' });
// @ts-expect-error TS2345: A content option declares no arity.
new Command('bad').option('file', { arity: 2, type: 'content' });
// @ts-expect-error TS2322: The background option declares no arity.
new Application('bad').globalOption('shade', { arity: 2, background: true, type: 'string' });

// @ts-expect-error TS2322: A default is a tuple of the declared length.
new Command('bad').option('point', { arity: 2, default: ['a'], type: 'string' });
const listDefault = {
  arity: 2,
  default: ['a', 'b'],
  multiple: true,
  type: 'string',
} satisfies StringOption;
// @ts-expect-error TS2345: A multiple arity option's default is a list of tuples.
new Command('bad').option('point', listDefault);
const tupleValidator = {
  arity: 2,
  type: 'string',
  validate: z.array(z.string()),
} satisfies StringOption;
// @ts-expect-error TS2345: The validator reads one word, so an array input cannot serve.
new Command('bad').option('point', tupleValidator);

export { pluginOptions };
