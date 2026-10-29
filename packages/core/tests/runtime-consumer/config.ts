import { Application, processHandle } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { z } from 'zod';

// The packed configuration plugin fills a bound option from a TOML, YAML, or JSON file.
// The file is the one `--config` names, or the first candidate found in the home directory.
const { plugin: configPlugin } = configuration({
  file: '.packed-config.{yaml,json}',
  schema: z.object({ greeting: z.object({ word: z.string().optional() }).optional() }),
  short: 'c',
});
const app = new Application('packed-config', { plugins: [configPlugin] })
  .option('word', {
    default: 'plain',
    extensions: [configInput({ path: 'greeting.word' })],
    type: 'string',
  })
  .action(({ options, out }) => {
    const word: string = options.word;
    return out.print(word);
  });

await app.run({ process: processHandle({ argv: process.argv.slice(2) }) });
