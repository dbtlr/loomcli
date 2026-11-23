import { Application } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { loomTheme } from '@loomcli/plugins/theme';
import { version } from '@loomcli/plugins/version';
import { z } from 'zod';

import { declareHelp } from './help-declarations.mjs';
import { runOnMock } from './in-process.ts';
import { renderingInput } from './rendering-input.js';

const inputSchema = z.object({
  app: z.looseObject({
    config: z
      .looseObject({ description: z.string().optional(), version: z.string().optional() })
      .optional(),
    name: z.string().optional(),
    postfix: z.string().optional(),
  }),
  argv: z.array(z.string()).optional(),
  columns: z.number().nullable(),
  env: z.record(z.string(), z.string()).optional(),
  rendering: renderingInput.optional(),
  themed: z.boolean().optional(),
});

/** Dynamic declarations keep their literal-name construction in JavaScript; every run is typed. */
async function run(args: string[] = []) {
  const input = inputSchema.parse(JSON.parse(args[0] ?? '{}'));
  const spec = input.app;
  const plugins: Plugin[] = [
    help(),
    version(spec.postfix === undefined ? {} : { postfix: spec.postfix }),
  ];
  if (input.themed) {
    plugins.push(loomTheme());
  }
  const { description, version: applicationVersion, ...config } = spec.config ?? {};
  const declared: unknown = declareHelp(
    new Application(spec.name ?? 'app', {
      ...config,
      plugins,
      ...(description === undefined ? {} : { description }),
      ...(applicationVersion === undefined ? {} : { version: applicationVersion }),
    }),
    spec,
  );
  if (!(declared instanceof Application)) {
    throw new Error('The fixture must declare an Application.');
  }
  return await runOnMock(
    declared,
    {
      argv: input.argv ?? ['--help'],
      env: input.env ?? {},
      platform: 'linux',
      ...(input.columns === null
        ? {}
        : { terminal: { columns: input.columns, rows: 24, streams: ['stdout'] } }),
    },
    { rendering: input.rendering ?? { color: 'never', hyperlinks: 'never', modifiers: 'never' } },
  );
}

export { run };
