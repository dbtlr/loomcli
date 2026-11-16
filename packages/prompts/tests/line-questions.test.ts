/*
 * Acceptance plan for questions asked line by line (docs/libs/prompts.md#asking-line-by-line,
 * ADR-0169). Each case runs an Application on a mock process in the test's own process, under Node
 * and Bun, with `ACCESSIBLE` set unless the case names another switch. The mock's keyboard does
 * not echo, so `mock.stderr.text` holds exactly the pieces the questions printed:
 *
 * - Text. `Project name [my-app]: `, where Enter alone takes the prefill and a typed line replaces
 *   it, and `Project name: ` without one, where Enter alone answers the empty string. A rejected
 *   answer prints `✘` and the validator's sentence on a row of its own and the asking row again.
 *   Backspace removes the last grapheme, and a sequence such as an arrow adds nothing.
 * - Secret. `Token: `, in raw mode, then the line break the terminal did not echo, with no cursor
 *   or bracketed paste sequence.
 * - Confirm. `[y/N]` with a prefill, `[y/n]` without one, where Enter alone is refused with
 *   `Type y or n.`
 * - Select. The message, the numbered list, a disabled choice listed without a number and a
 *   separator without one, and `Enter a number [2]: ` with the prefill's number, where Enter alone
 *   takes it, a number chooses, and any other line is refused. A supplied value that selects
 *   nothing prints its issue once before the asking row.
 * - Multiselect. `Enter numbers separated by commas [1,3]: `, where Enter alone takes the
 *   prefill, a line of numbers chooses in its order, and min and max refuse a line. The linked
 *   validator's refusal prints and the asking row follows, not the list.
 * - Search. `Search: `, the matches as a numbered list, and
 *   `Enter a number, or text to search again: `, where a number chooses and any other line is a
 *   new term; a term that matches nothing prints `No matches` and asks `Search: ` again; a source
 *   is called once for each term.
 * - Editor. Its frames print once each: the asking frame, the editing frame and a line break, and
 *   the answered line.
 * - Leaving. Ctrl-C prints the cancelled line on a row of its own and ends the run with 130, and
 *   Ctrl-D on an empty line cancels. Ctrl-Z prints the asking row again at the resume.
 * - Turns. Two questions asked at once print one after the other.
 * - The switches. `ACCESSIBLE`, `--plain`, and `TERM=dumb` print the same transcript; under CI a
 *   question does not ask, with or without the switch; `-q` still hides the info lane, `--no-input`
 *   still turns questions off, and `NO_COLOR` and `FORCE_COLOR` still decide color.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, style } from '@loomcli/core';
import type { Out, Plugin, StandardSchemaV1 } from '@loomcli/core';
import { interaction } from '@loomcli/plugins/interaction';
import { plain } from '@loomcli/plugins/plain';
import { theme } from '@loomcli/plugins/theme';
import { verbose } from '@loomcli/plugins/verbose';
import { editor, multiselect, secret, confirm, select, text } from '@loomcli/prompts';
import type { PromptContext } from '@loomcli/prompts';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/** A Standard Schema that answers each value with `answer`. */
function schema<Output>(
  answer: (value: unknown) => StandardSchemaV1.Result<Output>,
): StandardSchemaV1<string, Output> {
  return { '~standard': { validate: answer, vendor: 'fixture', version: 1 } };
}

/** A port validator, which refuses anything but digits. */
const port = schema<number>((value) =>
  typeof value === 'string' && /^\d+$/u.test(value)
    ? { value: Number(value) }
    : { issues: [{ message: 'Expected a port number.' }] },
);

/** The context a case asks through: the application's, with its `--backend` option. */
type Asking = PromptContext<{ readonly backend: string | undefined }> & {
  readonly out: Pick<Out, 'info'>;
};

/** What one run asked, answered, and printed. */
interface Asked {
  readonly code: number;
  readonly answers: unknown[];
  readonly stderr: string;
  /** Whether a reader held the keyboard in raw mode once the run ended. */
  readonly rawAfter: boolean;
}

/**
 * Runs `ask` once on a mock terminal whose keyboard types `keys`, with `ACCESSIBLE` set unless
 * `env` or `argv` says otherwise, and records each answer it resolves to.
 */
