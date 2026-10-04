import { Application, plugin } from '@loomcli/core';
import type {
  ActionHandler,
  CountOption,
  OptionNode,
  Plugin,
  PluginOptions,
  SourceAnswer,
  SuppliedInputs,
} from '@loomcli/core';
import { z } from 'zod';

const verbose = { short: 'v', type: 'count' } satisfies CountOption;

// A counted option reads a number, 0 when nothing supplied it, so it is never undefined.
new Application('counted')
  .option('verbose', verbose)
  .globalOption('level', { aliases: ['lvl'], env: 'LEVEL', type: 'count' })
  .action(({ options }) => {
    const count: number = options.verbose;
    const level: number = options.level;
    // @ts-expect-error TS2322: A counted option reads a number, never a Boolean.
    const flag: boolean = options.verbose;
    // @ts-expect-error TS2322: A counted option reads 0 when absent, never undefined.
    const absent: undefined = options.verbose;
    return { absent, count, flag, level };
  });

// @ts-expect-error TS2345: A counted option declares no validator.
new Application('bad').option('verbose', { type: 'count', validate: z.string() });
// @ts-expect-error TS2345: A counted option declares no default.
new Application('bad').option('verbose', { default: '1', type: 'count' });
// @ts-expect-error TS2345: A counted option declares no presence rule.
new Application('bad').option('verbose', { required: true, type: 'count' });
// @ts-expect-error TS2345: A counted option declares no validateOmitted.
new Application('bad').option('verbose', { type: 'count', validateOmitted: true });
// @ts-expect-error TS2345: A counted option already counts every occurrence.
new Application('bad').option('verbose', { multiple: true, type: 'count' });
// @ts-expect-error TS2345: A counted option declares no polarity.
new Application('bad').option('verbose', { polarity: 'both', type: 'count' });
// @ts-expect-error TS2345: A counted option declares no implied value.
new Application('bad').option('verbose', { implied: '1', type: 'count' });

// An implied value leaves the action's type as it would be without it.
const controls = z.enum(['none', 'simple', 'numbered']);
new Application('copyit')
  .option('backup', { implied: 'simple', short: 'b', type: 'string', validate: controls })
  .option('suffix', { default: '~', implied: '.bak', type: 'string' })
  .option('tag', { implied: 'all', multiple: true, type: 'string' })
  .action(({ options }) => {
    const control: 'none' | 'simple' | 'numbered' | undefined = options.backup;
    const suffix: string = options.suffix;
    const tags: string[] = options.tag;
    // @ts-expect-error TS2322: An implied value never makes an optional option present.
    const present: 'none' | 'simple' | 'numbered' = options.backup;
    return { control, present, suffix, tags };
  });

// TypeScript checks an implied value against the validator's input type, as it checks a default.
new Application('checked')
  .globalOption('color', {
    implied: 'always',
    type: 'string',
    validate: z.enum(['always', 'never']),
  })
  .option('depth', { implied: '3', type: 'string', validate: z.string().transform(Number) })
  .option('tag', { implied: 'all', multiple: true, type: 'string', validate: z.string() });
// @ts-expect-error TS2345: The implied value is outside the validator's input type.
new Application('bad').option('backup', { implied: 'always', type: 'string', validate: controls });
const rejected = { implied: 'always', type: 'string', validate: controls } as const;
// @ts-expect-error TS2345: A global option's implied value meets the same check.
new Application('bad').globalOption('backup', rejected);
// @ts-expect-error TS2322: An implied value is a string, the value a bare spelling supplies.
new Application('bad').option('backup', { implied: 1, type: 'string' });
// @ts-expect-error TS2345: A Boolean option declares no implied value.
new Application('bad').option('total', { implied: 'true', type: 'boolean' });

// A plugin declares both kinds as global options, typed in every action.
const verbosityOptions = {
  color: { implied: 'always', type: 'string' },
  quiet: { short: 'q', type: 'count' },
} satisfies PluginOptions;
function verbosity(): Plugin<typeof verbosityOptions> {
  return plugin('@consumer/verbosity', { options: verbosityOptions });
}
const withPlugin = new Application('plugged', { plugins: [verbosity()] }).action(({ options }) => {
  const quiet: number = options.quiet;
  const color: string | undefined = options.color;
  return { color, quiet };
});
export const counted: ActionHandler<typeof withPlugin> = ({ options }) => {
  const quiet: number = options.quiet;
  return quiet;
};

// The graph publishes a count variant and the implied value of a string option.
export function describe(option: OptionNode): string {
  switch (option.type) {
    case 'count': {
      const schema: null = option.schema;
      // @ts-expect-error TS2339: A counted option has no polarity.
      const polarity: unknown = option.polarity;
      return `${option.name} ${String(schema)} ${String(polarity)}`;
    }
    case 'string': {
      const implied: string | null = option.implied;
      return implied ?? option.name;
    }
    case 'boolean': {
      return option.polarity;
    }
    default: {
      const exhaustive: never = option;
      return exhaustive;
    }
  }
}

// A counted option's token and a source's answer for one are numbers.
export const supplied = (inputs: SuppliedInputs): unknown => inputs.options.verbose === 3;
export const answer: SourceAnswer = { label: 'verbose in .counted.json', value: 2 };
