import { Application, DeclarationError, missingInputError } from '@loomcli/core';
/*
 * Acceptance plan for interaction (docs/core/interaction.md#interaction).
 *
 * - The decision. With stdin and stderr terminals and no mark, `interactive` is `true`. It is
 *   `false` with stdin piped, with stderr redirected, under `--no-input` from the interaction
 *   plugin, under its bound variable set to `false`, from the configuration source, under
 *   `app.invoke`, under an action's `invoke`, and in an MCP tool call. A piped stdout leaves it
 *   `true`, and a marked option that reads `true` with stdin piped leaves it `false`. With stdin and
 *   stderr terminals, `CI` set to `true` makes it `false`, while `CI` empty or `false` leaves it
 *   `true`, and under `CI=true` an omitted `required: 'non-interactive'` option fails with exit 2.
 * - Conditional requiredness. With interaction off, an omitted `required: 'non-interactive'` option
 *   fails with exit 2 before the action and the sentence the reference states, beside any other
 *   input problem in authoring order, by declared name under `invoke` and in an MCP tool call, and
 *   a supplied one validates and reaches the action. With interaction on, the omitted option
 *   reaches the action as `undefined`. Each declaration error the reference lists throws from its
 *   call, and help, the manifest, and the MCP schema print the facts the reference states.
 * - `supplied` and `missingInputError`. `supplied` matches the validation context's record for
 *   argv, environment, configuration, and by-name values, holds `undefined` for a defaulted option,
 *   and rejects writes at every depth. `missingInputError` builds both sentences by spelling and by
 *   name, and rejects a global option and an undeclared name.
 *
 * Acceptance plan for the interaction plugin (docs/plugins/interaction.md#interaction-plugin).
 *
 * - `mimir --help` lists `--no-input` with its description among the global options, the manifest
 *   marks it `control` and `interaction`, and `mimir setup --no-input` with stdin and stderr
 *   terminals runs with `interactive` false.
 * - A variable the plugin binds turns interaction off with `false`, and two options that each carry
 *   the interaction mark fail with the two-marks error. A plugin option's Boolean variable reads
 *   core's grammar, proven under Input sources acceptance.
 */
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

/** The terminal width and the text that each draw scenario wraps against. */
const whole = { columns: 4, text: 'abcdef\n界界\n' };

const drawn = {
  carriage: { columns: 4, text: 'abc\rdef' },
  tab: { columns: 10, text: 'ab\tXXX\n' },
  wide: { columns: 3, text: '界界界\n' },
};

/** One run that draws the scenario's text between two lines on a mock whose stderr is a terminal. */
async function draw(scenario?: keyof typeof drawn) {
  const { columns, text } = scenario === undefined ? whole : drawn[scenario];
  let rows = 0;
  const mock = mockProcess({ terminal: { columns, rows: 24, streams: ['stderr'] } });
  const app = new Application('draw', { description: 'Draw terminal output.' }).action(
    async ({ out }) => {
      const first = out.info('before');
      rows = await out.draw(text, { render: (value) => `\u001b[?25l${value}\u001b[?25h` });
      await out.info('after');
      await first;
    },
  );
  const code = await app.run({ process: mock });
  return { code, rows, text: mock.stderr.text };
}

test('conditional requiredness rejects missing input before dispatch without interaction', async () => {
  const result = await invokeFixture(new URL('fixtures/interaction.mjs', import.meta.url));
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(
    'Option "--port" is required when input is not interactive. Supply a value.',
  );
});

test.each([
  { env: { CI: 'true' }, interactive: false },
  { env: { CI: '' }, interactive: true },
  { env: { CI: 'false' }, interactive: true },
])(
  'with stdin and stderr terminals and $env, interactive reads $interactive',
  async ({ env, interactive }) => {
    const seen: boolean[] = [];
    const app = new Application('setup').action(({ interactive: decided }) => {
      seen.push(decided);
    });
    const mock = mockProcess({ env, terminal: { columns: 80, keys: [], rows: 24 } });
    await expect(app.run({ process: mock })).resolves.toBe(0);
    expect(seen).toEqual([interactive]);
  },
);

test("under CI=true an omitted required: 'non-interactive' option fails before the action with exit 2", async () => {
  const app = new Application('setup')
    .option('port', { description: 'Service port.', required: 'non-interactive', type: 'string' })
    .action(() => {
      throw new Error('The action must not run.');
    });
  const mock = mockProcess({ env: { CI: 'true' }, terminal: { columns: 80, keys: [], rows: 24 } });
  await expect(app.run({ process: mock })).resolves.toBe(2);
  expect(mock.stderr.text).toContain(
    'Option "--port" is required when input is not interactive. Supply a value.',
  );
});

