import { Writable } from 'node:stream';

import { Application, Command, plugin } from '@loomcli/core';

const scenario = process.argv[2];

/** Prints one line of JSON to stdout, the fixture's report. */
function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/** A stream that keeps what a run writes, so the report reads it back as text. */
function sink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  return { stream, text: () => chunks.join('') };
}

/** A Standard Schema value that accepts a whole number and returns it as a number. */
const whole = {
  '~standard': {
    validate: (value) =>
      /^\d+$/u.test(value) ? { value: Number(value) } : { issues: [{ message: 'Use a number.' }] },
    vendor: 'fixture',
    version: 1,
  },
};

/**
 * One application whose four declarers each declare an option, marked by `control` where the
 * scenario passes `true`, beside one option that declares no mark at all.
 */
function declared(control) {
  const mark = control === undefined ? {} : { control };
  const seen = [];
  const declarer = plugin('@fixture/declarer', {
    middleware: {
      activate: ['depth'],
      load: () =>
        Promise.resolve({
          default: async ({ next, options }) => {
            seen.push(`middleware:${JSON.stringify(options?.depth)}`);
            await next();
          },
        }),
    },
    onCommandAttach: (command) =>
      command.name === 'get' ? command.option('trace', { ...mark, type: 'boolean' }) : command,
    options: { depth: { ...mark, type: 'string', validate: whole } },
  });
  const app = new Application('probe', { plugins: [declarer] })
    .globalOption('level', { ...mark, type: 'string' })
    .command(
      new Command('get')
        .option('raw', { ...mark, type: 'boolean' })
        .option('field', { type: 'string' })
        .action(({ options }) => {
          seen.push(`action:${JSON.stringify(options)}`);
        }),
    );
  return { app, seen };
}

/** The `control` fact of every option the graph publishes, by name. */
function marks(app) {
  const graph = app.inspect();
  const get = graph.root.children.find((child) => child.name === 'get');
  const options = [...graph.globals, ...(get?.options ?? [])];
  return Object.fromEntries(options.map((option) => [option.name, option.control]));
}

if (scenario === 'marks') {
  print({ marked: marks(declared(true).app), omitted: marks(declared(undefined).app) });
} else if (scenario === 'runtime') {
  // The same invocation runs through the marked and the unmarked application.
  const argv = ['get', '--raw', '--trace', '--depth', '3', '--level', 'high', '--field', 'name'];
  const outcomes = {};
  for (const [label, control] of [
    ['marked', true],
    ['unmarked', false],
  ]) {
    const { app, seen } = declared(control);
    const stderr = sink();
    const exitCode = await app.run({ host: { argv, stderr: stderr.stream } });
    const rejected = await app.run({
      host: { argv: ['get', '--depth', 'deep'], stderr: stderr.stream },
    });
    outcomes[label] = { exitCode, rejected, seen, stderr: stderr.text() };
  }
  print(outcomes);
  process.exitCode = 0;
}
