import { Application, extension, InputError, plugin } from '@loomcli/core';
import type { InputProblem } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { oneOf } from '@loomcli/validators';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

test.each(['argv', 'environment', 'name'])(
  'a failure hook reads the rejected %s value without adding it to the failure',
  async (source) => {
    const seen: unknown[] = [];
    const failures: InputError[] = [];
    const observing = plugin('fixture/received', {
      onFailure: (failure, context) => {
        if (failure instanceof InputError) {
          failures.push(failure);
          for (const problem of failure.problems) {
            seen.push(context.received(problem));
          }
        }
      },
    });
    const app = new Application('kit', { plugins: [observing] })
      .option('format', { env: 'KIT_FORMAT', type: 'string', validate: oneOf(['json', 'yaml']) })
      .action(() => undefined);
    const mock = mockProcess({
      argv: source === 'argv' ? ['--format', 'jsno'] : [],
      env: source === 'environment' ? { KIT_FORMAT: 'jsno' } : {},
    });
    await (source === 'name'
      ? app.invoke([], { options: { format: 'jsno' } }, { process: mock })
      : app.run({ process: mock }));
    expect(seen).toEqual(['jsno']);
    expect(failures).toHaveLength(1);
    for (const failure of failures) {
      expect(Object.keys(failure).toSorted()).toEqual(['name', 'problems']);
      for (const problem of failure.problems) {
        expect(Object.keys(problem).toSorted()).toEqual(['input', 'issues', 'reason', 'spelling']);
      }
      expect(JSON.stringify(failure)).not.toContain('jsno');
    }
    expect(mock.stderr.text).not.toContain('jsno');
  },
);

test('missing and group problems have no received value', async () => {
  const seen: unknown[] = [];
  const observing = plugin('fixture/received', {
    onFailure: (failure, context) => {
      if (failure instanceof InputError) {
        for (const problem of failure.problems) {
          seen.push(context.received(problem));
        }
      }
    },
  });
  const app = new Application('kit', { plugins: [observing] })
    .option('format', { required: true, type: 'string' })
    .option('json', { type: 'boolean' })
    .option('yaml', { type: 'boolean' })
    .exclusive('json', 'yaml')
    .action(() => undefined);
  await app.run({ process: mockProcess({ argv: ['--json', '--yaml'] }) });
  expect(seen).toEqual([undefined, undefined]);
});

test('the reader returns a strict configuration fill and no value for another failure problem', async () => {
  const binding = extension('fixture/config-key', { schema: z.string(), target: 'option' });
  const seen: unknown[] = [];
  const config = plugin('fixture/config', {
    extensions: [binding],
    source: {
      binding,
      load: async () => ({
        default: async () => ({ format: { label: 'settings.json', strict: true, value: 'jsno' } }),
      }),
    },
  });
  const observing = plugin('fixture/received', {
    onFailure: (failure, { received }) => {
      if (failure instanceof InputError) {
        seen.push(...failure.problems.map(received));
        seen.push(
          received({
            input: { global: false, kind: 'option', name: 'format' },
            issues: [{ message: 'Expected a format.' }],
            reason: 'invalid',
            spelling: '--format',
          }),
        );
      }
    },
  });
  const mock = mockProcess();
  await new Application('kit', { plugins: [config, observing] })
    .option('format', {
      extensions: [binding('format')],
      type: 'string',
      validate: oneOf(['json', 'yaml']),
    })
    .action(() => undefined)
    .run({ process: mock });
  expect(seen).toEqual(['jsno', undefined]);
  expect(mock.stderr.text).not.toContain('jsno');
});

test('the reader excludes a stored problem from an earlier failure and a current missing problem', async () => {
  let earlier: InputProblem | undefined = undefined;
  const failures: InputError[] = [];
  const seen: unknown[] = [];
  const observing = plugin('fixture/received', {
    onFailure: (failure, { received }) => {
      if (failure instanceof InputError) {
        const invalid = failure.problems.find((problem) => problem.reason === 'invalid');
        const missing = failure.problems.find((problem) => problem.reason === 'missing');
        failures.push(failure);
        if (invalid === undefined || missing === undefined) {
          throw new Error('Expected invalid and missing input problems.');
        }
        seen.push(received(invalid), received(missing));
        if (earlier !== undefined) {
          seen.push(received(earlier));
        }
        earlier = invalid;
      }
    },
  });
  const app = new Application('kit', { plugins: [observing] })
    .option('required', { required: true, type: 'string' })
    .option('format', { type: 'string', validate: oneOf(['json', 'yaml']) })
    .action(() => undefined);
  await app.run({ process: mockProcess({ argv: ['--format', 'jsno'] }) });
  await app.run({ process: mockProcess({ argv: ['--format', 'yalm'] }) });
  expect(failures).toHaveLength(2);
  expect(failures[0]).not.toBe(failures[1]);
  expect(seen).toEqual(['jsno', undefined, 'yalm', undefined, undefined]);
});