test('actions see the raw supplied value beside the validated value', async () => {
  const result = await invokeFixture(new URL('fixtures/interaction.mjs', import.meta.url), [
    '--port',
    '8080',
  ]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({ interactive: false, port: 8080, raw: '8080' });
});

test.each([
  ['terminal', { interactive: true }],
  ['disabled', { interactive: false }],
  ['env', { interactive: false }],
  ['invoke', { interactive: false }],
])(
  'the run interaction decision honors capabilities and intent: %s',
  async (scenario, expected) => {
    const result = await invokeFixture(
      new URL('fixtures/interaction-policy.mjs', import.meta.url),
      [scenario],
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual(expected);
  },
);

test('action cancellation is silent and resolves the normal cancellation status', async () => {
  const result = await invokeFixture(new URL('fixtures/interaction-policy.mjs', import.meta.url), [
    'cancel',
  ]);
  expect(result.status).toBe(130);
  expect(result.stderr).toBe('');
});

test('two interaction marks fail at declaration, naming each option as its own site does', async () => {
  const result = await invokeFixture(new URL('fixtures/interaction-policy.mjs', import.meta.url), [
    'twice',
  ]);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ name: 'DeclarationError' });
  expect(JSON.parse(result.stdout).message).toContain(
    'Global option "input" and global option "other" both declare interaction.',
  );
});

test('draw preserves controls only on terminal stderr, reports wrapped rows, and keeps write order', async () => {
  await expect(draw()).resolves.toEqual({
    code: 0,
    rows: 3,
    text: 'ℹ before\n\u001b[?25labcdef\n界界\n\u001b[?25hℹ after\n',
  });
});

test('help and manifest preserve required as Boolean and publish conditional requiredness', async () => {
  const fixture = new URL('fixtures/interaction-projection.mjs', import.meta.url);
  const help = await invokeFixture(fixture, ['--help']);
  expect(help.status).toBe(0);
  expect(help.stdout).toContain('required when not interactive');
  expect(help.stdout).toContain('setup [options]');
  const printed = await invokeFixture(fixture, ['--manifest']);
  expect(printed.status).toBe(0);
  expect(JSON.parse(printed.stdout)).toMatchObject({
    command: { options: [{ name: 'port', required: false, requiredWhen: 'non-interactive' }] },
    globals: expect.arrayContaining([
      expect.objectContaining({ interaction: true, name: 'input' }),
    ]),
  });
});

test('draw counts wide graphemes that cannot fit the final cell of a terminal row', async () => {
  await expect(draw('wide')).resolves.toMatchObject({ code: 0, rows: 3 });
});

test('an unawaited draw failure stays in the ordinary run failure path', async () => {
  const result = await invokeFixture(new URL('fixtures/unawaited-draw.mjs', import.meta.url));
  expect(result).toEqual({
    status: 1,
    stderr: 'draw: Something went wrong.\n',
    stdout: 'CODE:1\n',
  });
});

test('draw measures tab stops before counting terminal wrapping', async () => {
  await expect(draw('tab')).resolves.toMatchObject({ code: 0, rows: 2 });
});

test('view plain text strips styles and controls while retaining destination glyph forms', async () => {
  const result = await invokeFixture(new URL('fixtures/view-context.mjs', import.meta.url));
  expect(result).toEqual({ status: 0, stderr: '', stdout: '{"cells":6,"plain":"Name >"}\n' });
});

test('draw resets its column at a standalone carriage return', async () => {
  await expect(draw('carriage')).resolves.toMatchObject({ code: 0, rows: 0 });
});

test('conditional arguments and collected options require input only off a terminal', async () => {
  const seen: unknown[] = [];
  const app = new Application('clone')
    .argument('url', { required: 'non-interactive' })
    .option('tag', { multiple: true, required: 'non-interactive', type: 'string' })
    .action(({ args, options, supplied }) => {
      seen.push({ args, options, supplied });
    });
  const terminal = mockProcess({ terminal: { columns: 80, keys: [], rows: 24 } });
  await expect(app.run({ process: terminal })).resolves.toBe(0);
  expect(seen).toEqual([
    {
      args: { url: undefined },
      options: { tag: [] },
      supplied: { args: { url: undefined }, options: { tag: [] } },
    },
  ]);
  const batch = mockProcess();
  await expect(app.run({ process: batch })).resolves.toBe(2);
  expect(batch.stderr.text).toContain(
    'Argument "url" requires a value when input is not interactive. Supply a value for "url".',
  );
  expect(batch.stderr.text).toContain(
    'Option "--tag" is required when input is not interactive. Supply at least one value.',
  );
  expect(app.inspect().root.arguments[0]).toMatchObject({
    required: false,
    requiredWhen: 'non-interactive',
  });
});

