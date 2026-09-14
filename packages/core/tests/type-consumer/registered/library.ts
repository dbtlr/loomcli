import { Application, extension, plugin } from '@loomcli/core';
import type { ActionHandler, EnvironmentOf, OptionsOf } from '@loomcli/core';
import { z } from 'zod';

import { build, colliding, direct, factory, summarize } from '../library/dist/library.js';

const help = extension('consumer/help', { schema: z.string(), target: 'command' });
const enriched = build.extend(help('Application help.'));
const app = new Application('consumer')
  .globalOption('file', { required: true, short: 'f', type: 'string' })
  .globalOption('quiet', { short: 'q', type: 'boolean' })
  .globalOption('limit', { type: 'string', validate: z.string().transform(Number) })
  .command(enriched)
  .command(direct.extend(help('Direct help.')))
  .command(factory().extend(help('Factory help.')))
  // A library Command that declares a result attaches like any other.
  .command(summarize);
new Application('collision')
  .globalOption('file', { required: true, short: 'f', type: 'string' })
  .globalOption('quiet', { short: 'q', type: 'boolean' })
  .globalOption('limit', { type: 'string', validate: z.string().transform(Number) })
  // @ts-expect-error TS2345: A library local key cannot collide with an Application global key.
  .command(colliding);

const read: ActionHandler<typeof enriched> = ({ args, options }) => {
  const path: string = args.path;
  const raw: boolean = options.raw;
  // @ts-expect-error TS2339: Extension configuration does not retype a library action.
  options.file;
  return { path, raw };
};
const neutral: ActionHandler<typeof direct> = ({ options }) =>
  // @ts-expect-error TS2339: An explicit bare Command annotation remains library-neutral.
  options.file;
const made = factory();
const neutralFactory: ActionHandler<typeof made> = ({ options }) =>
  // @ts-expect-error TS2339: A factory return annotation remains library-neutral.
  options.file;
// @ts-expect-error TS2339: Extending a completed library Command keeps inputs closed.
enriched.option;
// @ts-expect-error TS2345: A command only accepts command-targeted values.
enriched.extend(extension('consumer/input', { schema: z.string(), target: 'option' })('wrong'));

const vocabulary = plugin('consumer/vocabulary', { options: { identifier: { type: 'boolean' } } });
const configured = new Application('tuple', { plugins: [vocabulary] }).extend(help('Root'));
type Vocabulary = keyof OptionsOf<EnvironmentOf<typeof configured>['plugins'][number]>;
const name: Vocabulary = 'identifier';
// @ts-expect-error TS2322: Plugin tuple types survive Application derivation without widening.
const wrongName: Vocabulary = 'identifer';
void name;
void wrongName;
// @ts-expect-error TS2741: EnvironmentOf requires an Application environment marker.
type Invalid = EnvironmentOf<typeof build>;

const chosen = Math.random() > 0.5 ? build : colliding;
new Application('union')
  .globalOption('file', { required: true, short: 'f', type: 'string' })
  .globalOption('quiet', { short: 'q', type: 'boolean' })
  .globalOption('limit', { type: 'string', validate: z.string().transform(Number) })
  // @ts-expect-error TS2345: Every possible branch must have disjoint local keys.
  .command(chosen);
new Application('explicit', {
  plugins: [vocabulary],
})
  .globalOption('file', { required: true, short: 'f', type: 'string' })
  .globalOption('quiet', { short: 'q', type: 'boolean' })
  .globalOption('limit', { type: 'string', validate: z.string().transform(Number) });

function acceptApplication(value: Application<{}, {}, EnvironmentOf<typeof app>['globals']>) {
  return value;
}
acceptApplication(
  new Application('annotation', {
    plugins: [vocabulary],
  })
    .globalOption('file', { required: true, short: 'f', type: 'string' })
    .globalOption('quiet', { short: 'q', type: 'boolean' })
    .globalOption('limit', { type: 'string', validate: z.string().transform(Number) }),
);
// @ts-expect-error TS2554: Constructor type parameters cannot forge global outputs.
new Application<{ file: number }>('wrong-output')
  .globalOption('file', { required: true, short: 'f', type: 'string' })
  .globalOption('quiet', { short: 'q', type: 'boolean' })
  .globalOption('limit', { type: 'string', validate: z.string().transform(Number) });

export { enriched, app, read, neutral, neutralFactory, type Invalid };
