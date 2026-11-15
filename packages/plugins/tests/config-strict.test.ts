import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, Command, DeclarationError, InputError, plugin } from '@loomcli/core';
import type { InvocationOutcome, StandardSchemaV1 } from '@loomcli/core';
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

test('a rejected value in an array item names the issue path, with the item by its index', async () => {
  const result = await ran({
    file: { sessions: { sources: [{ harness: 'a' }, { harness: 2 }] } },
    strict: ['sessions.sources'],
  });
  expect(result).toMatchObject({ status: 2 });
  expect(result.stderr).toBe(
    'app: Configuration value sessions.sources[1].harness in .app.json: Invalid input: expected string, received number. Correct the value, or remove it.\n',
  );
});

test('the failure names the one wrong key of a two-key array item, and -v still names the item', async () => {
  const schema = closed.extend({
    sessions: z
      .object({ sources: z.array(z.object({ harness: z.string(), root: z.string() })).optional() })
      .optional(),
  });
  const file = {
    sessions: {
      sources: [
        { harness: 'a', root: '/a' },
        { harness: 'b', root: 7 },
      ],
    },
  };
  // Listing the array's own path covers an issue inside any of its items.
  const failed = await ran({ file, schema, strict: ['sessions.sources'] });
  expect(failed).toEqual({
    status: 2,
    stderr:
      'app: Configuration value sessions.sources[1].root in .app.json: Invalid input: expected string, received number. Correct the value, or remove it.\n',
    stdout: '',
  });
  const dropped = await ran({ argv: ['-L'], file, schema, strict: ['delivery'] });
  expect(dropped.status).toBe(0);
  expect(dropped.stderr).toBe(
    '› Ignored sessions.sources[1] in .app.json: Invalid input: expected string, received number\n',
  );
});

test('a required key missing at a listed path fails the run although the removal lands on its section', async () => {
  const schema = closed.extend({
    delivery: z.object({ retries: z.number().optional(), webhook: z.string() }).optional(),
  });
  const result = await ran({
    file: { delivery: { retries: 1 } },
    schema,
    strict: ['delivery.webhook'],
  });
  expect(result).toEqual({
    status: 2,
    stderr:
      'app: Configuration value delivery.webhook in .app.json: Invalid input: expected string, received undefined. Correct the value, or remove it.\n',
    stdout: '',
  });
});

/** A delivery section whose cross-field refinement fails on the section itself. */
const refinedDelivery = closed.extend({
  delivery: z
    .object({
      backoff: z.number().optional(),
      retries: z.number().optional(),
      webhook: z.string().optional(),
    })
    .refine(
      (section) => section.retries === undefined || section.backoff !== undefined,
      'Set backoff when retries is set',
    )
    .optional(),
});

test('a section-level refinement that would discard a valid value at a listed path fails the run', async () => {
  const result = await ran({
    file: { delivery: { retries: 2, webhook: 'https://alerts.example.com/hook' } },
    schema: refinedDelivery,
    strict: ['delivery.webhook'],
  });
  expect(result).toEqual({
    status: 2,
    stderr:
      'app: Configuration value delivery in .app.json: Set backoff when retries is set. Correct the value, or remove it.\n',
    stdout: '',
  });
});

