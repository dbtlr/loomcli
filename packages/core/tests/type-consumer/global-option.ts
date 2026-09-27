import { Application } from '@loomcli/core';
import type { EnvironmentOf, OptionConfig } from '@loomcli/core';
import { z } from 'zod';

const base = new Application('example').option('local', { type: 'boolean' });
const configured = base
  .globalOption('quiet', { type: 'boolean' })
  .globalOption('limit', { default: '10', type: 'string', validate: z.string().transform(Number) })
  .globalOption('tags', { multiple: true, type: 'string' })
  .globalOption('source', { type: 'string', validate: z.string() });
configured.action(({ options }) => {
  const local: boolean = options.local;
  const quiet: boolean = options.quiet;
  const limit: number = options.limit;
  const tags: string[] = options.tags;
  const source: string | undefined = options.source;
  return { limit, local, quiet, source, tags };
});
const globals: EnvironmentOf<typeof configured>['globals'] = {
  limit: 10,
  quiet: false,
  source: undefined,
  tags: [],
};
// @ts-expect-error TS2339: A derived global does not change its receiver's type.
base.action(({ options }) => options.quiet);
// @ts-expect-error TS2345: Global keys cannot overlap root-local keys in either declaration order.
base.globalOption('local', { type: 'boolean' });
// @ts-expect-error TS2345: Root-local keys cannot overlap globals.
configured.option('quiet', { type: 'boolean' });
declare const wide: string;
// @ts-expect-error TS2345: One global declaration needs one literal key.
base.globalOption(wide, { type: 'boolean' });
const union = Math.random() ? 'one' : 'two';
// @ts-expect-error TS2345: A global name cannot promise several keys.
base.globalOption(union, { type: 'boolean' });
// @ts-expect-error TS2345: A multiple global's validator reads one value, never the array.
base.globalOption('values', { multiple: true, type: 'string', validate: z.array(z.string()) });
const invalidDefault = {
  default: 10,
  type: 'string',
  validate: z.string().transform(Number),
} satisfies OptionConfig;
// @ts-expect-error TS2345: Global defaults use the schema input type.
base.globalOption('count', invalidDefault);
const typed: OptionConfig = { type: 'string' };
// A config typed as the wide OptionConfig declares no presence rule, so it stays a valid global.
base.globalOption('typed', typed);
// @ts-expect-error TS2345: A global option's omission is plain absence, never a required input.
base.globalOption('file', { required: true, type: 'string' });
// @ts-expect-error TS2345: A global option declares no required key, false included.
base.globalOption('file', { required: false, type: 'string' });
// @ts-expect-error TS2345: A global option never sends its omission to a validator.
base.globalOption('file', {
  type: 'string',
  validate: z.string().optional(),
  validateOmitted: true,
});
// @ts-expect-error TS2339: A configured environment excludes root-local options.
globals.local;
// @ts-expect-error TS2322: A no-plugin Application retains its empty tuple through globalOption().
const invented: EnvironmentOf<typeof configured>['plugins'] = [{}];
void invented;
