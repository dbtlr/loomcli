/*
 * Acceptance plan for a one-way requirement (docs/core/options.md#a-one-way-requirement, ADR-0167).
 *
 * Every case runs an Application in process on a mock process, or reads the fault a declaring call
 * throws.
 *
 * - Accepted. A needed option alone runs, and so does a run that supplies everything.
 * - The trigger. A typed, an environment, or a configured option triggers the requirement, and a
 *   Boolean at its absent value triggers nothing.
 * - The needed options. A typed, an environment, or a configured needed option satisfies it, and a
 *   default does not.
 * - The failure. One InputProblem with reason `requires`, whose sentence names the option, with its
 *   source label, and only the needed options it still lacks.
 * - Beside an exclusive group. A requirement that holds a withdrawn member is not checked.
 * - Where it exists. The root, a Command, a hook's attached Command, and an option set.
 * - Declaration faults. The group rules at the call, in name order.
 */
import {
  Application,
  Command,
  InputError,
  extension,
  optionSet,
  override,
  plugin,
} from '@loomcli/core';
import type { SourceAnswer } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

/**
 * A configuration source that answers `answers`, each labeled as a key in `login.json`, and the
 * binding its options carry.
 */
function loginSource(answers: Record<string, SourceAnswer['value']>) {
  const binding = extension('@test/login/key', { schema: z.string(), target: 'option' });
  const source = plugin('@test/login', {
    extensions: [binding],
    source: {
      binding,
      load: async () => ({
        default: async () =>
          Object.fromEntries(
            Object.entries(answers).map(([name, value]) => [
              name,
              { label: `${name} in login.json`, value },
            ]),
          ),
      }),
    },
  });
  return { binding, source };
}

/** What one run saw: its status, its stderr, and the options the action read. */
interface Outcome {
  readonly options: Record<string, unknown> | undefined;
  readonly status: number;
  readonly stderr: string;
}

/** The facts one run of the login application reads. */
interface Words {
  readonly answers?: Record<string, SourceAnswer['value']>;
  readonly argv?: string[];
  readonly env?: Record<string, string>;
}

/**
 * The login application: `--password` requires `--user` and `--host`, whose default does not
 * count, `--token` requires three options, and a `both` Boolean `--pretty` requires `--format`.
 */
async function login(words: Words): Promise<Outcome> {
  const { binding, source } = loginSource(words.answers ?? {});
  let options: Record<string, unknown> | undefined = undefined;
  const mock = mockProcess({ argv: words.argv ?? [], env: words.env ?? {} });
  const status = await new Application('login', { plugins: [source] })
    .option('user', { env: 'LOGIN_USER', extensions: [binding('user')], type: 'string' })
    .option('password', {
      env: 'LOGIN_PASSWORD',
      extensions: [binding('password')],
      type: 'string',
    })
    .option('host', { default: 'localhost', extensions: [binding('host')], type: 'string' })
    .option('port', { type: 'string' })
    .option('token', { type: 'string' })
    .option('pretty', { extensions: [binding('pretty')], polarity: 'both', type: 'boolean' })
    .option('format', { type: 'string' })
    .requires('password', 'user', 'host')
    .requires('token', 'user', 'host', 'port')
    .requires('pretty', 'format')
    .action((context) => {
      options = { ...context.options };
    })
    .run({ process: mock });
  return { options, status, stderr: mock.stderr.text };
}

test.each([
  ['no option', []],
  ['a needed option alone', ['--user', 'ada']],
  ['every needed option without the option', ['--user', 'ada', '--host', 'example.org']],
  ['everything', ['--user', 'ada', '--password', 'secret', '--host', 'example.org']],
])('%s runs', async (_case, argv) => {
  const outcome = await login({ argv });
  expect(outcome.stderr).toBe('');
  expect(outcome.status).toBe(0);
});

test('a typed option without its needed options fails with exit 2 and names each', async () => {
  const outcome = await login({ argv: ['--password', 'secret'] });
  expect(outcome).toEqual({
    options: undefined,
    status: 2,
    stderr:
      'login: Option "--password" requires options "--user" and "--host". Supply them as well, or remove "--password".\n',
  });
});

