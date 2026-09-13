import { Application, extension, plugin } from '@loomcli/core';
import type { ActionHandler, EnvironmentOf, OptionsOf } from '@loomcli/core';
import { z } from 'zod';

import { build, colliding, direct, factory } from '../library/dist/library.js';
import { globals } from './commands.js';

const help = extension('consumer/help', { schema: z.string(), target: 'command' });
const enriched = build.extend(help('Application help.'));
const app = new Application('consumer', { globals })
  .command(enriched)
  .command(direct.extend(help('Direct help.')))
  .command(factory().extend(help('Factory help.')));
// @ts-expect-error TS2345: A library local key cannot collide with an Application global key.
new Application('collision', { globals }).command(colliding);

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
// @ts-expect-error TS2345: Every possible branch must have disjoint local keys.
new Application('union', { globals }).command(chosen);
new Application<{ file: string }>('explicit', { globals, plugins: [vocabulary] });

function acceptApplication(value: Application<{}, {}, EnvironmentOf<typeof app>['globals']>) {
  return value;
}
acceptApplication(new Application('annotation', { globals, plugins: [vocabulary] }));
// @ts-expect-error TS2769: Runtime globals configuration must agree with explicit output types.
new Application<{ file: number }>('wrong-output', { globals });

export { enriched, app, read, neutral, neutralFactory, type Invalid };
