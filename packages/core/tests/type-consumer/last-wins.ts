import { Application, Command } from '@loomcli/core';
import type { PluginOptions } from '@loomcli/core';
import { z } from 'zod';

const integer = z.string().transform(Number);

// A scalar string option, an implied one, and an arity one take lastWins, and the action's types
// Are those of the same declaration without it.
new Command('mail')
  .option('editor', { lastWins: true, short: 'e', type: 'string' })
  .option('backup', { implied: 'simple', lastWins: true, type: 'string' })
  .option('resize', { arity: 2, lastWins: true, type: 'string', validate: integer })
  .option('to', { lastWins: false, required: true, type: 'string' })
  .action(({ options }) => {
    const editor: string | undefined = options.editor;
    const backup: string | undefined = options.backup;
    const resize: [number, number] | undefined = options.resize;
    const to: string = options.to;
    // @ts-expect-error TS2322: lastWins leaves an omitted optional option undefined.
    const present: string = options.editor;
    return { backup, editor, present, resize, to };
  });

// A global option, a scalar arity option bound to a variable, the background-marked option, and a
// Plugin's option take it alike.
new Application('mailer')
  .globalOption('editor', { env: 'MAILER_EDITOR', lastWins: true, type: 'string' })
  .globalOption('tint', { background: true, lastWins: true, type: 'string' })
  .option('size', { arity: 2, env: 'SIZE', envDelimiter: 'x', lastWins: true, type: 'string' });

const pluginOptions = {
  format: { lastWins: true, short: 'f', type: 'string' },
} satisfies PluginOptions;

// @ts-expect-error TS2345: A multiple option collects every occurrence, so it declares no lastWins.
new Command('bad').option('to', { lastWins: true, multiple: true, type: 'string' });
// @ts-expect-error TS2345: A multiple arity option collects every tuple, so it declares no lastWins.
new Command('bad').option('point', { arity: 2, lastWins: true, multiple: true, type: 'string' });
// @ts-expect-error TS2345: A repeated Boolean option is still a repeat.
new Command('bad').option('quiet', { lastWins: true, type: 'boolean' });
// @ts-expect-error TS2345: A counted option already counts every occurrence.
new Command('bad').option('verbose', { lastWins: true, type: 'count' });
// @ts-expect-error TS2345: A content option declares no repeat policy.
new Command('bad').option('body', { lastWins: true, type: 'content' });

export { pluginOptions };
