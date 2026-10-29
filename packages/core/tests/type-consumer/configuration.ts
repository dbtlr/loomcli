import { Application, Command } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { z } from 'zod';

// Every object key is optional outside an array item and a record's values.
const source = z.object({ dir: z.string().optional(), harness: z.string() });
const optional = z.object({
  minBytes: z.number().int().nonnegative().optional(),
  retries: z.number().default(3),
  sessions: z.object({ sources: z.array(source).optional() }).optional(),
});
const records = z.object({ owners: z.record(z.string(), z.object({ id: z.string() })).optional() });
const loose = z.record(z.string(), z.unknown());
const updates = z.object({ up: z.object({ channel: z.string() }).optional() });
const kinds = z.discriminatedUnion('kind', [z.object({ kind: z.literal('a') })]);

const { plugin: configPlugin, values: config } = configuration({
  directory: { name: 'project', short: 'p' },
  env: 'APP_CONFIG',
  file: '.app.{toml,json}',
  notice: true,
  schema: optional,
  short: 'c',
});
const looseConfig = configuration({ schema: loose });
const recordConfig = configuration({ schema: records });
const anyConfig = configuration({ schema: z.unknown() });

// The provider's value is the schema's output, read as provided.config.
const sources = new Command('sources', { description: 'List.', uses: [config] }).action(
  ({ provided }) => {
    const retries: number = provided.config.retries;
    const minBytes: number | undefined = provided.config.minBytes;
    const harness: string | undefined = provided.config.sessions?.sources?.[0]?.harness;
    return [retries, minBytes, harness];
  },
);
const app = new Application('app', { plugins: [configPlugin] })
  .option('min-bytes', { extensions: [configInput({ path: 'minBytes' })], type: 'string' })
  .command(sources);

// A Command that opts in fails to compile where the Application does not install the plugin.
// @ts-expect-error TS2345: The Application installs no plugin that declares --config.
const uninstalled = new Application('app').command(sources);

// A required key outside an array item or a record value is a compile error.
// @ts-expect-error TS2375: Make every key optional outside an array item or a record value.
const required = configuration({ schema: z.object({ name: z.string() }) });
// @ts-expect-error TS2375: A required key at a nested depth loses the whole table.
const nested = configuration({ schema: updates });
// @ts-expect-error TS2375: A top level that is not an object cannot accept an empty file.
const text = configuration({ schema: z.string() });
// @ts-expect-error TS2375: A loose object that requires a key fails like any other.
const looseRequired = configuration({ schema: z.looseObject({ name: z.string() }) });
// @ts-expect-error TS2375: A union at an object key is judged by each member.
const union = configuration({ schema: z.object({ mode: kinds.optional() }) });

// A directory option named config would claim the spelling --config.
// @ts-expect-error TS2322: A directory option named config would claim --config.
const claimed = configuration({ directory: { name: 'config' }, schema: optional });

// A short spelling is one ASCII letter.
// @ts-expect-error TS2322: A short spelling is one ASCII letter.
const spelled = configuration({ schema: optional, short: 'cc' });

// The schema is required.
// @ts-expect-error TS2741: configuration() needs a schema.
const schemaless = configuration({ file: '.app.json' });

export {
  anyConfig,
  app,
  claimed,
  config,
  configPlugin,
  looseConfig,
  looseRequired,
  nested,
  recordConfig,
  required,
  schemaless,
  spelled,
  text,
  uninstalled,
  union,
};
