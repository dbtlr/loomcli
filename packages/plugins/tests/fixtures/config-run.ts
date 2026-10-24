import { Application, DeclarationError, InputError, override } from '@loomcli/core';
import type { InvocationValues } from '@loomcli/core';
import { config } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { help } from '@loomcli/plugins/help';
import { mockProcess } from '@loomcli/testing';
import { z } from 'zod';

const digits = z.string().regex(/^[0-9]+$/u, 'Supply a whole number.');

const print =
  (label: string) =>
  ({ options, out }: { options: unknown; out: { print(text: string): unknown } }) =>
    out.print(`${label}:${JSON.stringify(options)}`);

/** The view overrides a test installs, so a source's InputError problems reach one. */
const views: Record<string, ReturnType<typeof override>[]> = {
  input: [override(InputError, { render: (failure) => `${JSON.stringify(failure.problems)}\n` })],
  none: [],
};

/** What a case declares about the fixture application. */
interface Declared {
  readonly limitPath?: string;
  readonly settings?: Parameters<typeof config>[0];
  readonly view?: string;
}

/** The environment a run reads as its whole environment. */
type Env = Readonly<Record<string, string | undefined>>;

/**
 * A failure as a rule table reads it: a declaration fault's sentence followed by its correction,
 * one fix after another when it lists several, and any other failure's message.
 */
function failureText(failure: unknown): string {
  if (failure instanceof DeclarationError) {
    const correction = failure.correction === undefined ? [] : [failure.correction].flat();
    return [failure.sentence, ...correction].join(' ');
  }
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * Every value shape and spelling the plugin's rules touch, bound to dotted paths. `settings` are
 * the plugin's settings, or none, `limitPath` rebinds `--limit` so a test reaches a key no fixed
 * path names, and `view` names the view overrides the application installs.
 */
function application({ limitPath = 'limits.bytes', settings, view = 'none' }: Declared = {}) {
  return (
    new Application('app', {
      plugins: [config(settings), help()],
      views: views[view] ?? [],
    })
      .globalOption('level', {
        description: 'The log level.',
        env: 'FIXTURE_LEVEL',
        extensions: [configInput({ path: 'log.level' })],
        type: 'string',
      })
      .option('limit', {
        default: '10',
        description: 'The limit.',
        env: 'FIXTURE_LIMIT',
        extensions: [configInput({ path: limitPath })],
        type: 'string',
        validate: digits,
      })
      .option('total', {
        description: 'Add a total.',
        extensions: [configInput({ path: 'total' })],
        type: 'boolean',
      })
      .option('quiet', {
        description: 'Say less.',
        extensions: [configInput({ path: 'quiet' })],
        polarity: 'negative',
        type: 'boolean',
      })
      .option('fields', {
        description: 'The fields.',
        extensions: [configInput({ path: 'fields' })],
        multiple: true,
        type: 'string',
      })
      .option('title', {
        description: 'The title.',
        extensions: [configInput({ path: 'title' })],
        type: 'string',
      })
      // A path that is an Object.prototype member name, which only an own key may answer.
      .option('owner', {
        description: 'The owner.',
        extensions: [configInput({ path: 'constructor' })],
        type: 'string',
      })
      // A counted option takes a whole number of 0 or more.
      .option('verbose', {
        description: 'Say more.',
        extensions: [configInput({ path: 'verbose' })],
        short: 'v',
        type: 'count',
      })
      // A string option with an implied value takes a value by the string rule alone.
      .option('backup', {
        description: 'How to back up.',
        extensions: [configInput({ path: 'backup' })],
        implied: 'simple',
        type: 'string',
      })
      .action(print('root'))
  );
}

/**
 * One argv run of the application on a mock process, with the files resolving in `cwd` and the
 * environment `env` as the run's whole environment. `columns` puts both output streams on a
 * terminal that wide. The result reads as a process's would: the status the run set, and what it
 * wrote. A declaration fault the application throws ends the case with status 3 and its rule text.
 */
async function run({
  argv,
  columns,
  cwd,
  declared,
  env,
}: {
  readonly argv: readonly string[];
  readonly columns?: number;
  readonly cwd?: string;
  readonly declared: Declared;
  readonly env: Env;
}) {
  try {
    const mock = mockProcess({
      argv,
      env,
      ...(cwd === undefined ? {} : { cwd }),
      ...(columns === undefined ? {} : { terminal: { columns, rows: 24 } }),
    });
    const code = await application(declared).run({ process: mock });
    return {
      status: mock.exitCode,
      stderr: mock.stderr.text,
      stdout: `${mock.stdout.text}resolved:${code}\n`,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    return { status: 3, stderr: '', stdout: `${name}: ${failureText(error)}\n` };
  }
}

/** The outcome of running the root by name with the named values, as plain data. */
async function invoked({
  cwd,
  declared,
  env,
  values,
}: {
  readonly cwd?: string;
  readonly declared: Declared;
  readonly env: Env;
  readonly values: InvocationValues;
}) {
  const outcome = await application(declared).invoke([], values, {
    process: mockProcess({ env, ...(cwd === undefined ? {} : { cwd }) }),
  });
  return structuredClone({
    exitCode: 'exitCode' in outcome ? outcome.exitCode : undefined,
    messages: 'messages' in outcome ? outcome.messages : undefined,
    output: 'output' in outcome ? outcome.output : undefined,
    status: outcome.status,
  });
}

/** The application's inspected graph, as plain data. */
function inspected(declared: Declared) {
  return structuredClone(application(declared).inspect());
}

export { application, inspected, invoked, run };
export type { Declared };