test('a removal of an ancestor drops and is named at -v when the file holds nothing at the listed path', async () => {
  const refined = await ran({
    argv: ['-L'],
    file: { delivery: { retries: 2 } },
    schema: refinedDelivery,
    strict: ['delivery.webhook'],
  });
  expect(refined).toMatchObject({
    status: 0,
    stderr: '› Ignored delivery in .app.json: Set backoff when retries is set\n',
  });
  // A section that is no object holds no value at the listed path either.
  const holder = await ran({ argv: ['-L'], file: { delivery: 5 }, strict: ['delivery.webhook'] });
  expect(holder).toMatchObject({
    status: 0,
    stderr: '› Ignored delivery in .app.json: Invalid input: expected object, received number\n',
  });
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
  // A removal of every key discards the value a listed path holds, so a list fails the run too.
  await expect(ran({ file: { alpha: 1 }, schema, strict: ['alpha'] })).resolves.toEqual({
    status: 2,
    stderr: 'app: Configuration file .app.json: Leave it empty. Correct the file, or remove it.\n',
    stdout: '',
  });
  // It drops when the file holds nothing at the listed path.
  await expect(ran({ file: { beta: 1 }, schema, strict: ['alpha'] })).resolves.toMatchObject({
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

/** The fault the graph build throws for `strict` over `schema`, or `built`. */
function built(strict: Strict, schema: StandardSchemaV1 = closed) {
  const config = configuration({ schema, ...(strict === undefined ? {} : { strict }) });
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

test('a listed path that passes through an array is a build fault that points to the array', () => {
  expect(built(['delivery', 'sessions.sources.harness'])).toEqual({
    correction: "List the array's own path, which covers every item.",
    rule: '@loomcli/plugins/config/strict-schema-path',
    sentence:
      'Plugin "@loomcli/plugins/config" strict lists sessions.sources.harness, which passes through the array at sessions.sources.',
  });
});

/** A schema whose `targets` is an array of strings or an object that holds `primary`. */
const arrayOrObject = closed.extend({
  targets: z.union([z.array(z.string()), z.object({ primary: z.string() })]).optional(),
});

test('a listed path through the object member of an array-or-object union builds and fails its value', async () => {
  expect(built(['targets.primary'], arrayOrObject)).toBe('built');
  // The removal discards the value at targets.primary, so it fails the run.
  // Its line names the path of the union's own issue, which is targets.
  const result = await ran({
    file: { targets: { primary: 5 } },
    schema: arrayOrObject,
    strict: ['targets.primary'],
  });
  expect(result).toEqual({
    status: 2,
    stderr:
      'app: Configuration value targets in .app.json: Invalid input. Correct the value, or remove it.\n',
    stdout: '',
  });
});

test('a listed path through an array-or-object union whose object member lacks the key is a build fault', () => {
  expect(built(['targets.backup'], arrayOrObject)).toEqual({
    correction: "List the array's own path, which covers every item.",
    rule: '@loomcli/plugins/config/strict-schema-path',
    sentence:
      'Plugin "@loomcli/plugins/config" strict lists targets.backup, which passes through the array at targets.',
  });
});

test('a listed path into the map of a list-or-map union builds', () => {
  const schema = closed.extend({
    labels: z.union([z.array(z.string()), z.record(z.string(), z.string())]).optional(),
  });
  expect(built(['labels.primary'], schema)).toBe('built');
});

test('a listed path builds when an open object member leaves the key unchecked beside an array and a member that declares it', () => {
  const schema = closed.extend({
    targets: z
      .union([
        z.array(z.string()),
        z.looseObject({ other: z.string() }),
        z.object({ primary: z.string() }),
      ])
      .optional(),
  });
  expect(built(['targets.primary'], schema)).toBe('built');
});

test('a listed path through an array of objects alone is still a build fault', () => {
  const schema = closed.extend({ items: z.array(z.object({ name: z.string() })).optional() });
  expect(built(['items.name'], schema)).toMatchObject({
    rule: '@loomcli/plugins/config/strict-schema-path',
    sentence:
      'Plugin "@loomcli/plugins/config" strict lists items.name, which passes through the array at items.',
  });
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

/** The escape character, built from its code point so the source holds no invisible character. */
const escape = String.fromCodePoint(0x1b);

/** One invocation of an application with the given mock process. */
type Invoke = (process: ReturnType<typeof mockProcess>) => Promise<InvocationOutcome>;

/** Runs `invoke` over a file written as `file`, and returns the failure's problems. */
async function problemsOf(invoke: Invoke, file: unknown): Promise<readonly unknown[] | 'ran'> {
  const root = mkdtempSync(join(tmpdir(), 'loom-strict-'));
  try {
    writeFileSync(join(root, '.app.json'), JSON.stringify(file));
    const outcome = await invoke(mockProcess({ cwd: root, env: { HOME: root } }));
    if (outcome.status !== 'failed') {
      return 'ran';
    }
    return outcome.failure instanceof InputError ? outcome.failure.problems : [outcome.failure];
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

/** An invocation of an application that reads `.app.json` under `strict: true` and provides the file. */
function strictApp(schema: StandardSchemaV1): Invoke {
  const config = configuration({ file: '.app.json', schema, strict: true });
  const app = new Application('app', { plugins: [config.plugin], uses: [config.values] }).action(
    () => undefined,
  );
  return (process) => app.invoke([], {}, { process });
}

/** The file's problem of a strict failure, holding one issue for each message. */
function fileProblem(...messages: string[]) {
  return {
    input: { global: true, kind: 'option', name: 'config' },
    issues: messages.map((message) => ({ message })),
    reason: 'invalid',
    spelling: 'config',
  };
}

test('a schema message that holds a control character prints it escaped, in stderr and in the problem', async () => {
  const schema = z.object({}).catchall(z.number({ error: `Use a number${escape}[31m` }));
  const line = String.raw`Configuration value alpha in .app.json: Use a number\u001b[31m. Correct the value, or remove it.`;
  const result = await ran({ file: { alpha: 'x' }, schema, strict: true });
  expect(result).toEqual({ status: 2, stderr: `app: ${line}\n`, stdout: '' });
  await expect(problemsOf(strictApp(schema), { alpha: 'x' })).resolves.toEqual([fileProblem(line)]);
});

test('an unknown key that holds a control character prints it escaped, in stderr and in the problem', async () => {
  const file = { [`state${escape}dir`]: 'x' };
  const line = String.raw`Unknown key state\u001bdir in .app.json. Check its spelling, or remove it.`;
  const result = await ran({ file, strict: true });
  expect(result).toEqual({ status: 2, stderr: `app: ${line}\n`, stdout: '' });
  await expect(problemsOf(strictApp(closed), file)).resolves.toEqual([fileProblem(line)]);
});

test('an unknown key that holds an invisible character fails the run with the quoted key, in stderr and in the problem', async () => {
  const file = { [`state${String.fromCodePoint(0x20_0b)}dir`]: 'x' };
  const line = 'Unknown key "stateU+200Bdir" in .app.json. Check its spelling, or remove it.';
  const result = await ran({ file, strict: true });
  expect(result).toEqual({ status: 2, stderr: `app: ${line}\n`, stdout: '' });
  await expect(problemsOf(strictApp(closed), file)).resolves.toEqual([fileProblem(line)]);
});

test('a schema message that ends in a period gets no second one', async () => {
  const schema = z.object({}).catchall(z.number({ error: 'Use a number.' }));
  const result = await ran({ file: { alpha: 'x' }, schema, strict: true });
  expect(result.stderr).toBe(
    'app: Configuration value alpha in .app.json: Use a number. Correct the value, or remove it.\n',
  );
});

test('a multiple option with two items it cannot take names each item by its position', async () => {
  const schema = closed.extend({ fields: z.array(z.unknown()).optional() });
  const config = configuration({ file: '.app.json', schema, strict: true });
  const app = new Application('app', { plugins: [config.plugin] })
    .option('field', {
      extensions: [configInput({ path: 'fields' })],
      multiple: true,
      type: 'string',
    })
    .action(() => undefined);
  const file = { fields: ['a', true, {}] };
  const root = mkdtempSync(join(tmpdir(), 'loom-strict-'));
  try {
    writeFileSync(join(root, '.app.json'), JSON.stringify(file));
    const mock = mockProcess({ argv: [], cwd: root, env: { HOME: root } });
    await app.run({ process: mock });
    expect(mock.exitCode).toBe(2);
    expect(mock.stderr.text).toBe(
      'app: Option "--field" (from fields in .app.json) at 1: Use a string or a number.\napp: Option "--field" (from fields in .app.json) at 2: Use a string or a number.\n',
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
  await expect(problemsOf((process) => app.invoke([], {}, { process }), file)).resolves.toEqual([
    {
      input: { global: false, kind: 'option', name: 'field' },
      issues: [
        { message: 'Use a string or a number.', path: [1] },
        { message: 'Use a string or a number.', path: [2] },
      ],
      reason: 'invalid',
      spelling: 'field',
    },
  ]);
});

test('the file problem comes before a linked global option, which the problem marks global', async () => {
  const config = configuration({ file: '.app.json', schema: closed, strict: true });
  const app = new Application('app', { plugins: [config.plugin] })
    .globalOption('flag', { extensions: [configInput({ path: 'flag' })], type: 'boolean' })
    .action(() => undefined);
  await expect(
    problemsOf((process) => app.invoke([], {}, { process }), {
      delivery: { retries: 'three' },
      flag: 'yes',
    }),
  ).resolves.toEqual([
    fileProblem(
      'Configuration value delivery.retries in .app.json: Invalid input: expected number, received string. Correct the value, or remove it.',
    ),
    {
      input: { global: true, kind: 'option', name: 'flag' },
      issues: [{ message: 'Use true or false.' }],
      reason: 'invalid',
      spelling: 'flag',
    },
  ]);
});

/** The settings a broken-file case varies: the file's raw text, its pattern and name, and `strict`. */
interface BrokenCase {
  /** The file's text, or `null` for a directory in its place. */
  readonly text: string | null;
  readonly strict?: Strict | undefined;
  /** The file pattern, `.app.json` by default. */
  readonly file?: string;
  /** The name the file is written under, the pattern itself by default. */
  readonly name?: string;
  /** The variable that names the file, which the run sets to `name`. */
  readonly env?: string;
  /** Other files to write beside it, by name. */
  readonly beside?: Readonly<Record<string, string>>;
}

/** Runs an application that reads the provider over a file written as raw text. */
async function ranBroken({
  beside = {},
  env,
  file = '.app.json',
  name = file,
  strict,
  text,
}: BrokenCase): Promise<Ran> {
  const config = configuration({
    file,
    schema: closed,
    ...(env === undefined ? {} : { env }),
    ...(strict === undefined ? {} : { strict }),
  });
  const root = mkdtempSync(join(tmpdir(), 'loom-strict-'));
  try {
    if (text === null) {
      mkdirSync(join(root, name));
    } else {
      writeFileSync(join(root, name), text);
    }
    for (const [other, body] of Object.entries(beside)) {
      writeFileSync(join(root, other), body);
    }
    const mock = mockProcess({
      argv: [],
      cwd: root,
      env: { HOME: root, ...(env === undefined ? {} : { [env]: name }) },
    });
    await new Application('app', { plugins: [config.plugin], uses: [config.values] })
      .action(({ out }) => out.print('ran'))
      .run({ process: mock });
    return { status: mock.exitCode, stderr: mock.stderr.text, stdout: mock.stdout.text };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

const notJson =
  'app: Configuration file .app.json is not valid JSON at line 1, column 2. Correct its syntax, or remove it.\n';

test('a discovered file that does not parse fails the run with code 2 under strict: true, in place of its warning', async () => {
  await expect(ranBroken({ strict: true, text: '{,}' })).resolves.toEqual({
    status: 2,
    stderr: notJson,
    stdout: '',
  });
});

test('a broken file fails the run under a list, whatever paths it names', async () => {
  await expect(ranBroken({ strict: ['delivery'], text: '{,}' })).resolves.toEqual({
    status: 2,
    stderr: notJson,
    stdout: '',
  });
});

test('without strict, a broken file still warns and the run reads no configuration', async () => {
  await expect(ranBroken({ text: '{,}' })).resolves.toEqual({
    status: 0,
    stderr:
      '⚠ Skipped .app.json: the file is not valid JSON at line 1, column 2, so this run reads no configuration. Correct its syntax, or remove it.\n',
    stdout: 'ran\n',
  });
});

test('a file that does not hold an object, and one that cannot be read, fail with their own clause and fix', async () => {
  await expect(ranBroken({ strict: true, text: '[1]' })).resolves.toEqual({
    status: 2,
    stderr:
      'app: Configuration file .app.json does not hold a JSON object. Write its settings as one JSON object, or remove it.\n',
    stdout: '',
  });
  await expect(ranBroken({ strict: true, text: null })).resolves.toEqual({
    status: 2,
    stderr:
      'app: Configuration file .app.json could not be read. Make it readable, or remove it.\n',
    stdout: '',
  });
});

test('a broken TOML file names its format, its place, and its fix', async () => {
  const result = await ranBroken({ file: '.app.toml', strict: true, text: 'a = \n' });
  expect(result.status).toBe(2);
  expect(result.stderr).toMatch(
    /^app: Configuration file \.app\.toml is not valid TOML at line \d+, column \d+\. Correct its syntax, or remove it\.\n$/u,
  );
});

test('a broken file the variable names fails the run under strict, and a missing one stays silent', async () => {
  await expect(
    ranBroken({ env: 'APP_CONFIG', name: 'custom.json', strict: true, text: '{,}' }),
  ).resolves.toEqual({
    status: 2,
    stderr:
      'app: Configuration file custom.json is not valid JSON at line 1, column 2. Correct its syntax, or remove it.\n',
    stdout: '',
  });
  const config = configuration({
    env: 'APP_CONFIG',
    file: '.app.json',
    schema: closed,
    strict: true,
  });
  const root = mkdtempSync(join(tmpdir(), 'loom-strict-'));
  try {
    const mock = mockProcess({
      argv: [],
      cwd: root,
      env: { APP_CONFIG: 'absent.json', HOME: root },
    });
    await new Application('app', { plugins: [config.plugin], uses: [config.values] })
      .action(({ out }) => out.print('ran'))
      .run({ process: mock });
    expect({ status: mock.exitCode, stderr: mock.stderr.text, stdout: mock.stdout.text }).toEqual({
      status: 0,
      stderr: '',
      stdout: 'ran\n',
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('a later candidate skipped unread keeps its warning, written before the broken file fails the run', async () => {
  await expect(
    ranBroken({
      beside: { '.app.toml': 'a = 1\n' },
      file: '.app.{json,toml}',
      name: '.app.json',
      strict: true,
      text: '{,}',
    }),
  ).resolves.toEqual({
    status: 2,
    stderr: `⚠ Skipped .app.toml: .app.json matches the same pattern first. Keep one of the files, and remove the others.\n${notJson}`,
    stdout: '',
  });
});

test('a missing file is no fault under strict, and --no-config reads no broken file', async () => {
  const config = configuration({ file: '.app.json', schema: closed, strict: true });
  const root = mkdtempSync(join(tmpdir(), 'loom-strict-'));
  try {
    const app = new Application('app', { plugins: [config.plugin], uses: [config.values] }).action(
      ({ out }) => out.print('ran'),
    );
    const missing = mockProcess({ argv: [], cwd: root, env: { HOME: root } });
    await app.run({ process: missing });
    expect(missing.exitCode).toBe(0);
    expect(missing.stderr.text).toBe('');
    writeFileSync(join(root, '.app.json'), '{,}');
    const ignored = mockProcess({ argv: ['--no-config'], cwd: root, env: { HOME: root } });
    await app.run({ process: ignored });
    expect(ignored.exitCode).toBe(0);
    expect(ignored.stderr.text).toBe('');
    expect(ignored.stdout.text).toBe('ran\n');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('the broken-file failure is an InputError with one problem on --config and one issue', async () => {
  const config = configuration({ file: '.app.json', schema: closed, strict: ['delivery'] });
  const root = mkdtempSync(join(tmpdir(), 'loom-strict-'));
  try {
    writeFileSync(join(root, '.app.json'), '{,}');
    const outcome = await new Application('app', {
      plugins: [config.plugin],
      uses: [config.values],
    })
      .option('webhook', {
        extensions: [configInput({ path: 'delivery.webhook' })],
        type: 'string',
      })
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
              'Configuration file .app.json is not valid JSON at line 1, column 2. Correct its syntax, or remove it.',
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

test('a broken YAML file in the user folder fails the run under strict, with its own clause and fix', async () => {
  const config = configuration({ file: '.app.yaml', schema: closed, strict: true });
  const root = mkdtempSync(join(tmpdir(), 'loom-strict-'));
  try {
    const work = join(root, 'work');
    const folder = join(root, 'xdg', 'app');
    mkdirSync(work);
    mkdirSync(folder, { recursive: true });
    const app = new Application('app', { plugins: [config.plugin], uses: [config.values] }).action(
      ({ out }) => out.print('ran'),
    );
    const runIn = async (text: string) => {
      writeFileSync(join(folder, 'config.yaml'), text);
      const mock = mockProcess({
        argv: [],
        ceiling: root,
        cwd: work,
        env: { HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'xdg') },
      });
      await app.run({ process: mock });
      return { status: mock.exitCode, stderr: mock.stderr.text, stdout: mock.stdout.text };
    };
    const shown = join(folder, 'config.yaml');
    await expect(runIn('- 1\n')).resolves.toEqual({
      status: 2,
      stderr: `app: Configuration file ${shown} does not hold a YAML mapping. Write its settings as one YAML mapping, or remove it.\n`,
      stdout: '',
    });
    const broken = await runIn('a: [\n');
    expect(broken.status).toBe(2);
    expect(broken.stderr).toMatch(
      /is not valid YAML at line \d+, column \d+\. Correct its syntax, or remove it\.\n$/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