async function asked(
  keys: readonly (string | readonly string[])[],
  ask: (context: Asking, answers: unknown[], raw: () => boolean) => Promise<void>,
  facts: {
    env?: Record<string, string>;
    argv?: string[];
    styled?: boolean;
    plugins?: readonly Plugin[];
  } = {},
): Promise<Asked> {
  const answers: unknown[] = [];
  // Unstyled unless a case is about style, so a transcript reads as the plain text it prints.
  const rendering = facts.styled ? {} : ({ color: 'never', modifiers: 'never' } as const);
  const plugins = [plain(), interaction(), verbose(), ...(facts.plugins ?? [])];
  const app = new Application('setup', { plugins, rendering })
    .option('backend', { type: 'string' })
    .action(async (context) => {
      await ask(context, answers, () => mock.stdin.isRaw);
    });
  const mock = mockProcess({
    argv: facts.argv ?? [],
    env: facts.env ?? { ACCESSIBLE: '1' },
    terminal: { columns: 80, keys, rows: 24 },
  });
  const code = await app.run({ process: mock });
  return { answers, code, rawAfter: mock.stdin.isRaw, stderr: mock.stderr.text };
}

/** Any cursor movement, erasure, cursor visibility, or bracketed paste sequence, or a lone CR. */
const escape = String.fromCodePoint(27);
const redraw = new RegExp(
  `${escape}\\[[0-9;?]*[ABCDEFGHJKSTfsu]|${escape}\\[\\?(?:25|2004)[hl]|${escape}[78]|\\r(?!\\n)`,
  'u',
);

test.each([
  { answer: 'my-app', keys: ['\r'] },
  { answer: 'notes', keys: ['notes\r'] },
])('text prints its prefill in brackets, and $keys answers $answer', async ({ answer, keys }) => {
  const run = await asked(keys, async (context, answers) => {
    answers.push(await text(context, { default: 'my-app', message: 'Project name' }));
  });
  expect(run).toMatchObject({ answers: [answer], code: 0, stderr: 'Project name [my-app]: ' });
});

test('text without a prefill shows no brackets, and Enter alone answers the empty string', async () => {
  const run = await asked(['\r'], async (context, answers) => {
    answers.push(await text(context, { message: 'Project name' }));
  });
  expect(run).toMatchObject({ answers: [''], code: 0, stderr: 'Project name: ' });
});

test('a rejected answer prints the sentence on a row of its own and asks again', async () => {
  const run = await asked(['80800x\r', '8080\r'], async (context, answers) => {
    answers.push(await text(context, { message: 'Service port', validate: port }));
  });
  expect(run).toMatchObject({
    answers: [8080],
    code: 0,
    stderr: 'Service port: ✘ Expected a port number.\nService port: ',
  });
});

test('Backspace removes the last grapheme, and an arrow key adds nothing', async () => {
  const run = await asked(['ab\u007fc\u001b[Dd👍🏽\u007f\r'], async (context, answers) => {
    answers.push(await text(context, { message: 'Name' }));
  });
  expect(run.answers).toEqual(['acd']);
});

test('one entry answers two questions, as a terminal hands over typed-ahead lines', async () => {
  const run = await asked(['first\rsecond\r'], async (context, answers) => {
    answers.push(await text(context, { message: 'One' }));
    answers.push(await text(context, { message: 'Two' }));
  });
  expect(run).toMatchObject({ answers: ['first', 'second'], code: 0, stderr: 'One: Two: ' });
});

test('a secret reads in raw mode, echoes nothing, and prints the line break itself', async () => {
  const run = await asked(['s3cret\r'], async (context, answers, raw) => {
    // The validator runs while the secret still holds the keyboard.
    const holding = schema<string>((value) => {
      answers.push(raw());
      return { value: String(value) };
    });
    answers.push(await secret(context, { message: 'Token', validate: holding }));
    answers.push(raw());
  });
  expect(run).toMatchObject({
    answers: [true, 's3cret', false],
    code: 0,
    rawAfter: false,
    stderr: 'Token: \n',
  });
});

