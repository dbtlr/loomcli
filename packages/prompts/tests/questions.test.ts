// Acceptance plan: see packages/prompts/tests/interactive.test.ts.

import { Readable, Writable } from 'node:stream';

import { Application, DeclarationError, override, processHandle } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { dateTime, path } from '@loomcli/validators';
import { expect, test, vi } from 'vite-plus/test';

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

/** The keys each host scenario types: nothing for an abort or end of input. */
const hostKeys: Record<string, string[]> = {
  abort: [''],
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
  let rawBeforeEof = false;
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
        // One turn later, the question's read is pending, so the cancel reaches a waiting read.
        setImmediate(() => {
          if (scenario === 'abort') {
            const wasRaw = mock.stdin.isRaw;
            caller.abort('stop');
            abortRestored = wasRaw && !mock.stdin.isRaw;
          } else if (scenario === 'eof') {
            rawBeforeEof = mock.stdin.isRaw;
            mock.stdin.push(null);
          }
        });
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
    rawBeforeEof,
    secretVisible,
  };
}

test.each(['abort', 'eof'])(
  'an embedding host cancels and synchronously restores terminal input on %s',
  async (scenario) => {
    const observed = await host(scenario);
    expect(observed.mock.exitCode).toBe(130);
    expect(observed.mock.endedBy).toBeUndefined();
    expect(observed).toMatchObject({
      code: 130,
      listeners: [0, 0, 0, 0],
      output: '',
      paused: true,
      raw: false,
    });
    expect(observed.messages).toContain('cancelled');
    expect(observed.messages).toContain('\u001b[?25h');
    expect(observed.abortRestored).toBe(scenario === 'abort');
    expect(observed.rawBeforeEof).toBe(scenario === 'eof');
  },
);

// An embedding host's scripted raw-mode stdin, not a mock's keyboard: it is not the real process's
// Terminal, so the branch of a reader whose stdin is another stream is reachable only through it.
class ScriptedStdin extends Readable {
  modes: boolean[] = [];
  get isRaw() {
    return this.modes.at(-1) === true;
  }
  _read() {}
  setRawMode(value: boolean) {
    this.modes.push(value);
    return this;
  }
}

/** One run of a question on an embedding host's stdin, which types `keys` once the question opens. */
async function embedded(keys: string) {
  const stdin = new ScriptedStdin();
  let messages = '';
  let output = '';
  let typed = false;
  const stderr = new Writable({
    write(chunk, _encoding, done) {
      messages += String(chunk);
      done();
    },
  });
  const stdout = new Writable({
    write(chunk, _encoding, done) {
      output += String(chunk);
      done();
    },
  });
  const app = new Application('setup', { description: 'Configure the service.' }).action(
    async (context) => {
      // The first frame is the question's opening, so the keys come after it.
      const asked = {
        ...context,
        out: observing(context.out, () => {
          if (!typed) {
            typed = true;
            // One turn later, the question's read is pending when the keys arrive.
            setImmediate(() => stdin.push(keys));
          }
        }),
      };
      await context.out.print(await text(asked, { message: 'Port' }));
    },
  );
  const handle = processHandle({
    argv: [],
    env: {},
    stderr,
    stdin,
    stdout,
    terminal: {
      stderr: { columns: 80, isTTY: true, rows: 24 },
      stdin: { isTTY: true },
      stdout: { columns: undefined, isTTY: false, rows: undefined },
    },
  });
  // The handle writes the run's code to the test process's exit code, which the test restores.
  const exitCode = process.exitCode;
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
  try {
    const code = await app.run({ process: handle });
    return {
      code,
      exitCode: handle.exitCode,
      killed: kill.mock.calls.length,
      listeners: ['data', 'end', 'close', 'error'].map((name) => stdin.listenerCount(name)),
      messages,
      modes: stdin.modes,
      output,
      paused: stdin.isPaused(),
      raw: stdin.isRaw,
    };
  } finally {
    kill.mockRestore();
    process.exitCode = exitCode;
  }
}

test.each([
  ['ctrl-c', '\u0003'],
  ['ctrl-backslash', '\u001c'],
])(
  'on a stdin that is not the process terminal, %s cancels the run through the action and raises no signal',
  async (_key, keys) => {
    const observed = await embedded(keys);
    expect(observed).toMatchObject({
      code: 130,
      exitCode: 130,
      killed: 0,
      listeners: [0, 0, 0, 0],
      modes: [true, false],
      output: '',
      paused: true,
      raw: false,
    });
    expect(observed.messages).toContain('cancelled');
    expect(observed.messages).toContain('\u001b[?25h');
  },
);

test('Ctrl-C at a question on a terminal whose TERM is dumb ends the run with no show-cursor sequence', async () => {
  const mock = mockProcess({
    env: { NO_COLOR: '1', TERM: 'dumb' },
    terminal: { columns: 60, keys: ['\u0003'], rows: 24 },
  });
  const app = new Application('ask').action(async (context) => {
    await text(context, { message: 'Service port' });
  });
  await expect(app.run({ process: mock })).resolves.toBe(130);
  // The shutdown ends, and restores the terminal, on the turn after the run resolves.
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  expect(mock.endedBy).toBe('SIGINT');
  expect(mock.stderr.text).toContain('Service port');
  expect(mock.stderr.text).not.toContain('\u001B[?25h');
});

test('Ctrl-Z on a stdin that is not the process terminal does nothing, and the question goes on', async () => {
  const observed = await embedded('\u001a8080\r');
  expect(observed).toMatchObject({ code: 0, exitCode: 0, killed: 0, output: '8080\n', raw: false });
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
