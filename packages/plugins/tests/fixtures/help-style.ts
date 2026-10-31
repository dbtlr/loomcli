import type { Plugin } from '@loomcli/core';
import { Application, Command, style } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand, helpInput } from '@loomcli/plugins/help/extension';
import { loomTheme, theme } from '@loomcli/plugins/theme';
import { version } from '@loomcli/plugins/version';
import { z } from 'zod';

import { runOnMock } from './in-process.ts';
import { renderingInput } from './rendering-input.js';

const inputSchema = z.object({
  argv: z.array(z.string()).optional(),
  columns: z.number().optional(),
  env: z.record(z.string(), z.string()).optional(),
  kinds: z.boolean().optional(),
  leaf: z.boolean().optional(),
  minimal: z.boolean().optional(),
  name: z.string().optional(),
  postfix: z.string().optional(),
  rendering: renderingInput.optional(),
  theme: z.string().optional(),
  tty: z.boolean().optional(),
  version: z.string().optional(),
});

/** Runs the fixture on isolated process facts and returns its recorded output. */
async function run(args: string[] = []) {
  const input = inputSchema.parse(JSON.parse(args[0] ?? '{}'));

  const plugins: Plugin[] = [
    help(),
    version(input.postfix === undefined ? undefined : { postfix: input.postfix }),
  ];

  if (input.theme !== 'absent') {
    plugins.push(
      input.theme === 'custom'
        ? theme({
            dim: style.magenta,
            highlight: style.cyan,
            primary: style.green,
            warning: style.red,
          })
        : loomTheme(),
    );
  }

  const root = new Application(input.name ?? 'app', {
    description: 'Read values.',
    plugins,
    ...(input.version === undefined ? {} : { version: input.version }),
  })
    .extend(
      helpCommand({
        details: 'One line.',
        examples: [{ command: 'get --raw «warning»', note: 'Literal flags.' }],
      }),
    )
    .command(
      new Command('get', { deprecated: 'Use read.', description: 'Read one.' }).action(() => {}),
    )
    .action(() => {});

  const leaf = new Application('wide', { description: 'Literal \uE001red\uE002.', plugins })
    .extend(
      helpCommand({
        details: 'Details \uE001.',
        examples: [{ command: '--field \uE002', note: 'Note \uE003.' }],
      }),
    )
    .argument('界é', { description: 'Wide.', required: true, variadic: true })
    .option('field', {
      deprecated: 'Use new.',
      description: 'Fields.',
      extensions: [helpInput({ placeholder: '界界' })],
      multiple: true,
      required: true,
      short: 'F',
      type: 'string',
    })
    .option('mode', {
      default: '\uE001red\uE002x\uE003',
      description: 'Literal default.',
      type: 'string',
    })
    .option('quiet', { polarity: 'negative', type: 'boolean' })
    .option('cache', { polarity: 'both', type: 'boolean' })
    .option('x', {
      description: 'Short.',
      extensions: [helpInput({ placeholder: 'é' })],
      short: 'x',
      shortOnly: true,
      type: 'string',
    })
    .action(() => {});

  const minimal = new Application('app', { plugins }).action(() => {});

  const kinds = new Application('kinds', { plugins })
    .option('backup', { implied: 'simple', type: 'string' })
    .option('verbose', { short: 'v', type: 'count' })
    .action(() => {});

  const pages = { kinds, leaf, minimal, root };

  /** The page a test names, or the root page when it names none. */
  function pageOf() {
    if (input.kinds) {
      return 'kinds';
    }
    if (input.leaf) {
      return 'leaf';
    }
    return input.minimal ? 'minimal' : 'root';
  }

  const app = pages[pageOf()];

  return await runOnMock(
    app,
    {
      argv: input.argv ?? ['--version'],
      env: input.env ?? {},
      ...(input.tty
        ? { terminal: { columns: input.columns ?? 80, rows: 24, streams: ['stdout'] } }
        : {}),
    },
    input.rendering === undefined ? {} : { rendering: input.rendering },
  );
}

export { run };
