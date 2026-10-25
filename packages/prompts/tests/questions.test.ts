// Acceptance plan: see packages/prompts/tests/interactive.test.ts.

import { Application, DeclarationError, override } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { dateTime, path } from '@loomcli/validators';
import { expect, test } from 'vite-plus/test';

import { confirm, secret, select, text } from '../src/index.js';
import type { PromptContext } from '../src/types.js';
import { questionFrame } from '../src/views.js';
import { observing } from './support.js';

/** A Standard Schema that answers each value with `answer`. */
function schema<Input, Output>(
  answer: (value: unknown) => StandardSchemaV1.Result<Output>,
): StandardSchemaV1<Input, Output> {
  return { '~standard': { validate: answer, vendor: 'fixture', version: 1 } };
}

/** The application of the linked-question scenarios: a port, a flag, and a question for each. */
function setup(scenario: string) {
  return new Application('setup', { description: 'Set up the service.' })
    .option('port', {
      description: 'Service port.',
      type: 'string',
      validate: schema<string, number>((value) => ({ value: Number(value) })),
    })
    .option('install', { description: 'Install the service.', type: 'boolean' })
    .action(async (context) => {
      if (scenario === 'named-boolean-missing') {
        await confirm(context, { message: 'Install service?', option: 'install' });
        return;
      }
      if (scenario === 'unlinked' || scenario === 'named-unlinked') {
        await text(context, { message: 'Name' });
        return;
      }
      const value = await text(context, {
        message: 'Service port',
        option: 'port',
        validate: schema<string, never>(() => {
          throw new Error('Question validation must not run.');
        }),
      });
      await context.out.print(JSON.stringify(value));
    });
}

/** One run of a linked-question scenario on a mock with piped, empty stdin. */
async function runSetup(scenario: string, argv: string[] = []) {
  const mock = mockProcess({ argv });
  const code = await setup(scenario).run({ process: mock });
  return { code, mock };
}

/** One malformed question per scenario, asked from an application that reports the fault it catches. */
const faults: Record<
  string,
  (context: PromptContext<Record<string, unknown>>) => Promise<unknown>
> = {
  'confirm-string': (context) => confirm(context, { message: 'Continue?', option: 'name' }),
  content: (context) => text(context, { message: 'File', option: 'file' }),
  count: (context) => text(context, { message: 'Level', option: 'level' }),
  empty: (context) => select(context, { choices: [], message: 'Mode' }),
  global: (context) => text(context, { message: 'Name', option: 'global' }),
  multiple: (context) => text(context, { message: 'Tags', option: 'tags' }),
  unknown: (context) => text(context, { message: 'Name', option: 'unknown' }),
};

/** The parts of the declaration fault the scenario's question throws at its call. */
async function fault(scenario: string) {
  const mock = mockProcess();
  const app = new Application('faults', { description: 'Exercise malformed questions.' })
    .globalOption('global', { description: 'Global value.', type: 'string' })
    .option('name', { description: 'Name.', type: 'string' })
    .option('tags', { description: 'Tags.', multiple: true, type: 'string' })
    .option('level', { description: 'Level.', type: 'count' })
    .option('file', { description: 'File.', type: 'content' })
    .action(async (context) => {
      try {
        await faults[scenario]?.(context);
        await context.out.print('accepted');
      } catch (error) {
        if (!(error instanceof DeclarationError)) {
          throw error;
        }
        await context.out.print(
          JSON.stringify({
            correction: error.correction,
            name: error.name,
            rule: error.rule?.identity,
            sentence: error.sentence,
          }),
        );
      }
    });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stderr.text).toBe('');
  return JSON.parse(mock.stdout.text);
}

test('a linked question returns the validated supplied option silently without prompt validation', async () => {
  const { code, mock } = await runSetup('linked', ['--port', '8080']);
  expect(code).toBe(0);
  expect(mock.stderr.text).toBe('');
  expect(mock.stdout.text).toBe('8080\n');
});

test.each(['empty', 'unknown', 'global', 'multiple', 'count', 'content', 'confirm-string'])(
  'malformed questions fail at their call with the question declaration rule: %s',
  async (scenario) => {
    await expect(fault(scenario)).resolves.toMatchObject({
      name: 'DeclarationError',
      rule: '@loomcli/prompts/link',
    });
  },
);

test('a select question with no choices states its fault and its correction', async () => {
  await expect(fault('empty')).resolves.toEqual({
    correction: 'Supply at least one choice.',
    name: 'DeclarationError',
    rule: '@loomcli/prompts/link',
    sentence: 'The select question "Mode" has no choices.',
  });
});

test('a missing linked value reports an ordinary usage failure', async () => {
  const { code, mock } = await runSetup('missing');
  expect(code).toBe(2);
  expect(mock.stderr.text).toContain(
    'Option "--port" is required when input is not interactive. Supply a value.',
  );
});

test('an unlinked question cannot resolve without interaction', async () => {
  const { code, mock } = await runSetup('unlinked');
  expect(code).toBe(1);
  expect(mock.stderr.text).toContain(
    'The question "Name" needs an interactive terminal, and this run is not interactive. Run "setup" at a terminal.',
  );
});

