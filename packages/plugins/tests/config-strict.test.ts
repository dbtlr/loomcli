import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, Command, DeclarationError, InputError, plugin } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import type { ConfigurationSettings } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { mockProcess } from '@loomcli/testing';
import { url } from '@loomcli/validators';
import { number, object, optional, string } from 'valibot';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import type { Settings } from './fixtures/config-run.ts';
import { settingsFault } from './fixtures/config-settings.ts';

/**
 * The `strict` setting under "The strict setting" in the plugin's reference: what fails the run
 * and what drops as before, through the provider and through linked options.
 */

/** A verbose mark, spelled -L, so a run can show its `-v` lines. */
const loud = plugin('fixture/loud', {
  options: {
    loud: {
      control: true,
      description: 'Show more detail.',
      short: 'L',
      type: 'count',
      verbose: true,
    },
  },
});

const closed = z.object({
  delivery: z
    .object({
      retries: z.number().int().optional(),
      webhook: z.string().optional(),
    })
    .optional(),
  flag: z.unknown().optional(),
  sessions: z.object({ sources: z.array(z.object({ harness: z.string() })).optional() }).optional(),
  stateDir: z.string().optional(),
});

type Strict = ConfigurationSettings<typeof closed>['strict'];

/** What one run came to. */
interface Ran {
  readonly status: number | undefined;
  readonly stderr: string;
  readonly stdout: string;
}

/** The pieces of one run a case varies: the schema, the file, the setting, and the arguments. */
interface Case {
  readonly schema?: StandardSchemaV1 | undefined;
  readonly file: unknown;
  readonly strict?: Strict | undefined;
  readonly argv?: readonly string[];
  /** Reads the provider in the action, so the run needs no linked option to read the file. */
  readonly provided?: boolean;
}

/** An application that reads `.app.json`, links three options, and prints what its action read. */
function build(settings: Pick<Case, 'schema' | 'strict'>, provided: boolean) {
  const config = configuration({
    file: '.app.json',
    schema: settings.schema ?? closed,
    ...(settings.strict === undefined ? {} : { strict: settings.strict }),
  });
  return new Application('app', {
    plugins: [config.plugin, loud],
    ...(provided ? { uses: [config.values] } : {}),
  })
    .option('webhook', {
      extensions: [configInput({ path: 'delivery.webhook' })],
      type: 'string',
      validate: url({ protocols: ['https'] }),
    })
    .option('flag', { extensions: [configInput({ path: 'flag' })], type: 'boolean' })
    .option('state', { extensions: [configInput({ path: 'stateDir' })], type: 'string' })
    .action(({ options, out }) => out.print(JSON.stringify(options)));
}