test('the sentence names only the needed options still lacking, and a default supplies none', async () => {
  const outcome = await login({ argv: ['--password', 'secret', '--user', 'ada'] });
  expect(outcome.status).toBe(2);
  expect(outcome.stderr).toBe(
    'login: Option "--password" requires option "--host". Supply it as well, or remove "--password".\n',
  );
});

test('three or more lacking options join with commas and a final and', async () => {
  const outcome = await login({ argv: ['--token', 't'] });
  expect(outcome.stderr).toBe(
    'login: Option "--token" requires options "--user", "--host", and "--port". Supply them as well, or remove "--token".\n',
  );
});

test('an environment option triggers the requirement and carries its source label', async () => {
  const outcome = await login({ argv: ['--user', 'ada'], env: { LOGIN_PASSWORD: 'secret' } });
  expect(outcome.status).toBe(2);
  expect(outcome.stderr).toBe(
    'login: Option "--password" (from LOGIN_PASSWORD) requires option "--host". Supply it as well, or remove "--password".\n',
  );
});

test('a configured option triggers the requirement and carries its source label', async () => {
  const outcome = await login({ answers: { password: 'secret' } });
  expect(outcome.status).toBe(2);
  expect(outcome.stderr).toBe(
    'login: Option "--password" (from password in login.json) requires options "--user" and "--host". Supply them as well, or remove "--password".\n',
  );
});

test.each<[string, Words]>([
  ['the command line', { argv: ['--password', 's', '--user', 'ada', '--host', 'h'] }],
  ['the environment', { argv: ['--password', 's', '--host', 'h'], env: { LOGIN_USER: 'ada' } }],
  ['configuration', { answers: { host: 'h', user: 'ada' }, argv: ['--password', 's'] }],
])('a needed option from %s satisfies the requirement', async (_case, words) => {
  const outcome = await login(words);
  expect(outcome.stderr).toBe('');
  expect(outcome.status).toBe(0);
  expect(outcome.options).toMatchObject({ password: 's', user: 'ada' });
});

test.each<[string, Words]>([
  ['typed', { argv: ['--no-pretty'] }],
  ['configured', { answers: { pretty: false } }],
])('a %s Boolean at its absent value triggers nothing', async (_case, words) => {
  const outcome = await login(words);
  expect(outcome.stderr).toBe('');
  expect(outcome.status).toBe(0);
  expect(outcome.options).toMatchObject({ pretty: false });
});

test('a Boolean off its absent value triggers its requirement', async () => {
  const outcome = await login({ argv: ['--pretty'] });
  expect(outcome.stderr).toBe(
    'login: Option "--pretty" requires option "--format". Supply it as well, or remove "--pretty".\n',
  );
});

test('a negative Boolean typed off its absent value triggers its requirement', async () => {
  const mock = mockProcess({ argv: ['--no-cache'] });
  const status = await new Application('fetch')
    .option('cache', { polarity: 'negative', type: 'boolean' })
    .option('mirror', { type: 'string' })
    .requires('cache', 'mirror')
    .action(() => {})
    .run({ process: mock });
  expect(status).toBe(2);
  expect(mock.stderr.text).toBe(
    'fetch: Option "--no-cache" requires option "--mirror". Supply it as well, or remove "--no-cache".\n',
  );
});

test('a broken requirement is one InputProblem that lists the option, then each needed option', async () => {
  const mock = mockProcess({ argv: ['get', '--password', 's', '--host', 'h'] });
  const get = new Command('get')
    .option('user', { type: 'string' })
    .option('password', { type: 'string' })
    .option('host', { type: 'string' })
    .requires('password', 'user', 'host')
    .action(() => {});
  const status = await new Application('login', {
    views: [override(InputError, { render: (error) => JSON.stringify(error.problems) })],
  })
    .command(get)
    .run({ process: mock });
  expect(status).toBe(2);
  expect(JSON.parse(mock.stderr.text)).toEqual([
    {
      inputs: [
        { global: false, kind: 'option', name: 'password' },
        { global: false, kind: 'option', name: 'user' },
        { global: false, kind: 'option', name: 'host' },
      ],
      reason: 'requires',
      spellings: ['--password', '--user', '--host'],
      supplied: ['--password', '--host'],
    },
  ]);
});

