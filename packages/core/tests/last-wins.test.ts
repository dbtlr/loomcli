/*
 * Acceptance plan for a last-wins option (docs/core/options.md#last-occurrence-wins, ADR-0162).
 *
 * Every case runs an Application in process on a mock process.
 *
 * - Occurrences. A later occurrence replaces an earlier one across every accepted spelling: the
 *   long spelling with the next word or `=`, the short alias with the next word or attached, a
 *   letter that ends a short group, and an alias. A bare spelling that supplies an implied value is
 *   an occurrence like any other, and the validator prepares whichever value won.
 * - Arity. The last occurrence's whole tuple replaces the earlier one.
 * - What stays. A repeated Boolean option still fails as a repeat, and so does a string option that
 *   declares `lastWins: false`.
 * - Each occurrence is still read. A missing value or too few arity words on an earlier occurrence
 *   is still the missing-value error.
 * - The replaced value. Only the last value reaches the validator and the supplied record, so a
 *   replaced value the validator rejects fails nothing.
 * - Sources. The last occurrence beats a bound variable and a configuration value.
 * - Placement. A global last-wins option takes its last occurrence before and after the Command
 *   name, and never a word after the bare `--`.
 * - The background mark. A marked last-wins option runs with its last occurrence, and the run's
 *   background choice follows that occurrence, so a replaced `light` never settles the background
 *   when the last occurrence names neither `dark` nor `light`.
 * - Inspection. A string option's node publishes `lastWins`, `false` unless declared `true`, and a
 *   content option's node carries none. `locate` reads a later occurrence as it reads the first.
 */
import { Application, Command, extension, locate, plugin, validationContext } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

/** The options each action run read, in run order. */
const seen: unknown[] = [];

/** One run of an application on a mock process: its status, its stderr, and what the action read. */
async function run(
  application: { run: (options: { process: ReturnType<typeof mockProcess> }) => Promise<number> },
  argv: string[],
  env: Record<string, string> = {},
): Promise<{ seen: unknown[]; status: number; stderr: string }> {
  seen.length = 0;
  const mock = mockProcess({ argv, env });
  const status = await application.run({ process: mock });
  return { seen: [...seen], status, stderr: mock.stderr.text };
}

/** An application whose root reads a last-wins editor beside a Boolean `--quiet`. */
function mailer() {
  return new Application('mailer')
    .option('editor', { aliases: ['ed'], lastWins: true, short: 'e', type: 'string' })
    .option('quiet', { short: 'q', type: 'boolean' })
    .action(({ options }) => {
      seen.push(options.editor);
    });
}

test.each([
  [['--editor', 'vim', '--editor', 'nano']],
  [['--editor=vim', '-e', 'nano']],
  [['-evim', '-enano']],
  [['-e', 'vim', '-qenano']],
  [['--ed', 'vim', '--editor=nano']],
  [['--editor', 'vim', '--ed=nano']],
])('%j reads the last occurrence', async (argv) => {
  await expect(run(mailer(), argv)).resolves.toEqual({ seen: ['nano'], status: 0, stderr: '' });
});

test('a bare spelling supplies its implied value as an occurrence like any other', async () => {
  const shout = z.string().transform((value) => value.toUpperCase());
  const application = new Application('app')
    .option('backup', { implied: 'simple', lastWins: true, short: 'b', type: 'string' })
    .option('mode', { implied: 'fast', lastWins: true, type: 'string', validate: shout })
    .action(({ options }) => {
      seen.push([options.backup, options.mode]);
    });
  await expect(run(application, ['--backup=numbered', '--backup'])).resolves.toEqual({
    seen: [['simple', undefined]],
    status: 0,
    stderr: '',
  });
  await expect(run(application, ['--backup', '-b=numbered'])).resolves.toMatchObject({
    seen: [['numbered', undefined]],
  });
  // The validator prepares the value that won, whether a bare spelling or an explicit one supplied it.
  await expect(run(application, ['--mode', '--mode=slow'])).resolves.toMatchObject({
    seen: [[undefined, 'SLOW']],
  });
  await expect(run(application, ['--mode=slow', '--mode'])).resolves.toMatchObject({
    seen: [[undefined, 'FAST']],
  });
});

