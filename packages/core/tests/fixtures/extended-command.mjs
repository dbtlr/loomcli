import { Application, Command, extension, GlobalOptions, readExtension } from '@loomcli/core';
import { z } from 'zod';

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
const globals = new GlobalOptions().option('quiet', { type: 'boolean' });
const app = new Application('example', { globals }).command(enriched).extend(other('root'));
const mode = process.argv[2];
if (mode === 'invoke') {
  await app.run({ host: { argv: ['r', 'document', '--raw', '--quiet'] } });
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
} else {
  const scenarios = {
    duplicate: () => original.extend(help({ details: 'One.' }), help({ details: 'Two.' })),
    invalid: () => original.extend(help({ details: 1 })).extend(help({ details: 'Valid.' })),
    late: () => enriched.option('extra', { type: 'boolean' }),
    target: () =>
      original.extend(extension('test/input', { schema: z.string(), target: 'option' })('Wrong.')),
    twin: () =>
      original.extend(extension('test/help', { schema: z.string(), target: 'command' })('Twin.')),
  };
  try {
    new Application('invalid').command(scenarios[mode]()).inspect();
    process.stdout.write('unexpected success\n');
  } catch (error) {
    process.stdout.write(`${error.message}\n`);
  }
}
