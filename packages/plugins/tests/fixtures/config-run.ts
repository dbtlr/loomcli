import { Application, DeclarationError, InputError, override, plugin } from '@loomcli/core';
import type { InvocationValues } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import type { ConfigurationSettings } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { help } from '@loomcli/plugins/help';
import { mockProcess } from '@loomcli/testing';
import { path } from '@loomcli/validators';
import { z } from 'zod';

const digits = z.string().regex(/^[0-9]+$/u, 'Supply a whole number.');

const print =
  (label: string) =>
  ({ options, out }: { options: unknown; out: { print(text: string): unknown } }) =>
    out.print(`${label}:${JSON.stringify(options)}`);

/**
 * The schemas a case picks by name. `loose` accepts whatever a file holds. `typed` describes the
 * sections the drop tests break, in a loose object so the fixture's linked paths need no keys: a default, a transform, a nested table, an array of units, and a
 * record of units.
 */
const schemas = {
  loose: z.record(z.string(), z.unknown()),
  /** Rejects an empty file, which the types cannot see. */
  refined: z.record(z.string(), z.unknown()).refine((file) => 'present' in file, 'Add present.'),
  /** A refinement on the top-level object, which has no path. */
  topRefined: z
    .looseObject({ mode: z.string().optional() })
    .refine((file) => file.mode !== 'bad', 'Pick another mode.'),
  typed: z.looseObject({
    mode: z.enum(['fast', 'slow']).optional(),
    owners: z.record(z.string(), z.object({ id: z.string() })).optional(),
    retries: z.number().int().default(3),
    sessions: z
      .object({
        sources: z.array(z.object({ dir: z.string().optional(), harness: z.string() })).optional(),
      })
      .optional(),
    title: z
      .string()
      .transform((text) => text.toUpperCase())
      .optional(),
    updates: z.object({ interval: z.number().optional() }).optional(),
  }),
};

/** The names of the schemas a case may pick. */
type SchemaName = keyof typeof schemas;

/** The settings a case gives besides the schema. */
type Settings = Omit<ConfigurationSettings<typeof schemas.loose, 'project'>, 'schema'>;

/** A plugin that gives the run a verbose mark, so the cases can read `-v` lines. */
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

/** The view overrides a test installs, so a source's InputError problems reach one. */
const views: Record<string, ReturnType<typeof override>[]> = {
  input: [override(InputError, { render: (failure) => `${JSON.stringify(failure.problems)}\n` })],
  none: [],
};

/** What a case declares about the fixture application. */
interface Declared {
  readonly limitPath?: string;
  /** Prints the value the action reads as provided.config beside its options. */
  readonly provided?: boolean;
  readonly schema?: SchemaName;
  readonly settings?: Settings;
  readonly view?: string;
  /** Installs a verbose mark, spelled -L, so a case reads the -v lines. */
  readonly loud?: boolean;
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
function application({
  limitPath = 'limits.bytes',
  loud: marked = false,
  provided = false,
  schema = 'loose',
  settings,
  view = 'none',
}: Declared = {}) {
  const { plugin: configPlugin, values } = configuration({ ...settings, schema: schemas[schema] });
  return (
    new Application('app', {
      plugins: [configPlugin, help(), ...(marked ? [loud] : [])],
      ...(provided ? { uses: [values] } : {}),
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
      // A path option, which resolves a relative value against the configuration file's directory.
      .option('root', {
        description: 'The root folder.',
        extensions: [configInput({ path: 'root' })],
        type: 'string',
        validate: path(),
      })
      .action(async (context) => {
        await print('root')(context);
        if (provided) {
          // The Application opts in only when the case asks, so the typed value is read by name.
          await context.out.print(
            `config:${JSON.stringify(Reflect.get(context.provided, 'config'))}`,
          );
        }
      })
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
export type { Declared, SchemaName, Settings };
