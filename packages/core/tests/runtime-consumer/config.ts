import { Application } from '@loomcli/core';
import { config } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';

// The packed configuration plugin fills a bound option from a TOML, YAML, or JSON file.
// The file is the one `--config` names, or the first candidate found in the home directory.
const app = new Application('packed-config', {
  plugins: [config({ file: '.packed-config.{yaml,json}', short: 'c' })],
})
  .option('word', {
    default: 'plain',
    extensions: [configInput({ path: 'greeting.word' })],
    type: 'string',
  })
  .action(({ options, out }) => {
    const word: string = options.word;
    return out.print(word);
  });

await app.run({ host: { argv: process.argv.slice(2), release: { build: 'distributed' } } });