test('a secret refused by its validator prints the sentence and asks again', async () => {
  const long = schema<string>((value) =>
    String(value).length >= 4 ? { value: String(value) } : { issues: [{ message: 'Too short.' }] },
  );
  // Raw mode holds for the whole secret, so one entry holds both answers, and the rest is dropped.
  const run = await asked(['ab\rabcd\rleft\r', 'name\r'], async (context, answers) => {
    answers.push(await secret(context, { message: 'Token', validate: long }));
    answers.push(await text(context, { message: 'Name' }));
  });
  expect(run).toMatchObject({
    answers: ['abcd', 'name'],
    code: 0,
    stderr: 'Token: \n✘ Too short.\nToken: \nName: ',
  });
});

test.each([
  { answer: false, default: false, keys: ['\r'], stderr: 'Deploy now? [y/N]: ' },
  { answer: true, default: false, keys: ['YES\r'], stderr: 'Deploy now? [y/N]: ' },
  {
    answer: true,
    default: undefined,
    keys: ['\r', 'y\r'],
    stderr: 'Deploy now? [y/n]: ✘ Type y or n.\nDeploy now? [y/n]: ',
  },
])('confirm with default $default and $keys prints $stderr', async (scenario) => {
  const run = await asked(scenario.keys, async (context, answers) => {
    answers.push(
      await confirm(context, {
        message: 'Deploy now?',
        ...(scenario.default === undefined ? {} : { default: scenario.default }),
      }),
    );
  });
  expect(run).toMatchObject({ answers: [scenario.answer], code: 0, stderr: scenario.stderr });
});

/** A select's choices: a separator, a disabled choice with a reason, and a description. */
const backends = [
  'sqlite',
  { separator: 'Hosted' },
  { description: 'needs a server', label: 'PostgreSQL', value: 'postgres' },
  { disabled: 'needs an account', label: 'Neon', value: 'neon' },
  'mysql',
] as const;

/** The list a select of `backends` prints. */
const backendList =
  'Storage backend\n  1. sqlite\n  Hosted\n  2. PostgreSQL · needs a server\n  Neon (needs an account)\n  3. mysql\n';

test.each([
  { answer: 'postgres', keys: ['\r'] },
  { answer: 'mysql', keys: ['3\r'] },
  { answer: 'sqlite', keys: [' 1 \r'] },
])('a select prints its numbered list, and $keys chooses $answer', async ({ answer, keys }) => {
  const run = await asked(keys, async (context, answers) => {
    answers.push(
      await select(context, { choices: backends, default: 'postgres', message: 'Storage backend' }),
    );
  });
  expect(run).toMatchObject({
    answers: [answer],
    code: 0,
    stderr: `${backendList}Enter a number [2]: `,
  });
});

test('a select refuses a number outside the list, and the asking row follows, not the list', async () => {
  const run = await asked(['4\r', 'neon\r', '1\r'], async (context, answers) => {
    answers.push(await select(context, { choices: backends, message: 'Storage backend' }));
  });
  expect(run).toMatchObject({
    answers: ['sqlite'],
    code: 0,
    stderr: `${backendList}Enter a number [1]: ✘ Type a number from 1 to 3.\nEnter a number [1]: ✘ Type a number from 1 to 3.\nEnter a number [1]: `,
  });
});

test('a supplied value a select cannot choose prints its issue once before the asking row', async () => {
  const run = await asked(
    ['\r'],
    async (context, answers) => {
      answers.push(
        await select(context, {
          choices: backends,
          message: 'Storage backend',
          option: 'backend',
        }),
      );
    },
    { argv: ['--backend', 'neon'], env: { ACCESSIBLE: '1' } },
  );
  expect(run).toMatchObject({
    answers: ['sqlite'],
    code: 0,
    stderr: `${backendList}✘ Cannot select "neon". Choose from the list.\nEnter a number [1]: `,
  });
});

/** A multiselect's features. */
const features = ['backups', 'telemetry', 'metrics', 'alerts'];

