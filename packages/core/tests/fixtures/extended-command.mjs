import { Application, Command, extension, readExtension } from '@loomcli/core';
import { z } from 'zod';

import { ruleText } from './rule-text.mjs';

const examples = z.array(z.string()).optional();
const help = extension('test/help', {
  schema: z.object({ details: z.string(), examples }),
  target: 'command',
});
const other = extension('test/other', { schema: z.string(), target: 'command' });
const original = new Command('read', {
  description: 'Reads a value.',
  extensions: [help({ details: 'Library help.', examples: ['library'] }), other('retained')],
})
  .alias('r')
  .argument('path', { required: true })
  .option('raw', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(JSON.stringify({ args, options })));
const enriched = original.extend(help({ details: 'Application help.' }));

const app = new Application('example')
  .globalOption('quiet', { type: 'boolean' })
  .command(enriched)
  .extend(other('root'));
const mode = process.argv[2];
if (mode === 'invoke') {
  await app.run({
    host: { argv: ['r', 'document', '--raw', '--quiet'] },
  });
} else if (mode === 'inspect') {
  const before = new Application('library').command(original).inspect().root.children[0];
  const graph = app.inspect();
  const after = graph.root.children[0];
  const helpValue = readExtension(after, help);
  process.stdout.write(
    `${JSON.stringify({
      after: readExtension(after, help),
      aliases: after.aliases,
      before: readExtension(before, help),
      cloned: original !== enriched && original !== original.extend(),
      description: after.description,
      frozen: Object.isFrozen(after.extensions) && Object.isFrozen(helpValue),
      identities: Object.keys(after.extensions),
      other: readExtension(after, other),
      root: readExtension(graph.root, other),
    })}\n`,
  );
} else if (mode === 'duplicate') {
  // A second value of one extension in one call replaces the first whole.
  const twice = original.extend(
    help({ details: 'One.', examples: ['one'] }),
    help({ details: 'Two.' }),
  );
  const node = new Application('twice').command(twice).inspect().root.children[0];
  process.stdout.write(`${JSON.stringify(readExtension(node, help))}\n`);
} else {
  const scenarios = {
    invalid: () => original.extend(help({ details: 1 })).extend(help({ details: 'Valid.' })),
    twin: () =>
      original.extend(extension('test/help', { schema: z.string(), target: 'command' })('Twin.')),
  };
  try {
    new Application('invalid').command(scenarios[mode]()).inspect();
    process.stdout.write('unexpected success\n');
  } catch (error) {
    process.stdout.write(`${ruleText(error)}\n`);
  }
}