test("on an arity option the last occurrence's whole tuple replaces the earlier one", async () => {
  const application = new Application('app')
    .option('resize', { arity: 2, lastWins: true, short: 'r', type: 'string' })
    .action(({ options }) => {
      seen.push(options.resize);
    });
  await expect(
    run(application, ['--resize', '800', '600', '--resize', '1024', '768']),
  ).resolves.toEqual({
    seen: [['1024', '768']],
    status: 0,
    stderr: '',
  });
  await expect(run(application, ['-r', '800', '600', '--resize', '1', '2'])).resolves.toMatchObject(
    {
      seen: [['1', '2']],
    },
  );
});

test('a repeated Boolean option, and a string option with lastWins false, still fail as a repeat', async () => {
  await expect(run(mailer(), ['--quiet', '-q'])).resolves.toEqual({
    seen: [],
    status: 2,
    stderr: 'mailer: Option "-q" can be supplied only once. Remove the repeated option.\n',
  });
  const once = new Application('mailer')
    .option('editor', { lastWins: false, type: 'string' })
    .action(({ options }) => {
      seen.push(options.editor);
    });
  await expect(run(once, ['--editor', 'vim', '--editor', 'nano'])).resolves.toEqual({
    seen: [],
    status: 2,
    stderr: 'mailer: Option "--editor" can be supplied only once. Remove the repeated option.\n',
  });
});

test('a missing value on an earlier occurrence is still the missing-value error', async () => {
  const application = new Application('mailer')
    .option('editor', { lastWins: true, type: 'string' })
    .option('to', { type: 'string' })
    .option('resize', { arity: 2, lastWins: true, type: 'string' })
    .action(({ options }) => {
      seen.push(options);
    });
  await expect(run(application, ['--editor', '--to', 'x', '--editor', 'nano'])).resolves.toEqual({
    seen: [],
    status: 2,
    stderr:
      'mailer: Option "--editor" requires a value. Supply a value after "--editor", or attach one that starts with a hyphen as "--editor=<value>".\n',
  });
  await expect(run(application, ['--resize', '800', '--resize', '1024', '768'])).resolves.toEqual({
    seen: [],
    status: 2,
    stderr:
      'mailer: Option "--resize" requires 2 values, and "--resize" reads as an option. Supply 2 values after "--resize"; a value that reads as an option cannot be one of them.\n',
  });
});

test('only the last value reaches the validator, so a replaced value it rejects fails nothing', async () => {
  const calls: unknown[][] = [];
  const known: StandardSchemaV1<string, string> = {
    '~standard': {
      validate: (value, options) => {
        const context = validationContext(options);
        calls.push([
          value,
          context?.phase === 'invocation' ? context.supplied.options.editor : null,
        ]);
        return value === 'vim' || value === 'nano'
          ? { value }
          : { issues: [{ message: 'Use vim or nano.' }] };
      },
      vendor: 'probe',
      version: 1,
    },
  };
  const application = new Application('mailer')
    .option('editor', { lastWins: true, type: 'string', validate: known })
    .action(({ options }) => {
      seen.push(options.editor);
    });
  await expect(run(application, ['--editor', 'emacs', '--editor', 'nano'])).resolves.toEqual({
    seen: ['nano'],
    status: 0,
    stderr: '',
  });
  expect(calls).toEqual([['nano', 'nano']]);
});

const configKey = extension('@fixture/config/key', { schema: z.string(), target: 'option' });

/** A configuration source that holds `configured` for every option it is asked for. */
const configuration = () =>
  plugin('@fixture/config', {
    extensions: [configKey],
    source: {
      binding: configKey,
      load: () =>
        Promise.resolve({
          default: async ({ requests }) =>
            Object.fromEntries(
              requests.map(({ name }) => [
                name,
                { label: 'the fixture settings', value: 'configured' },
              ]),
            ),
        }),
    },
  });

