import { Application, GlobalOptions } from '@loom/core';

const mode = process.argv[2];

/** A schema is what admits a non-string default, so this one only widens the accepted shape. */
const anyValue = {
  '~standard': { validate: (value) => ({ value }), vendor: 'fixture', version: 1 },
};

const tags = ['one'];
const fields = ['a', 'b'];
const marks = ['m'];
const paths = ['a'];
const shape = { list: ['a'], nested: { key: 'value' } };

const globals = new GlobalOptions().option('tag', {
  default: tags,
  multiple: true,
  type: 'string',
});

const app = new Application('copies', { globals })
  // The schema returns the declared array itself, so only a copy keeps the next invocation clean.
  .argument('files', { default: paths, validate: anyValue, variadic: true })
  .option('field', { default: fields, multiple: true, type: 'string' })
  .option('shape', { default: shape, type: 'string', validate: anyValue })
  .option('mark', { default: marks, multiple: true, type: 'string', validate: anyValue })
  .action(({ args, options, out }) => {
    args.files.push('extra');
    options.field.push('x');
    options.mark.push('z');
    options.tag.push('y');
    return out.print(
      JSON.stringify({
        field: options.field,
        files: args.files,
        mark: options.mark,
        tag: options.tag,
      }),
    );
  });

// Authoring copied both arrays, so these later changes belong to the caller alone.
fields.push('c');
tags.push('two');

if (mode === 'runs') {
  await app.run({ host: { argv: [] } });
  await app.run({ host: { argv: [] } });
  // Two mutating invocations later, the declaration still reports the values it was written with.
  const graph = app.inspect();
  process.stdout.write(
    `${JSON.stringify({
      files: graph.root.arguments[0].default.value,
      mark: graph.root.options[2].default.value,
    })}\n`,
  );
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