test('a requirement that holds a member an exclusive group withdrew is not checked', async () => {
  const { binding, source } = loginSource({ user: 'ada' });
  let seen: Record<string, unknown> | undefined = undefined;
  const mock = mockProcess({ argv: ['--token', 't', '--password', 's'] });
  const status = await new Application('login', { plugins: [source] })
    .option('user', { extensions: [binding('user')], type: 'string' })
    .option('token', { type: 'string' })
    .option('password', { type: 'string' })
    .exclusive('token', 'user')
    .requires('password', 'user')
    .action(({ options }) => {
      seen = { ...options };
    })
    .run({ process: mock });
  expect(mock.stderr.text).toBe('');
  expect(status).toBe(0);
  expect(seen).toMatchObject({ password: 's', token: 't', user: undefined });
});

test('a needed option whose configuration request went unanswered is not named as lacking', async () => {
  const binding = extension('@test/unanswered/key', { schema: z.string(), target: 'option' });
  const source = plugin('@test/unanswered', {
    extensions: [binding],
    options: {
      config: { type: 'string', validate: z.literal('good', { error: 'Use good.' }) },
    },
    source: {
      binding,
      load: async () => ({
        default: async () => {
          throw new Error('Must not load.');
        },
      }),
    },
  });
  const run = async (needed: ['user', ...'host'[]]) => {
    const mock = mockProcess({ argv: ['--config', 'bad', '--password', 's'] });
    await new Application('login', { plugins: [source] })
      .option('user', { extensions: [binding('user')], type: 'string' })
      .option('password', { type: 'string' })
      .option('host', { type: 'string' })
      .requires('password', ...needed)
      .action(() => {})
      .run({ process: mock });
    return mock.stderr.text;
  };
  await expect(run(['user', 'host'])).resolves.toBe(
    'login: Option "--config": Use good.\nlogin: Option "--password" requires option "--host". Supply it as well, or remove "--password".\n',
  );
  await expect(run(['user'])).resolves.toBe('login: Option "--config": Use good.\n');
});

test('a requirement declared on a Command, by a hook, and through an option set is checked', async () => {
  const hook = plugin('@test/requires-hook', {
    onCommandAttach: (command) =>
      command.name === 'hooked'
        ? command
            .option('user', { type: 'string' })
            .option('password', { type: 'string' })
            .requires('password', 'user')
        : command,
  });
  const credentials = optionSet({
    password: { type: 'string' },
    user: { type: 'string' },
  }).requires('password', 'user');
  const application = new Application('login', { plugins: [hook] })
    .command(
      new Command('own')
        .option('user', { type: 'string' })
        .option('password', { type: 'string' })
        .requires('password', 'user')
        .action(() => {}),
    )
    .command(new Command('hooked').action(() => {}))
    .command(new Command('shared').options(credentials).action(() => {}));
  for (const name of ['own', 'hooked', 'shared']) {
    const mock = mockProcess({ argv: [name, '--password', 's'] });
    await expect(application.run({ process: mock })).resolves.toBe(2);
    expect(mock.stderr.text).toBe(
      'login: Option "--password" requires option "--user". Supply it as well, or remove "--password".\n',
    );
  }
});

test('inspection publishes each requirement as a frozen entry that names each side', () => {
  const credentials = optionSet({
    host: { type: 'string' },
    password: { type: 'string' },
    user: { type: 'string' },
  }).requires('password', 'user', 'host');
  const graph = new Application('login')
    .option('json', { type: 'boolean' })
    .option('yaml', { type: 'boolean' })
    .exclusive('json', 'yaml')
    .options(credentials)
    .action(() => {})
    .inspect();
  const groups = graph.root.optionGroups;
  expect(groups).toEqual([
    { kind: 'exclusive', options: ['json', 'yaml'] },
    { kind: 'requires', option: 'password', requires: ['user', 'host'] },
  ]);
  const [, requirement] = groups;
  expect(Object.isFrozen(requirement)).toBe(true);
  expect(requirement?.kind === 'requires' && Object.isFrozen(requirement.requires)).toBe(true);
});

