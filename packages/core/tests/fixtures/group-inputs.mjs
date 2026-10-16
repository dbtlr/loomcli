import { z } from 'zod';

import { Application, Command, extension, InputError, override, plugin } from '../../dist/index.js';

const [scenario, ...argv] = process.argv.slice(2);
const binding = extension('@fixture/groups/key', { schema: z.string(), target: 'option' });
const sourceValue = scenario === 'source' ? JSON.parse(argv[0]) : undefined;
const sourceKinds = { boolean: 'boolean', number: 'count', object: 'string' };
const source = plugin('@fixture/groups', {
  extensions: [binding],
  source: {
    binding,
    load: async () => ({
      default: async () => ({ first: { label: 'fixture setting', value: sourceValue } }),
    }),
  },
});
const digits = {
  '~standard': {
    validate: (value) =>
      /^\d+$/u.test(value) ? { value } : { issues: [{ message: 'Supply digits.' }] },
    vendor: 'fixture',
    version: 1,
  },
};
const hook = plugin('@fixture/group-hook', {
  onCommandAttach: (command) =>
    command.name === null
      ? command
          .option('first', { description: 'First choice.', type: 'boolean' })
          .option('second', { description: 'Second choice.', type: 'boolean' })
          .exclusive('first', 'second')
      : command,
});
if (scenario === 'hook') {
  process.exitCode = await new Application('groups', {
    description: 'Groups probe.',
    plugins: [hook],
  })
    .action(() => {})
    .run({ host: { argv, env: {} } });
} else {
  const configured = new Application('groups', {
    description: 'Groups probe.',
    plugins: scenario === 'source' ? [source] : [],
    views:
      scenario === 'named'
        ? [override(InputError, { render: (error) => JSON.stringify(error.problems) })]
        : [],
  });
  const firstConfig =
    scenario === 'source'
      ? {
          type: sourceKinds[typeof sourceValue],
          ...(Array.isArray(sourceValue) ? { multiple: true } : {}),
          extensions: [binding('first')],
        }
      : {
          type: scenario === 'named' ? 'boolean' : 'string',
          ...(scenario === 'defaults' ? { default: 'default' } : {}),
          ...(scenario === 'env' ? { env: 'GROUP_FIRST' } : {}),
          ...(scenario === 'invalid' ? { validate: digits } : {}),
        };
  let declaration = configured
    .option('first', { description: 'First choice.', ...firstConfig })
    .option('second', {
      description: 'Second choice.',
      type: scenario === 'named' ? 'boolean' : 'string',
    });
  if (scenario === 'inspect') {
    const original = new Command('export')
      .option('first', { type: 'boolean' })
      .option('second', { type: 'boolean' });
    const grouped = original.exclusive('first', 'second');
    const facts = new Application('groups').command(grouped.action(() => {})).inspect().root
      .children[0].optionGroups;
    const originalGraph = new Application('groups').command(original.action(() => {})).inspect();
    process.stdout.write(
      JSON.stringify({
        frozen:
          Object.isFrozen(facts) && Object.isFrozen(facts[0]) && Object.isFrozen(facts[0].options),
        grouped: facts,
        original: originalGraph.root.children[0].optionGroups,
      }),
    );
  } else {
    if (scenario === 'invalid') {
      declaration = declaration
        .option('c', { description: 'Third choice.', type: 'string' })
        .exclusive('first', 'second')
        .requiredTogether('first', 'c');
    } else if (scenario === 'defaults') {
      declaration = declaration.exclusive('first', 'second').oneRequired('first', 'second');
    } else if (scenario === 'env') {
      declaration = declaration.oneRequired('first', 'second').exclusive('first', 'second');
    } else {
      declaration = declaration.exclusive('first', 'second');
    }
    const app = declaration.action(({ out }) => out.print('action'));
    if (scenario === 'named') {
      const absent = await configured
        .option('first', { description: 'First choice.', type: 'boolean' })
        .option('second', { description: 'Second choice.', type: 'boolean' })
        .oneRequired('first', 'second')
        .action(() => {})
        .invoke([], { options: { first: false } });
      const present = await app.invoke([], { options: { first: true } });
      const conflict = await app.invoke([], { options: { first: true, second: true } });
      process.stdout.write(
        JSON.stringify({
          absent: absent.exitCode,
          present: present.status === 'completed' ? 0 : present.exitCode,
          problems: conflict.failure.problems,
        }),
      );
    } else {
      process.exitCode = await app.run({
        host: {
          argv: scenario === 'source' ? ['--second', 'typed'] : argv,
          env: scenario === 'env' ? { GROUP_FIRST: 'configured' } : {},
        },
      });
    }
  }
}
