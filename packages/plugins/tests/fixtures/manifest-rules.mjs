import { Application, Command } from '@loomcli/core';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';

/** One author value per case, each breaking one line or prose rule the manifest shares with help. */
const cases = {
  'blank-prose-line': { details: 'First line.\n\nThird line.' },
  'command-on-two-lines': { examples: [{ command: 'get a\nget b' }] },
  'note-on-two-lines': { examples: [{ command: 'get a', note: 'One.\nTwo.' }] },
  valid: { details: 'First line.\nSecond line.', examples: [{ command: 'get a', note: 'One.' }] },
};

const value = cases[process.argv[2]];

// The constructor that carries the value validates it, so a faulty value throws there.
try {
  new Application('app')
    .command(new Command('get', { extensions: [manifestCommand(value)] }).action(() => {}))
    .inspect();
  process.stdout.write(`${JSON.stringify({ fault: null })}\n`);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ fault: error.constructor.name, message: error.message })}\n`,
  );
}