test.each([
  ['named-linked', { output: '8080\n', status: 'completed' }],
  [
    'named-missing',
    {
      exitCode: 2,
      form: { message: 'Option "port" is required when input is not interactive. Supply a value.' },
      status: 'failed',
    },
  ],
  ['named-unlinked', { exitCode: 1, form: { code: 'interaction-unavailable' }, status: 'failed' }],
  [
    'named-boolean-missing',
    {
      exitCode: 2,
      form: {
        message: 'Option "install" is required when input is not interactive. Supply a value.',
      },
      status: 'failed',
    },
  ],
])(
  'invocation by name uses the same noninteractive question rules: %s',
  async (scenario, outcome) => {
    const mock = mockProcess();
    const result = await setup(scenario).invoke(
      [],
      { options: scenario === 'named-linked' ? { port: '8080' } : {} },
      { process: mock },
    );
    expect(mock.stderr.text).toBe('');
    expect(result).toMatchObject(outcome);
  },
);

/** The keys each host scenario types: nothing for an abort or end of input, or the interrupt key. */
const hostKeys: Record<string, string[]> = {
  abort: [''],
  'ctrl-backslash': ['\u001c'],
  'ctrl-c': ['\u0003'],
  'ctrl-z': ['\u001a', '8080\r'],
  eof: [''],
  secret: ['secret-value\r'],
};

/** One run of a question beside a view override on a keyboard, with the state the run leaves it in. */
async function host(scenario: string) {
  const mock = mockProcess({
    terminal: { columns: 80, keys: hostKeys[scenario] ?? [], rows: 24, streams: ['stderr'] },
  });
  const caller = new AbortController();
  let secretVisible = false;
  let abortRestored = false;
  let scheduled = false;
  const app = new Application('setup', {
    description: 'Configure the service.',
    views: [
      override(questionFrame, {
        render: (data, context) => {
          if (data.kind === 'secret' && data.typed !== '') {
            secretVisible = true;
          }
          return `extra row\n${questionFrame.render(data, context)}`;
        },
      }),
    ],
  }).action(async (context) => {
    // The first frame is the question's opening, so the abort and the end of input come after it.
    const asked = {
      ...context,
      out: observing(context.out, () => {
        if (scheduled) {
          return;
        }
        scheduled = true;
        if (scenario === 'abort') {
          caller.abort('stop');
          abortRestored = !mock.stdin.isRaw;
        } else if (scenario === 'eof') {
          mock.stdin.push(null);
        }
      }),
    };
    const answer =
      scenario === 'secret'
        ? await secret(asked, { message: 'Secret' })
        : await text(asked, { message: 'Port' });
    await context.out.print(answer);
  });
  const code = await app.run({ process: mock, signal: caller.signal });
  return {
    abortRestored,
    code,
    listeners: ['data', 'end', 'close', 'error'].map((name) => mock.stdin.listenerCount(name)),
    messages: mock.stderr.text,
    mock,
    output: mock.stdout.text,
    paused: mock.stdin.isPaused(),
    raw: mock.stdin.isRaw,
    secretVisible,
  };
}

// Ctrl-\\ at a terminal raises SIGQUIT, whose cancellation code is 131, and it ends the mock's process.
test.each([
  ['abort', 130, 130, undefined],
  ['eof', 130, 130, undefined],
  ['ctrl-c', 130, 130, undefined],
  ['ctrl-backslash', 131, undefined, 'SIGQUIT'],
] as const)(
  'an embedding host cancels and synchronously restores terminal input on %s',
  async (scenario, code, exitCode, endedBy) => {
    const observed = await host(scenario);
    expect(observed.mock.exitCode).toBe(exitCode);
    expect(observed.mock.endedBy).toBe(endedBy);
    expect(observed).toMatchObject({
      code,
      listeners: [0, 0, 0, 0],
      output: '',
      paused: true,
      raw: false,
    });
    expect(observed.messages).toContain('cancelled');
    expect(observed.messages).toContain('\u001b[?25h');
    expect(observed.abortRestored).toBe(scenario === 'abort');
  },
);

test('Ctrl-Z suspends and resumes the run at the terminal, and the question goes on', async () => {
  const observed = await host('ctrl-z');
  expect(observed).toMatchObject({ code: 0, output: '8080\n', raw: false });
});

test('a frame override can add rows while secret text stays out of view data', async () => {
  const observed = await host('secret');
  expect(observed.mock.exitCode).toBe(0);
  expect(observed).toMatchObject({
    code: 0,
    listeners: [0, 0, 0, 0],
    output: 'secret-value\n',
    raw: false,
    secretVisible: false,
  });
  expect(observed.messages).toContain('extra row');
  expect(observed.messages).toContain('\r\u001b[1A\u001b[J');
  expect(observed.messages).not.toContain('secret-value');
});

test.each([
  ['callable', 'hello\r', 'HELLO'],
  ['path', 'notes.txt\r', '/workspace/notes.txt'],
  ['dateTime', '2026-10-15T10:30\r', '2026-10-15T08:30:00.000Z'],
])('question validation passes the captured host context to %s', async (scenario, keys, output) => {
  let answered: unknown = undefined;
  const callable = Object.assign((value: unknown) => value, {
    '~standard': schema<string, string>((value) =>
      typeof value === 'string'
        ? { value: value.toUpperCase() }
        : { issues: [{ message: 'Use text.' }] },
    )['~standard'],
  });
  const app = new Application('questions', { description: 'Validate question answers.' }).action(
    async (context) => {
      if (scenario === 'callable') {
        answered = await text(context, { message: 'Callable schema', validate: callable });
        return;
      }
      answered =
        scenario === 'path'
          ? await text(context, { message: 'File', validate: path() })
          : await text(context, { message: 'When', validate: dateTime() });
    },
  );
  const mock = mockProcess({
    cwd: '/workspace',
    platform: 'linux',
    terminal: { columns: 80, keys: [keys], rows: 24, streams: ['stderr'] },
    timeZone: 'Europe/Berlin',
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answered instanceof Date ? answered.toISOString() : answered).toBe(output);
});