/** The Developer Diagnostic a declaring call throws, or a note that it threw nothing. */
function thrown(declare: () => unknown): string {
  try {
    declare();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'nothing thrown';
}

/** The sentence and correction of one Developer Diagnostic, and the rule it names. */
function faultOf(message: string): {
  correction: string | undefined;
  identity: string | undefined;
  sentence: string | undefined;
} {
  const lines = message.split('\n');
  return {
    correction: lines.at(-1),
    identity: /(?<identity>@loomcli\/core\/[a-z-]+)$/u.exec(lines[0] ?? '')?.groups?.identity,
    sentence: lines[2],
  };
}

const credentialsCommand = new Command('login')
  .option('user', { type: 'string' })
  .option('password', { type: 'string' })
  .option('token', { type: 'string' });

test.each<[string, () => unknown, string, string]>([
  [
    'an undeclared name',
    // @ts-expect-error TS2345: The probe names an option the Command does not declare.
    () => credentialsCommand.requires('password', 'host'),
    'Command "login" requires names undeclared local option "host".',
    'Declare the local option before naming it in a group.',
  ],
  [
    'a repeated name',
    () => credentialsCommand.requires('password', 'user', 'user'),
    'Command "login" requires repeats option "user".',
    'Name each option once.',
  ],
  [
    'an option that requires itself',
    () => credentialsCommand.requires('password', 'password'),
    'Command "login" requires names option "password" as its own requirement.',
    'Name only other local options after the first.',
  ],
  [
    'the option repeated among several needed options',
    () => credentialsCommand.requires('password', 'user', 'password'),
    'Command "login" requires names option "password" as its own requirement.',
    'Name only other local options after the first.',
  ],
  [
    'a requirement after an exclusive group over two of its members',
    () => credentialsCommand.exclusive('user', 'token').requires('password', 'user', 'token'),
    'Command "login" exclusive and requires groups share at least two options.',
    'Remove one of the conflicting group rules.',
  ],
  [
    'an exclusive group after a requirement over two of its members',
    () => credentialsCommand.requires('password', 'user').exclusive('user', 'password'),
    'Command "login" exclusive and requires groups share at least two options.',
    'Remove one of the conflicting group rules.',
  ],
])('%s fails at the requires() call', (_case, declare, sentence, correction) => {
  expect(faultOf(thrown(declare))).toEqual({
    correction,
    identity: '@loomcli/core/option-group',
    sentence,
  });
});

test.each<[string, () => unknown, string, string]>([
  [
    'an option that requires itself',
    () =>
      optionSet({ password: { type: 'string' }, user: { type: 'string' } }).requires(
        'password',
        'password',
      ),
    'An option set requires names option "password" as its own requirement.',
    'Name only other local options after the first.',
  ],
  [
    'a repeated name',
    () =>
      optionSet({ password: { type: 'string' }, user: { type: 'string' } }).requires(
        'password',
        'user',
        'user',
      ),
    'An option set requires repeats option "user".',
    'Name each option once.',
  ],
  [
    'a requirement after an exclusive group over two of its members',
    () =>
      optionSet({ password: { type: 'string' }, user: { type: 'string' } })
        .exclusive('password', 'user')
        .requires('password', 'user'),
    'An option set exclusive and requires groups share at least two options.',
    'Remove one of the conflicting group rules.',
  ],
])("%s fails at a set's requires() call", (_case, declare, sentence, correction) => {
  expect(faultOf(thrown(declare))).toEqual({
    correction,
    identity: '@loomcli/core/option-group',
    sentence,
  });
});

test('a global option is no member of a requirement', () => {
  const root = new Application('login')
    .globalOption('verbose', { type: 'boolean' })
    .option('password', { type: 'string' });
  expect(
    faultOf(
      thrown(() =>
        // @ts-expect-error TS2345: The probe names a global option.
        root.requires('password', 'verbose'),
      ),
    ).sentence,
  ).toBe('The root Command requires names undeclared local option "verbose".');
});

test('two requirements that need each other, and a requirement repeated, are allowed', () => {
  expect(
    thrown(() =>
      credentialsCommand
        .requires('password', 'user')
        .requires('user', 'password')
        .requires('password', 'user'),
    ),
  ).toBe('nothing thrown');
});
