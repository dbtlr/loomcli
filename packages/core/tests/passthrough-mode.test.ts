import { Application, Command, locate } from '@loomcli/core';
import { expect, test } from 'vite-plus/test';

import { invoke } from './run-fixture.ts';

test('the delimiter makes hyphen words arguments by default', async () => {
  const result = await invoke(new URL('fixtures/passthrough-mode.mjs', import.meta.url), [
    '--',
    '-draft.txt',
  ]);
  expect(result).toMatchObject({ status: 0, stdout: '{"path":"-draft.txt"}\n' });
});

test('a named tail requires the mode, but an empty list is harmless', async () => {
  const app = new Application('kit').action(() => {});
  await expect(app.invoke([], { passthrough: ['tail'] })).resolves.toMatchObject({
    exitCode: 2,
    failure: {
      extra: ['tail'],
      message: 'Root Command declares no passthrough. Remove passthrough from the values.',
      name: 'UnexpectedArgumentError',
    },
    status: 'failed',
  });
  await expect(app.invoke([], { passthrough: [] })).resolves.toMatchObject({ status: 'completed' });
});

test('the cursor after the delimiter fills the next argument', () => {
  const graph = new Application('rm')
    .argument('path', {})
    .action(() => {})
    .inspect();
  expect(locate(graph, ['--', ''])).toMatchObject({ argument: { name: 'path' }, kind: 'argument' });
});

test('required trailing arguments fill from the end before a variadic', async () => {
  const app = new Application('copy')
    .argument('src', { required: true, variadic: true })
    .argument('dest', { required: true })
    .action(({ args, out }) => out.print(JSON.stringify(args)));
  await expect(app.invoke([], { args: { dest: 'dest', src: ['a', 'b'] } })).resolves.toMatchObject({
    output: '{"src":["a","b"],"dest":"dest"}\n',
    status: 'completed',
  });
});

test('the mode preserves a second delimiter and never fills arguments', async () => {
  const app = new Application('wrapper')
    .passthrough({ description: 'Forward words.' })
    .action(({ passthrough, out }) => out.print(JSON.stringify(passthrough)));
  expect(app.inspect().root.passthrough).toEqual({ description: 'Forward words.' });
  await expect(app.invoke([], { passthrough: ['--', '-x'] })).resolves.toMatchObject({
    output: '["--","-x"]\n',
    status: 'completed',
  });
  expect(locate(app.inspect(), ['--', ''])).toMatchObject({ kind: 'passthrough' });
});

test.each([
  [{}, 'is optional'],
  [{ variadic: true }, 'is variadic'],
  [{ required: 'non-interactive' }, 'is required only when input is not interactive'],
  [{ type: 'content' }, 'is a content argument'],
] as const)('an invalid argument after a variadic explains why: %s', (config, reason) => {
  expect(() =>
    new Command('copy').argument('src', { variadic: true }).argument('dest', config),
  ).toThrow(`Argument "dest" ${reason} and follows variadic argument "src" on Command "copy".`);
});

test.each([false, 'non-interactive'] as const)(
  'a variadic with presence %s permits a required destination',
  (required) => {
    const app = new Application('mv')
      .argument(
        'src',
        required === false
          ? { required: false, variadic: true }
          : { required: 'non-interactive', variadic: true },
      )
      .argument('dest', { required: true })
      .action(() => {});
    for (const words of [[], ['a']]) {
      expect(locate(app.inspect(), words)).toMatchObject({
        argument: { name: 'src' },
        kind: 'argument',
      });
    }
  },
);

const leaf = () => new Command('leaf').action(() => {});

test('a group cannot declare passthrough, at attach or root build', () => {
  expect(() =>
    new Application('app').command(new Command('group').passthrough().command(leaf())),
  ).toThrow('@loomcli/core/command-without-action');
  expect(() => new Application('app').passthrough().command(leaf()).inspect()).toThrow(
    '@loomcli/core/command-without-action',
  );
});

test.each([
  [['copy', 'a', 'b', 'dest'], '{"src":["a","b"],"dest":"dest"}\n'],
  [['copy', 'a', '--', 'b', 'dest'], '{"src":["a","b"],"dest":"dest"}\n'],
  [['copy', 'a', '--', '--', 'dest'], '{"src":["a","--"],"dest":"dest"}\n'],
])('argv fills trailing arguments before the variadic: %s', async (words, output) => {
  await expect(
    invoke(new URL('fixtures/passthrough-mode.mjs', import.meta.url), words),
  ).resolves.toMatchObject({ status: 0, stdout: output });
});

test('too few words fill the destination and report the missing source', async () => {
  const result = await invoke(new URL('fixtures/passthrough-mode.mjs', import.meta.url), [
    'copy',
    'a',
  ]);
  expect(result).toMatchObject({ status: 2 });
  expect(result.stderr).toContain('Argument "src" requires at least one value');
  expect(result.stderr).not.toContain('Argument "dest" requires a value');
});

test('an extra tail and a group tail are structural failures', async () => {
  const file = new URL('fixtures/passthrough-mode.mjs', import.meta.url);
  await expect(invoke(file, ['one', '--', 'two'])).resolves.toMatchObject({ status: 2 });
  const group = await invoke(file, ['group', '--', 'leaf']);
  expect(group).toMatchObject({ status: 2 });
  expect(group.stderr).toContain('accepts no arguments');
  expect(group.stderr).not.toContain('requires a subcommand');
});

test('unknown option corrections follow the argument mode', async () => {
  const file = new URL('fixtures/passthrough-mode.mjs', import.meta.url);
  const plain = await invoke(file, ['-draft.txt']);
  const forwarding = await invoke(file, ['wrapper', '-draft.txt']);
  expect(plain.stderr).toContain('Supply a declared option, or pass it as an argument after "--".');
  expect(forwarding.stderr).toContain(
    'Supply a declared option; prefix a hyphenated path with "./".',
  );
});

test('an argv passthrough tail stays untouched, including later delimiters', async () => {
  await expect(
    invoke(new URL('fixtures/passthrough-mode.mjs', import.meta.url), [
      'wrapper',
      '--',
      '-x',
      '--',
    ]),
  ).resolves.toMatchObject({ status: 0, stdout: '["-x","--"]\n' });
});

test('named passthrough ranks after unknown option and argument names', async () => {
  const app = new Application('app').command(new Command('get').action(() => {}));
  await expect(
    app.invoke(['get'], { options: { unknown: true }, passthrough: ['tail'] }),
  ).resolves.toMatchObject({ failure: { name: 'UnknownOptionError' }, status: 'failed' });
  await expect(
    app.invoke(['get'], { args: { unknown: 'x' }, passthrough: ['tail'] }),
  ).resolves.toMatchObject({
    failure: { extra: ['unknown'], name: 'UnexpectedArgumentError' },
    status: 'failed',
  });
  await expect(app.invoke(['get'], { passthrough: ['tail'] })).resolves.toMatchObject({
    failure: {
      message: 'Command "get" declares no passthrough. Remove passthrough from the values.',
    },
    status: 'failed',
  });
});

test('the mode is local to the Command and mode-off action contexts omit its member', async () => {
  const app = new Application('app')
    .passthrough()
    .command(
      new Command('child').action((context) => {
        expect(context).not.toHaveProperty('passthrough');
      }),
    )
    .action(() => {});
  await expect(app.invoke(['child'], {})).resolves.toMatchObject({ status: 'completed' });
  await expect(app.invoke(['child'], { passthrough: ['x'] })).resolves.toMatchObject({
    exitCode: 2,
    status: 'failed',
  });
});
