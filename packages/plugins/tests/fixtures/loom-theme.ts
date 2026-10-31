import type { ConcreteStyle, Plugin, ThemeMapping } from '@loomcli/core';
import { Application, plugin, style } from '@loomcli/core';
import { loomTheme, theme } from '@loomcli/plugins/theme';
import { z } from 'zod';

import { runOnMock } from './in-process.ts';
import { renderingInput } from './rendering-input.js';

const inputSchema = z.object({
  absent: z.boolean().optional(),
  background: z.enum(['dark', 'light']).optional(),
  bare: z.boolean().optional(),
  collision: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  literal: z.string().optional(),
  outer: z.boolean().optional(),
  overrides: z
    .record(z.string(), z.array(z.enum(['cyan', 'magenta', 'bold', 'resetForeground'])).nullable())
    .optional(),
  rendering: renderingInput.optional(),
  tokens: z.array(z.string()).optional(),
  tty: z.boolean().optional(),
});

/** Runs the fixture on isolated process facts and returns its recorded output. */
async function run(args: string[] = []) {
  const input = inputSchema.parse(JSON.parse(args[0] ?? '{}'));

  const overrides =
    input.overrides &&
    Object.fromEntries(
      Object.entries(input.overrides).map(([name, chain]) => [
        name,
        chain === null
          ? undefined
          : chain.reduce((current: ConcreteStyle, step) => current[step], style),
      ]),
    );

  let plugins: Plugin<{}, ThemeMapping>[] = [loomTheme(overrides)];

  if (input.bare) {
    plugins = [theme({})];
  }

  if (input.absent) {
    plugins = [];
  }

  if (input.collision === 'identity') {
    plugins.push(theme({}));
  }

  if (input.collision === 'slot') {
    plugins.push(plugin('another', { theme: {} }));
  }

  const app = new Application('palette', { plugins }).action(({ out, style: contextual }) => {
    const tokens = input.tokens ?? [
      'primary',
      'dim',
      'highlight',
      'success',
      'warning',
      'error',
      'info',
    ];
    let text = tokens
      .map((name) => {
        const token: unknown = Reflect.get(contextual, name);
        if (typeof token !== 'function') {
          throw new Error(`No style token named ${name}.`);
        }
        return z.string().parse(token(name));
      })
      .join('|');
    if (input.literal) {
      text = input.literal;
    }
    if (input.outer) {
      text = style.red.bgBlue.bold(text);
    }
    out.render(text, { render: (value) => value });
  });

  return await runOnMock(
    app,
    {
      argv: [],
      env: input.env ?? {},
      terminal: {
        columns: 80,
        rows: 24,
        streams: input.tty ? ['stdout'] : [],
        ...(input.background === undefined ? {} : { background: input.background }),
      },
    },
    input.rendering === undefined ? {} : { rendering: input.rendering },
  );
}

export { run };