test('the last occurrence beats a bound variable and a configuration value', async () => {
  const application = new Application('mailer', { plugins: [configuration()] })
    .option('editor', {
      env: 'MAILER_EDITOR',
      extensions: [configKey('editor')],
      lastWins: true,
      type: 'string',
    })
    .action(({ options }) => {
      seen.push(options.editor);
    });
  const argv = ['--editor', 'vim', '--editor', 'nano'];
  await expect(run(application, argv, { MAILER_EDITOR: 'emacs' })).resolves.toEqual({
    seen: ['nano'],
    status: 0,
    stderr: '',
  });
  await expect(run(application, argv)).resolves.toMatchObject({ seen: ['nano'] });
  await expect(run(application, [], { MAILER_EDITOR: 'emacs' })).resolves.toMatchObject({
    seen: ['emacs'],
  });
  await expect(run(application, [])).resolves.toMatchObject({ seen: ['configured'] });
});

test('a global last-wins option takes its last occurrence at any placement before the bare --', async () => {
  const application = new Application('mailer')
    .globalOption('editor', { lastWins: true, short: 'e', type: 'string' })
    .command(
      // A detached Command's action reads the global values untyped, so the record is pushed whole.
      new Command('draft').argument('rest', { variadic: true }).action(({ args, options }) => {
        seen.push({ ...options, rest: args.rest });
      }),
    );
  await expect(run(application, ['--editor', 'vim', 'draft', '-e', 'nano'])).resolves.toEqual({
    seen: [{ editor: 'nano', rest: [] }],
    status: 0,
    stderr: '',
  });
  await expect(
    run(application, ['-e', 'vim', 'draft', '--', '--editor', 'nano']),
  ).resolves.toMatchObject({ seen: [{ editor: 'vim', rest: ['--editor', 'nano'] }] });
});

test('the graph publishes lastWins on a string option, false unless declared true, and none on content', () => {
  const graph = new Application('app')
    .option('editor', { lastWins: true, type: 'string' })
    .option('resize', { arity: 2, lastWins: true, type: 'string' })
    .option('name', { type: 'string' })
    .option('body', { type: 'content' })
    .action(() => {})
    .inspect();
  const [editor, resize, name, body] = graph.root.options;
  const published = [editor, resize, name].map(
    (option) => option?.type === 'string' && option.lastWins,
  );
  expect(published).toEqual([true, true, false]);
  expect(body !== undefined && Object.hasOwn(body, 'lastWins')).toBe(false);
});

test('locate reads a later occurrence of a last-wins option as it reads the first', () => {
  const graph = new Application('app')
    .option('editor', { lastWins: true, short: 'e', type: 'string' })
    .option('to', { type: 'string' })
    .argument('file', {})
    .action(() => {})
    .inspect();
  const [editor] = graph.root.options;
  expect(locate(graph, ['--editor', 'vim', '--editor='])).toMatchObject({
    kind: 'value',
    option: editor,
    prefix: '',
  });
  expect(locate(graph, ['--editor', 'vim', '-e', 'na'])).toMatchObject({
    kind: 'value',
    option: editor,
    prefix: 'na',
  });
  expect(locate(graph, ['--editor', 'vim', '--editor', 'nano', 'f'])).toMatchObject({
    kind: 'argument',
    prefix: 'f',
  });
  // A scalar option without the setting still faults on its repeat.
  expect(locate(graph, ['--to', 'x', '--to='])).toEqual({ kind: 'none' });
});

test("a marked last-wins option's background choice follows the occurrence that won", async () => {
  const tones = z.enum(['dark', 'light', 'auto']);
  const application = new Application('app')
    .globalOption('background', {
      background: true,
      lastWins: true,
      type: 'string',
      validate: tones,
    })
    .action(({ host, options }) => {
      seen.push([options.background, host.terminal.background]);
    });
  const runOn = async (argv: string[]) => {
    seen.length = 0;
    const mock = mockProcess({ argv, terminal: { background: 'dark', columns: 80, rows: 24 } });
    const status = await application.run({ process: mock });
    return { seen: [...seen], status, stderr: mock.stderr.text };
  };
  await expect(runOn(['--background=dark', '--background=light'])).resolves.toEqual({
    seen: [['light', 'light']],
    status: 0,
    stderr: '',
  });
  // The replaced light decides nothing, so the stated terminal background settles the run.
  await expect(runOn(['--background=light', '--background=auto'])).resolves.toEqual({
    seen: [['auto', 'dark']],
    status: 0,
    stderr: '',
  });
  // A dangling last spelling supplies nothing and replaces nothing, so the parse fails it.
  await expect(runOn(['--background=light', '--background'])).resolves.toMatchObject({ status: 2 });
});