test.each([
  { answer: ['backups', 'metrics'], keys: ['\r'] },
  { answer: ['telemetry', 'backups'], keys: ['2, 1,2,\r'] },
])('a multiselect takes $keys as $answer', async ({ answer, keys }) => {
  const run = await asked(keys, async (context, answers) => {
    answers.push(
      await multiselect(context, {
        choices: features,
        default: ['backups', 'metrics'],
        message: 'Features',
      }),
    );
  });
  expect(run).toMatchObject({
    answers: [answer],
    code: 0,
    stderr:
      'Features\n  1. backups\n  2. telemetry\n  3. metrics\n  4. alerts\nEnter numbers separated by commas [1,3]: ',
  });
});

test('a multiselect refuses a line outside its limits, and Enter alone submits nothing when allowed', async () => {
  const run = await asked(['x\r', '\r', '1,2,3\r', '4\r'], async (context, answers) => {
    answers.push(
      await multiselect(context, { choices: features, max: 2, message: 'Features', min: 1 }),
    );
  });
  const row = 'Enter numbers separated by commas: ';
  expect(run).toMatchObject({
    answers: [['alerts']],
    code: 0,
    stderr: `Features\n  1. backups\n  2. telemetry\n  3. metrics\n  4. alerts\n${row}✘ Type numbers from 1 to 4, separated by commas.\n${row}✘ Choose at least 1.\n${row}✘ Choose at most 2.\n${row}`,
  });
  const empty = await asked(['\r'], async (context, answers) => {
    answers.push(await multiselect(context, { choices: features, message: 'Features' }));
  });
  expect(empty.answers).toEqual([[]]);
});

