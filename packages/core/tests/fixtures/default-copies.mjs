import { Application, GlobalOptions } from '@loom/core';

const mode = process.argv[2];

/** A schema is what admits a non-string default, so this one only widens the accepted shape. */
const anyValue = {
  '~standard': { validate: (value) => ({ value }), vendor: 'fixture', version: 1 },
};

const tags = ['one'];
const fields = ['a', 'b'];
const shape = { list: ['a'], nested: { key: 'value' } };

const globals = new GlobalOptions().option('tag', {
  default: tags,
  multiple: true,
  type: 'string',
});

const app = new Application('copies', globals)
  .option('field', { default: fields, multiple: true, type: 'string' })
  .option('shape', { default: shape, type: 'string', validate: anyValue })
  .action(({ options, out }) => {
    options.field.push('x');
    options.tag.push('y');
    return out.print(JSON.stringify({ field: options.field, tag: options.tag }));
  });

// Authoring copied both arrays, so these later changes belong to the caller alone.
fields.push('c');
tags.push('two');

if (mode === 'runs') {
  await app.run({ host: { argv: [] } });
  await app.run({ host: { argv: [] } });
} else {
  const graph = app.inspect();
  const attempts = [];
  const record = (label, change) => {
    try {
      change();
      attempts.push({ label, rejected: false });
    } catch (error) {
      attempts.push({ label, rejected: error instanceof TypeError });
    }
  };
  record('global', () => graph.globals[0].default.value.push('mutated'));
  record('array', () => graph.root.options[0].default.value.push('mutated'));
  record('member', () => graph.root.options[1].default.value.list.push('mutated'));
  record('nested', () => {
    graph.root.options[1].default.value.nested.key = 'mutated';
  });
  const again = app.inspect();
  process.stdout.write(
    `${JSON.stringify({
      again: {
        field: again.root.options[0].default.value,
        shape: again.root.options[1].default.value,
        tag: again.globals[0].default.value,
      },
      attempts,
    })}\n`,
  );
}