test('an unconditional argument cannot follow a conditional argument', () => {
  expect(() =>
    new Application('clone')
      .argument('url', { required: 'non-interactive' })
      .argument('dir', { required: true }),
  ).toThrow(
    'Argument "url" is required only when input is not interactive and precedes required argument "dir" on the root Command.',
  );
});

test('a content argument that needs a source cannot follow a conditional argument', () => {
  expect(() =>
    new Application('lint')
      .argument('profile', { required: 'non-interactive' })
      .argument('files', { min: 1, type: 'content', variadic: true }),
  ).toThrow(
    'Argument "profile" is required only when input is not interactive and precedes required argument "files" on the root Command.',
  );
  expect(() =>
    new Application('lint')
      .argument('profile', { required: 'non-interactive' })
      .argument('files', { type: 'content', variadic: true }),
  ).not.toThrow();
});

test('an optional argument cannot precede a content argument that needs a source', () => {
  expect(() =>
    new Application('lint')
      .argument('profile', {})
      .argument('files', { min: 1, type: 'content', variadic: true }),
  ).toThrow(
    'Argument "profile" is optional and precedes required argument "files" on the root Command.',
  );
});

test.each([{}, { min: 0 }])(
  'an optional argument may precede a content argument that needs no source (%j)',
  (min) => {
    expect(() =>
      new Application('lint')
        .argument('profile', {})
        .argument('files', { ...min, type: 'content', variadic: true }),
    ).not.toThrow();
  },
);

test('a conditional variadic argument is an empty list at a terminal and missing by name', async () => {
  const seen: unknown[] = [];
  const app = new Application('copy')
    .argument('files', { required: 'non-interactive', variadic: true })
    .action(({ args, supplied }) => {
      seen.push({ args, supplied });
    });
  await expect(
    app.run({ process: mockProcess({ terminal: { columns: 80, keys: [], rows: 24 } }) }),
  ).resolves.toBe(0);
  expect(seen).toEqual([{ args: { files: [] }, supplied: { args: { files: [] }, options: {} } }]);
  const result = await app.invoke([], {}, { process: mockProcess() });
  expect(result).toMatchObject({ exitCode: 2, status: 'failed' });
});

test('missingInputError identifies an argument even beside an option with the same name', async () => {
  const app = new Application('clone')
    .argument('url', {})
    .option('url', { type: 'string' })
    .action((context) => {
      throw missingInputError(context, { argument: 'url' });
    });
  const mock = mockProcess();
  await expect(app.run({ process: mock })).resolves.toBe(2);
  expect(mock.stderr.text).toContain(
    'Argument "url" requires a value when input is not interactive. Supply a value for "url".',
  );
});

test('an optional argument cannot precede an argument required only off a terminal', () => {
  let thrown: unknown = undefined;
  try {
    new Application('clone').argument('a', {}).argument('b', { required: 'non-interactive' });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DeclarationError);
  expect(thrown).toMatchObject({
    correction: 'Declare optional arguments after required ones.',
    sentence: 'Argument "a" is optional and precedes required argument "b" on the root Command.',
  });
});

test.each([
  [{ multiple: true, type: 'string' } as const, 'Supply at least one value.'],
  [{ multiple: true, type: 'content' } as const, 'Supply a value.'],
])('missingInputError for a %j option reads %j', async (config, fix) => {
  const app = new Application('clone').option('tag', config).action((context) => {
    throw missingInputError(context, 'tag');
  });
  const mock = mockProcess();
  await expect(app.run({ process: mock })).resolves.toBe(2);
  expect(mock.stderr.text).toBe(
    `clone: Option "--tag" is required when input is not interactive. ${fix}\n`,
  );
});

test('missingInputError for a variadic argument asks for at least one value', async () => {
  const app = new Application('copy').argument('files', { variadic: true }).action((context) => {
    throw missingInputError(context, { argument: 'files' });
  });
  const mock = mockProcess();
  await expect(app.run({ process: mock })).resolves.toBe(2);
  expect(mock.stderr.text).toBe(
    'copy: Argument "files" requires at least one value when input is not interactive. Supply a value for "files".\n',
  );
});