test('the linked validator refuses a choice, and the asking row follows', async () => {
  const app = new Application('setup', { rendering: { color: 'never', modifiers: 'never' } })
    .option('feature', {
      multiple: true,
      type: 'string',
      validate: schema<string>((value) =>
        value === 'telemetry'
          ? { issues: [{ message: 'Not available on this plan.' }] }
          : { value: String(value) },
      ),
    })
    .action(async (context) => {
      await context.out.print(
        JSON.stringify(
          await multiselect(context, { choices: features, message: 'Features', option: 'feature' }),
        ),
      );
    });
  const mock = mockProcess({
    env: { ACCESSIBLE: '1' },
    terminal: { columns: 80, keys: ['1,2\r', '1\r'], rows: 24 },
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stdout.text).toBe('["backups"]\n');
  expect(mock.stderr.text).toBe(
    'Features\n  1. backups\n  2. telemetry\n  3. metrics\n  4. alerts\nEnter numbers separated by commas: ✘ telemetry: Not available on this plan.\nEnter numbers separated by commas: ',
  );
});

test('a search asks for a term, prints the matches, and a number chooses from them', async () => {
  const run = await asked(['e\r', 'zzz\r', 'al\r', '1\r'], async (context, answers) => {
    answers.push(await select(context, { choices: features, message: 'Feature', search: true }));
  });
  const refine = 'Enter a number, or text to search again: ';
  expect(run).toMatchObject({
    answers: ['alerts'],
    code: 0,
    stderr: `Feature\nSearch:   1. telemetry\n  2. metrics\n  3. alerts\n${refine}  No matches\n✘ No choice can be selected. Change the search.\nSearch:   1. alerts\n${refine}`,
  });
});

test('a source is called once for each term, with a signal the next call aborts', async () => {
  const terms: string[] = [];
  const signals: AbortSignal[] = [];
  const run = await asked(['\r', 'post\r', '1,\r'], async (context, answers) => {
    answers.push(
      await multiselect(context, {
        message: 'Backend',
        source: async (term, { signal }) => {
          terms.push(term);
          signals.push(signal);
          return ['sqlite', 'postgres'].filter((name) => name.includes(term));
        },
      }),
    );
  });
  expect(run).toMatchObject({
    answers: [['postgres']],
    code: 0,
    stderr:
      'Backend\nSearch:   1. sqlite\n  2. postgres\nEnter a number, or text to search again:   1. postgres\nEnter a number, or text to search again: ',
  });
  expect(terms).toEqual(['', 'post']);
  expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
});

test('an editor prints each frame once, then the answered line', async () => {
  const app = new Application('edit', {
    rendering: { color: 'never', modifiers: 'never' },
  }).action(async (context) => {
    await context.out.print(await editor(context, { default: 'seed', message: 'Release notes' }));
  });
  const folder = mkdtempSync(join(tmpdir(), 'line-editor-'));
  try {
    const mock = mockProcess({
      env: { ACCESSIBLE: '1', EDITOR: 'nano', TMPDIR: folder },
      programs: { '/bin/sh': () => ({}) },
      terminal: { columns: 80, keys: ['ignored\r'], rows: 24 },
    });
    await expect(app.run({ process: mock })).resolves.toBe(0);
    expect(mock.stdout.text).toBe('seed\n');
    expect(mock.stderr.text).toBe(
      '? Release notes › Press Enter to open your editor? Release notes › Waiting for your editor to close the file…\n? Release notes · seed\n',
    );
  } finally {
    rmSync(folder, { force: true, recursive: true });
  }
});

test('an editor answer its validator refuses prints the issue and the asking frame again', async () => {
  const saved = ['draft', 'Final notes'];
  const app = new Application('edit', {
    rendering: { color: 'never', modifiers: 'never' },
  }).action(async (context) => {
    const notes = await editor(context, {
      message: 'Release notes',
      validate: schema<string>((value) =>
        value === 'draft'
          ? { issues: [{ message: 'Write the notes.' }] }
          : { value: String(value) },
      ),
    });
    await context.out.print(notes);
  });
  const folder = mkdtempSync(join(tmpdir(), 'line-editor-'));
  try {
    const mock = mockProcess({
      env: { ACCESSIBLE: '1', EDITOR: 'nano', TMPDIR: folder },
      programs: {
        '/bin/sh': ({ args }) => {
          writeFileSync(args[3] ?? '', saved.shift() ?? '');
          return {};
        },
      },
      terminal: { columns: 80, keys: ['\r', '\r'], rows: 24 },
    });
    await expect(app.run({ process: mock })).resolves.toBe(0);
    expect(mock.stdout.text).toBe('Final notes\n');
    const asking = '? Release notes › Press Enter to open your editor';
    const editing = '? Release notes › Waiting for your editor to close the file…\n';
    expect(mock.stderr.text).toBe(
      `${asking}${editing}✘ Write the notes.\n${asking}${editing}? Release notes · Final notes\n`,
    );
  } finally {
    rmSync(folder, { force: true, recursive: true });
  }
});

test('Ctrl-C prints the cancelled line on a row of its own and ends the run with 130', async () => {
  const run = await asked(['ab\u0003'], async (context, answers) => {
    answers.push(await text(context, { message: 'Name' }));
  });
  expect(run).toMatchObject({ answers: [], code: 130, stderr: 'Name: \n? Name · cancelled\n' });
});

test('Ctrl-D on an empty line cancels the question', async () => {
  const run = await asked(['\u0004'], async (context, answers) => {
    answers.push(await text(context, { message: 'Name' }));
  });
  expect(run).toMatchObject({ code: 130, stderr: 'Name: \n? Name · cancelled\n' });
});

test('Ctrl-Z discards the line typed so far and prints the asking row again at the resume', async () => {
  const run = await asked(['ab\u001a', 'cd\r'], async (context, answers) => {
    answers.push(await text(context, { message: 'Name' }));
  });
  expect(run).toMatchObject({ answers: ['cd'], code: 0, stderr: 'Name: Name: ' });
});

test('two questions asked at once take turns', async () => {
  const run = await asked(['a\rb\r'], async (context, answers) => {
    answers.push(
      ...(await Promise.all([
        text(context, { message: 'First' }),
        text(context, { message: 'Second' }),
      ])),
    );
  });
  expect(run).toMatchObject({ answers: ['a', 'b'], code: 0, stderr: 'First: Second: ' });
});

test('a test that scripts too few keys fails rather than waits', async () => {
  const run = await asked(['a\r'], async (context) => {
    await text(context, { message: 'First' });
    await text(context, { message: 'Second' });
  });
  expect(run.code).toBe(1);
  expect(run.stderr).toContain('mockProcess has no keys left for this read.');
});

/** Every kind asked once, as the switches below compare it. */
async function everyKind(context: Asking, answers: unknown[]): Promise<void> {
  await context.out.info('Setting up.');
  answers.push(await text(context, { default: 'my-app', message: 'Project name' }));
  answers.push(await secret(context, { message: 'Token' }));
  answers.push(await confirm(context, { default: false, message: 'Deploy now?' }));
  answers.push(await select(context, { choices: backends, message: 'Storage backend' }));
  answers.push(await multiselect(context, { choices: features, message: 'Features' }));
  answers.push(await select(context, { choices: features, message: 'Feature', search: true }));
}

/** The keys that answer `everyKind`. */
const everyKey = ['\r', 'token\r', 'y\r', '2\r', '1,4\r', 'ics\r', '1\r'];

/** What `everyKind` prints with the switch on. */
const everyLine = `ℹ Setting up.\nProject name [my-app]: Token: \nDeploy now? [y/N]: ${backendList}Enter a number [1]: Features\n  1. backups\n  2. telemetry\n  3. metrics\n  4. alerts\nEnter numbers separated by commas: Feature\nSearch:   1. metrics\nEnter a number, or text to search again: `;

test.each([
  { argv: [], env: { ACCESSIBLE: '1' } },
  { argv: ['--plain'], env: {} },
  { argv: [], env: { TERM: 'dumb' } },
])('with argv $argv and $env, every kind asks line by line alike', async ({ argv, env }) => {
  const run = await asked(everyKey, everyKind, { argv, env });
  expect(run.code).toBe(0);
  expect(run.answers).toEqual([
    'my-app',
    'token',
    true,
    'postgres',
    ['backups', 'alerts'],
    'metrics',
  ]);
  expect(run.stderr).toBe(everyLine);
  expect(run.stderr).not.toMatch(redraw);
});

/** One run of an unlinked text question, which fails where the run may not ask. */
async function unasked(facts: { env: Record<string, string>; argv?: string[] }) {
  const run = await asked(
    [],
    async (context, answers) => {
      answers.push(await text(context, { message: 'Project name' }));
    },
    facts,
  );
  return { code: run.code, stderr: run.stderr };
}

test('under CI a question does not ask, with the switch on as with it off', async () => {
  const off = await unasked({ env: { CI: 'true' } });
  expect(off.code).toBe(1);
  expect(off.stderr).not.toContain('Project name:');
  await expect(unasked({ env: { ACCESSIBLE: '1', CI: 'true' } })).resolves.toEqual(off);
});

test('with the switch on, -q hides the info lane and the questions still ask', async () => {
  const run = await asked(everyKey, everyKind, { argv: ['-q'], env: { ACCESSIBLE: '1' } });
  expect(run.code).toBe(0);
  expect(run.stderr).toBe(everyLine.replace('ℹ Setting up.\n', ''));
});

test('with the switch on, --no-input still turns questions off', async () => {
  const off = await unasked({ argv: ['--no-input'], env: {} });
  expect(off.code).toBe(1);
  expect(off.stderr).not.toContain('Project name:');
  await expect(unasked({ argv: ['--no-input'], env: { ACCESSIBLE: '1' } })).resolves.toEqual(off);
});

test.each(
  [
    { color: false, env: { NO_COLOR: '1' } },
    { color: true, env: { FORCE_COLOR: '1' } },
  ].map(({ color, env }) => ({
    color,
    env: { ACCESSIBLE: '1', COLORTERM: 'truecolor', TERM: 'xterm-256color', ...env },
  })),
)('with the switch on and $env, a refused answer carries color $color', async ({ color, env }) => {
  const run = await asked(
    ['x\r', '8080\r'],
    async (context, answers) => {
      answers.push(await text(context, { message: 'Service port', validate: port }));
    },
    { env, plugins: [theme({ error: style.red })], styled: true },
  );
  expect(run.code).toBe(0);
  // A foreground color is SGR 31 through 37 or 90 through 97, or an extended 38.
  expect(new RegExp(`${escape}\\[(?:3[1-8]|9[0-7])[;m]`, 'u').test(run.stderr)).toBe(color);
  expect(run.stderr).not.toMatch(redraw);
});