/** Runs the application over a file written as `file`, in a temporary directory. */
async function ran({ argv = [], file, provided = false, schema, strict }: Case): Promise<Ran> {
  const root = mkdtempSync(join(tmpdir(), 'loom-strict-'));
  try {
    writeFileSync(join(root, '.app.json'), JSON.stringify(file));
    const mock = mockProcess({ argv, cwd: root, env: { HOME: root } });
    await build({ schema, strict }, provided).run({ process: mock });
    return { status: mock.exitCode, stderr: mock.stderr.text, stdout: mock.stdout.text };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

const retriesLine =
  'app: Configuration value delivery.retries in .app.json: Invalid input: expected number, received string. Correct the value, or remove it.\n';
const webhokLine =
  'app: Unknown key delivery.webhok in .app.json. Check its spelling, or remove it.\n';
const stateLine = 'app: Unknown key state_dir in .app.json. Check its spelling, or remove it.\n';

test('a value the schema rejects fails the run with code 2 under strict: true', async () => {
  const result = await ran({ file: { delivery: { retries: 'three' } }, strict: true });
  expect(result).toEqual({ status: 2, stderr: retriesLine, stdout: '' });
});

test('without strict the same value drops, the run succeeds, and -v names it as before', async () => {
  const file = { delivery: { retries: 'three' }, state_dir: 'x' };
  const quiet = await ran({ file });
  expect(quiet).toMatchObject({ status: 0, stderr: '' });
  const verbose = await ran({ argv: ['-L'], file });
  expect(verbose.status).toBe(0);
  expect(verbose.stderr).toBe(
    '› Ignored delivery.retries in .app.json: Invalid input: expected number, received string\n› Ignored state_dir in .app.json: Unknown key. Check its spelling, or remove it.\n',
  );
  // False and an unset setting are the same as none.
  await expect(ran({ argv: ['-L'], file, strict: false })).resolves.toEqual(verbose);
});

test('a listed path fails only for a value at or under it, and drops the rest', async () => {
  const strict: Strict = ['delivery'];
  const inside = await ran({ file: { delivery: { retries: 'three' } }, strict });
  expect(inside).toMatchObject({ status: 2, stderr: retriesLine });
  const outside = await ran({
    argv: ['-L'],
    file: { sessions: { sources: [{ harness: 1 }] } },
    strict,
  });
  expect(outside.status).toBe(0);
  expect(outside.stderr).toBe(
    '› Ignored sessions.sources[0] in .app.json: Invalid input: expected string, received number\n',
  );
  // A value that holds a listed path is not under it, so the section's own type drops.
  const holder = await ran({ file: { delivery: 5 }, strict: ['delivery.retries'] });
  expect(holder.status).toBe(0);
});

test('a path that is not a prefix by whole keys covers nothing', async () => {
  const schema = closed.extend({ deliveryMode: z.number().optional() });
  const result = await ran({ file: { deliveryMode: 'x' }, schema, strict: ['delivery'] });
  expect(result.status).toBe(0);
});

test('an unknown key fails the run at or under a listed path and is named at -v elsewhere', async () => {
  const file = { delivery: { retries: 1, webhok: 'x' }, state_dir: 'x' };
  const listed = await ran({ argv: ['-L'], file, strict: ['delivery'] });
  expect(listed.status).toBe(2);
  expect(listed.stderr).toBe(
    `› Ignored state_dir in .app.json: Unknown key. Check its spelling, or remove it.\n${webhokLine}`,
  );
  const everything = await ran({ file, strict: true });
  expect(everything).toMatchObject({ status: 2, stderr: webhokLine + stateLine });
  // Below the top level, `strict: true` order is the walk's: state_dir follows delivery in the file.
  expect(everything.stderr.indexOf('delivery.webhok')).toBeLessThan(
    everything.stderr.indexOf('state_dir'),
  );
});

test('one failure names every rejected value and every unknown key, removals first', async () => {
  const file = { delivery: { retries: 'three', webhok: 'x' }, state_dir: 'x' };
  const result = await ran({ file, strict: true });
  expect(result).toEqual({
    status: 2,
    stderr: retriesLine + webhokLine + stateLine,
    stdout: '',
  });
});

test('a rejected value in an array item names the item by its index', async () => {
  const result = await ran({
    file: { sessions: { sources: [{ harness: 'a' }, { harness: 2 }] } },
    strict: ['sessions.sources'],
  });
  expect(result).toMatchObject({ status: 2 });
  expect(result.stderr).toBe(
    'app: Configuration value sessions.sources[1] in .app.json: Invalid input: expected string, received number. Correct the value, or remove it.\n',
  );
});

test('a file the schema rejects whole fails under strict: true and names the file', async () => {
  const schema = z
    .record(z.string(), z.unknown())
    .refine((file) => Object.keys(file).length === 0, 'Leave it empty');
  const result = await ran({ file: { alpha: 1 }, schema, strict: true });
  expect(result).toEqual({
    status: 2,
    stderr: 'app: Configuration file .app.json: Leave it empty. Correct the file, or remove it.\n',
    stdout: '',
  });
  // A list covers no removal of every key, which has no path.
  await expect(ran({ file: { alpha: 1 }, schema, strict: ['alpha'] })).resolves.toMatchObject({
    status: 0,
  });
});

test('the key path is escaped, so a key that holds a newline stays on one line', async () => {
  const schema = z.object({}).catchall(z.number());
  const result = await ran({ file: { 'a\nb': 'x' }, schema, strict: true });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain(String.raw`Configuration value a\u000ab in .app.json`);
  expect(result.stderr.split('\n').filter((line) => line !== '')).toHaveLength(1);
});

test('the provider fails the run when no option is linked to read the file', async () => {
  const config = configuration({ file: '.app.json', schema: closed, strict: ['delivery'] });
  const root = mkdtempSync(join(tmpdir(), 'loom-strict-'));
  try {
    writeFileSync(join(root, '.app.json'), JSON.stringify({ delivery: { retries: 'three' } }));
    const mock = mockProcess({ argv: [], cwd: root, env: { HOME: root } });
    await new Application('app', { plugins: [config.plugin], uses: [config.values] })
      .action(({ out }) => out.print('ran'))
      .run({ process: mock });
    expect(mock.exitCode).toBe(2);
    expect(mock.stderr.text).toBe(retriesLine);
    expect(mock.stdout.text).toBe('');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('the failure is an InputError whose first problem names --config, with one issue per line', async () => {
  const config = configuration({ file: '.app.json', schema: closed, strict: true });
  const root = mkdtempSync(join(tmpdir(), 'loom-strict-'));
  try {
    writeFileSync(
      join(root, '.app.json'),
      JSON.stringify({ delivery: { retries: 'three', webhok: 'x' } }),
    );
    const outcome = await new Application('app', {
      plugins: [config.plugin],
      uses: [config.values],
    })
      .option('flag', { extensions: [configInput({ path: 'flag' })], type: 'boolean' })
      .action(() => undefined)
      .invoke([], {}, { process: mockProcess({ cwd: root, env: { HOME: root } }) });
    expect(outcome.status).toBe('failed');
    const failure = outcome.status === 'failed' ? outcome.failure : undefined;
    expect(failure).toBeInstanceOf(InputError);
    expect(failure instanceof InputError ? failure.problems : []).toEqual([
      {
        input: { global: true, kind: 'option', name: 'config' },
        issues: [
          {
            message:
              'Configuration value delivery.retries in .app.json: Invalid input: expected number, received string. Correct the value, or remove it.',
          },
          {
            message: 'Unknown key delivery.webhok in .app.json. Check its spelling, or remove it.',
          },
        ],
        reason: 'invalid',
        spelling: 'config',
      },
    ]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('a linked option holding a value it cannot take fails the run when strict covers it', async () => {
  const file = { flag: 'yes' };
  const dropped = await ran({ argv: ['-L'], file });
  expect(dropped.status).toBe(0);
  expect(dropped.stderr).toBe(
    '› Ignored option "--flag" from flag in .app.json: Use true or false.\n',
  );
  const failed = await ran({ file, strict: true });
  expect(failed).toEqual({
    status: 2,
    stderr: 'app: Option "--flag" (from flag in .app.json): Use true or false.\n',
    stdout: '',
  });
  const listed = await ran({ file, strict: ['flag'] });
  expect(listed.status).toBe(2);
  // Another listed path leaves the option uncovered, so its value falls back as before.
  const other = await ran({ argv: ['-L'], file, strict: ['delivery'] });
  expect(other.status).toBe(0);
  expect(other.stderr).toBe(dropped.stderr);
});

test('a linked option whose validator rejects its value fails the run when strict covers it', async () => {
  const file = { delivery: { webhook: 'http://alerts.example.com/hook' } };
  const fallback = await ran({ argv: ['-L'], file });
  expect(fallback.status).toBe(0);
  expect(fallback.stderr).toContain(
    'Ignored option "--webhook" from delivery.webhook in .app.json',
  );
  const failed = await ran({ file, strict: ['delivery'] });
  expect(failed).toEqual({
    status: 2,
    stderr:
      'app: Option "--webhook" (from delivery.webhook in .app.json): Expected an absolute URL with the scheme https.\n',
    stdout: '',
  });
  // The uncovered option falls back, whether strict lists a sibling path or none.
  const sibling = await ran({ file, strict: ['stateDir'] });
  expect(sibling.status).toBe(0);
  // A value the validator accepts fills as it does without strict.
  const accepted = await ran({
    file: { delivery: { webhook: 'https://alerts.example.com/hook' } },
    strict: true,
  });
  expect(accepted.status).toBe(0);
  expect(JSON.parse(accepted.stdout)).toMatchObject({ webhook: 'https://alerts.example.com/hook' });
});

test('a file that holds a covered value and a covered option value reports the source failure alone', async () => {
  const file = { delivery: { retries: 'three' }, flag: 'yes' };
  const result = await ran({ file, strict: true });
  expect(result.status).toBe(2);
  expect(result.stderr).toBe(
    `${retriesLine}app: Option "--flag" (from flag in .app.json): Use true or false.\n`,
  );
});

test('a valibot schema fails on a rejected value, and cannot fail on an unknown key', async () => {
  const schema = object({ retries: optional(number()), stateDir: optional(string()) });
  const bad = await ran({ file: { retries: 'three' }, schema, strict: true });
  expect(bad.status).toBe(2);
  expect(bad.stderr).toContain('Configuration value retries in .app.json: Invalid type');
  const unknown = await ran({ file: { state_dir: 'x' }, schema, strict: true });
  expect(unknown.status).toBe(0);
});

/** The fault `configuration()` throws for a `strict` setting that JavaScript supplies, or `returned`. */
function strictFault(strict: unknown) {
  const settings: Settings = {};
  // JavaScript supplies settings the types reject.
  Reflect.set(settings, 'strict', strict);
  const fault = settingsFault(settings);
  return typeof fault === 'string'
    ? fault
    : { correction: fault.correction, sentence: fault.sentence };
}

test.each([[['a..b']], [['']], [['delivery', 7]], [['.a']], [['delivery.']]])(
  'a strict list %j that holds a path that is not a dotted path of nonempty keys is a fault at the call',
  (strict) => {
    expect(strictFault(strict)).toEqual({
      correction: 'List dotted paths of nonempty keys, such as delivery or delivery.webhook.',
      sentence:
        'Plugin "@loomcli/plugins/config" strict lists a path that is not a dotted path of nonempty keys.',
    });
  },
);

/** The fault the graph build throws for `strict`, or `built`. */
function built(strict: Strict) {
  const config = configuration({ schema: closed, ...(strict === undefined ? {} : { strict }) });
  try {
    new Application('app', { plugins: [config.plugin] }).action(() => undefined).inspect();
    return 'built';
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    return { correction: error.correction, rule: error.rule?.identity, sentence: error.sentence };
  }
}

test('a listed path the schema does not hold is a build fault, and a held or unchecked one builds', () => {
  expect(built(['delivry'])).toEqual({
    correction: 'List a path the schema describes, or add the key to the schema.',
    rule: '@loomcli/plugins/config/strict-schema-path',
    sentence:
      'Plugin "@loomcli/plugins/config" strict lists delivry, which the configuration schema does not hold.',
  });
  expect(built(['delivery', 'delivry.retries'])).toMatchObject({
    rule: '@loomcli/plugins/config/strict-schema-path',
  });
  expect(built(['delivery.retries', 'sessions.sources'])).toBe('built');
  // A key below an array is unchecked, so it builds although it covers nothing.
  expect(built(['sessions.sources.harness'])).toBe('built');
  expect(built(true)).toBe('built');
  // A schema that publishes no JSON Schema gets no check.
  const valibot = configuration({
    schema: object({ known: optional(string()) }),
    strict: ['absent'],
  });
  expect(() =>
    new Application('app', { plugins: [valibot.plugin] }).action(() => undefined).inspect(),
  ).not.toThrow();
});

test('a global linked option is requested on a subcommand, so strict fails its rejected value there', async () => {
  const root = mkdtempSync(join(tmpdir(), 'loom-strict-'));
  try {
    writeFileSync(
      join(root, '.app.json'),
      JSON.stringify({ delivery: { webhook: 'http://alerts.example.com/hook' } }),
    );
    const config = configuration({ file: '.app.json', schema: closed, strict: ['delivery'] });
    const mock = mockProcess({ argv: ['sources'], cwd: root, env: { HOME: root } });
    await new Application('app', { plugins: [config.plugin] })
      .globalOption('webhook', {
        extensions: [configInput({ path: 'delivery.webhook' })],
        type: 'string',
        validate: url({ protocols: ['https'] }),
      })
      .command(new Command('sources').action(() => undefined))
      .run({ process: mock });
    expect(mock.exitCode).toBe(2);
    expect(mock.stderr.text).toBe(
      'app: Option "--webhook" (from delivery.webhook in .app.json): Expected an absolute URL with the scheme https.\n',
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
