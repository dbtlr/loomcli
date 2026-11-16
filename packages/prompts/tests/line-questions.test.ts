/*
 * Acceptance plan for questions asked line by line (docs/libs/prompts.md#asking-line-by-line,
 * ADR-0169). Each case runs an Application on a mock process in the test's own process, under Node
 * and Bun, with `ACCESSIBLE` set unless the case names another switch. Every kind reads its keys in
 * raw mode through the run's one key reader, so the mock's keyboard hands over an entry at each
 * switch to raw mode, as it does for a question that redraws, and `mock.stderr.text` holds the
 * pieces the questions printed and the question's own echo of what was typed:
 *
 * - Text. `Project name [my-app]: `, where Enter alone takes the prefill and a typed line replaces
 *   it, and `Project name: ` without one, where Enter alone answers the empty string. A rejected
 *   answer prints `✘` and the validator's sentence on a row of its own and the asking row again.
 * - The echo. Each typed character is written after the asking row once the question reads it,
 *   and Enter writes the line break. Backspace, Ctrl-U, and Ctrl-W write `\b \b` for each cell the
 *   removed text took, and a key that types nothing, an arrow, an SS3 key, an Alt chord, or an OSC
 *   string, writes nothing and adds nothing. Keys typed ahead of a question's turn are echoed by
 *   that question, never earlier.
 * - Secret. `Token: `, in raw mode, with nothing echoed, not even what was typed ahead of it, then
 *   the line break, with no cursor or bracketed paste sequence. Ctrl-U and Ctrl-W edit its hidden
 *   line. Raw mode is off once it ends, by every path out.
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
 *   new term, matched in any case; a term that matches nothing prints `No matches` and asks
 *   `Search: ` again; a source is called once for each term. The refine row shows the default by
 *   its label, a supplied value included, and Enter alone takes it; a multiselect that may be left
 *   empty shows `[none]`; a multiselect whose default holds fewer than `min` choices refuses Enter
 *   alone with `Choose at least 2.` and asks the refine row again; and a question that must be
 *   answered and has no default shows no brackets, where Enter alone lists the choices again.
 * - Editor. Its frames print once each: the asking frame, the editing frame and a line break, and
 *   the answered line.
 * - Leaving. Ctrl-C prints the cancelled line on a row of its own and ends the run with 130, and
 *   Ctrl-D on an empty line cancels. Ctrl-Z prints the asking row again at the resume, with raw
 *   mode off while the process is stopped and on again once it resumes.
 * - Terminal controls. Under `terminalControls: 'preserve'`, which keeps every control a draw
 *   passes, a question writes no cursor or bracketed paste sequence as it starts, after a suspend
 *   and resume, or when an editor gives the keyboard back.
 * - Turns. Two questions asked at once print one after the other, and so do an author's own input
 *   region and a question.
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
  readonly out: Pick<Out, 'info' | 'region'>;
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
    terminalControls?: 'preserve';
  } = {},
): Promise<Asked> {
  const answers: unknown[] = [];
  // Unstyled unless a case is about style, so a transcript reads as the plain text it prints.
  const look = facts.styled ? {} : ({ color: 'never', modifiers: 'never' } as const);
  // A case may keep every terminal control a draw passes, so one the question writes would show.
  const rendering = { ...look, terminalControls: facts.terminalControls };
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

/** The bytes a terminal in its line mode writes to erase one cell. */
const erase = '\b \b';

test.each([
  { answer: 'my-app', keys: ['\r'], stderr: 'Project name [my-app]: \n' },
  { answer: 'notes', keys: ['notes\r'], stderr: 'Project name [my-app]: notes\n' },
])(
  'text prints its prefill in brackets, and $keys answers $answer',
  async ({ answer, keys, stderr }) => {
    const run = await asked(keys, async (context, answers) => {
      answers.push(await text(context, { default: 'my-app', message: 'Project name' }));
    });
    expect(run).toMatchObject({ answers: [answer], code: 0, stderr });
  },
);

test('text without a prefill shows no brackets, and Enter alone answers the empty string', async () => {
  const run = await asked(['\r'], async (context, answers) => {
    answers.push(await text(context, { message: 'Project name' }));
  });
  expect(run).toMatchObject({ answers: [''], code: 0, stderr: 'Project name: \n' });
});

test('a rejected answer prints the sentence on a row of its own and asks again', async () => {
  const run = await asked(['80800x\r8080\r'], async (context, answers) => {
    answers.push(await text(context, { message: 'Service port', validate: port }));
  });
  expect(run).toMatchObject({
    answers: [8080],
    code: 0,
    rawAfter: false,
    stderr: 'Service port: 80800x\n✘ Expected a port number.\nService port: 8080\n',
  });
});

test('Backspace erases the last grapheme by its cells, and an arrow key writes and adds nothing', async () => {
  const run = await asked(['ab\u007fc\u001b[Dd👍🏽\u007f\r'], async (context, answers) => {
    answers.push(await text(context, { message: 'Name' }));
  });
  expect(run).toMatchObject({
    answers: ['acd'],
    stderr: `Name: ab${erase}cd👍🏽${erase}${erase}\n`,
  });
});

test.each([
  { answer: 'one three', keys: 'one two\u0017three\r', stderr: `one two${erase.repeat(3)}three` },
  { answer: 'cd', keys: 'ab\u0015cd\r', stderr: `ab${erase.repeat(2)}cd` },
])(
  'at text, $keys erases what it removes and answers $answer',
  async ({ answer, keys, stderr }) => {
    const run = await asked([keys], async (context, answers) => {
      answers.push(await text(context, { message: 'Name' }));
    });
    expect(run).toMatchObject({ answers: [answer], stderr: `Name: ${stderr}\n` });
  },
);

test.each([
  { answer: 'abc', keys: 'ab\u001bOAc\r', name: 'an SS3 key' },
  { answer: 'abc', keys: 'ab\u001bbc\r', name: 'an Alt chord' },
  { answer: 'ab', keys: 'a\u001b]11;rgb:0000/0000/0000\u0007b\r', name: 'an OSC string' },
])('$name types nothing, writes nothing, and adds nothing', async ({ answer, keys }) => {
  const run = await asked([keys, keys], async (context, answers) => {
    answers.push(await text(context, { message: 'Name' }));
    answers.push(await secret(context, { message: 'Token' }));
  });
  expect(run).toMatchObject({ answers: [answer, answer], stderr: `Name: ${answer}\nToken: \n` });
});

test('keys typed ahead answer the next question, which echoes them once its turn comes', async () => {
  const run = await asked(['first\rsecond\r', ''], async (context, answers) => {
    answers.push(await text(context, { message: 'One' }));
    answers.push(await text(context, { message: 'Two' }));
  });
  expect(run).toMatchObject({
    answers: ['first', 'second'],
    code: 0,
    stderr: 'One: first\nTwo: second\n',
  });
});

test('a secret typed ahead of its turn never reaches the screen', async () => {
  // The three take turns in one hold, so the secret's keys arrive while the first question asks.
  const run = await asked([['bob\rhunter2\r', 'after\r']], async (context, answers) => {
    answers.push(
      ...(await Promise.all([
        text(context, { message: 'Name' }),
        secret(context, { message: 'Token' }),
        text(context, { message: 'After' }),
      ])),
    );
  });
  expect(run).toMatchObject({
    answers: ['bob', 'hunter2', 'after'],
    code: 0,
    stderr: 'Name: bob\nToken: \nAfter: after\n',
  });
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
  expect(run.stderr).not.toMatch(redraw);
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
    stderr: 'Token: \n✘ Too short.\nToken: \nName: name\n',
  });
});

test.each([
  { answer: 'xyz', keys: 'abc\u0015xyz\r' },
  { answer: 'ab ef', keys: 'ab cd\u0017ef\r' },
])('at a secret, $keys edits the hidden line to $answer and writes nothing', async (scenario) => {
  const run = await asked([scenario.keys], async (context, answers) => {
    answers.push(await secret(context, { message: 'Token' }));
  });
  expect(run).toMatchObject({ answers: [scenario.answer], code: 0, stderr: 'Token: \n' });
});

test.each([
  { code: 0, keys: ['abcd\r'], path: 'answered' },
  { code: 0, keys: ['ab\rabcd\r'], path: 'rejected and asked again' },
  { code: 130, keys: ['\u0004'], path: 'cancelled' },
  { code: 0, keys: ['ab\u001a', 'abcd\r'], path: 'suspended and resumed' },
  { code: 130, keys: ['\u0003'], path: 'shut down by Ctrl-C' },
  { code: 131, keys: ['\u001c'], path: 'shut down by Ctrl-\\' },
])('raw mode is off once a secret ends $path', async ({ code, keys }) => {
  const long = schema<string>((value) =>
    String(value).length >= 4 ? { value: String(value) } : { issues: [{ message: 'Too short.' }] },
  );
  const run = await asked(keys, async (context, answers) => {
    answers.push(await secret(context, { message: 'Token', validate: long }));
  });
  expect(run).toMatchObject({ code, rawAfter: false });
});

test('Ctrl-Z at a secret leaves raw mode while the process is stopped and enters it again at the resume', async () => {
  const run = await asked(['ab\u001a', 'cd\r'], async (context, answers, raw) => {
    /*
     * Suspend handlers run newest first and resume handlers oldest first, so each of these runs
     * after the reader's own, which the question registers as it opens.
     */
    context.onSuspend(() => {
      answers.push(`suspended raw ${raw()}`);
    });
    const asking = secret(context, { message: 'Token' });
    context.onResume(() => {
      answers.push(`resumed raw ${raw()}`);
    });
    answers.push(await asking);
  });
  expect(run).toMatchObject({
    answers: ['suspended raw false', 'resumed raw true', 'cd'],
    code: 0,
    stderr: 'Token: Token: \n',
  });
});

test.each([
  { answer: false, default: false, keys: ['\r'], stderr: 'Deploy now? [y/N]: \n' },
  { answer: true, default: false, keys: ['YES\r'], stderr: 'Deploy now? [y/N]: YES\n' },
  {
    answer: true,
    default: undefined,
    keys: ['\ry\r'],
    stderr: 'Deploy now? [y/n]: \n✘ Type y or n.\nDeploy now? [y/n]: y\n',
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
  { answer: 'postgres', keys: ['\r'], typed: '' },
  { answer: 'mysql', keys: ['3\r'], typed: '3' },
  { answer: 'sqlite', keys: [' 1 \r'], typed: ' 1 ' },
])(
  'a select prints its numbered list, and $keys chooses $answer',
  async ({ answer, keys, typed }) => {
    const run = await asked(keys, async (context, answers) => {
      answers.push(
        await select(context, {
          choices: backends,
          default: 'postgres',
          message: 'Storage backend',
        }),
      );
    });
    expect(run).toMatchObject({
      answers: [answer],
      code: 0,
      stderr: `${backendList}Enter a number [2]: ${typed}\n`,
    });
  },
);

test('a select refuses a number outside the list, and the asking row follows, not the list', async () => {
  const run = await asked(['4\rneon\r1\r'], async (context, answers) => {
    answers.push(await select(context, { choices: backends, message: 'Storage backend' }));
  });
  const row = 'Enter a number [1]: ';
  const refused = '✘ Type a number from 1 to 3.\n';
  expect(run).toMatchObject({
    answers: ['sqlite'],
    code: 0,
    stderr: `${backendList}${row}4\n${refused}${row}neon\n${refused}${row}1\n`,
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
    stderr: `${backendList}✘ Cannot select "neon". Choose from the list.\nEnter a number [1]: \n`,
  });
});

/** A multiselect's features. */
const features = ['backups', 'telemetry', 'metrics', 'alerts'];

/** The list a multiselect of `features` prints. */
const featureList = 'Features\n  1. backups\n  2. telemetry\n  3. metrics\n  4. alerts\n';

test.each([
  { answer: ['backups', 'metrics'], keys: ['\r'], typed: '' },
  { answer: ['telemetry', 'backups'], keys: ['2, 1,2,\r'], typed: '2, 1,2,' },
])('a multiselect takes $keys as $answer', async ({ answer, keys, typed }) => {
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
    stderr: `${featureList}Enter numbers separated by commas [1,3]: ${typed}\n`,
  });
});

test('a multiselect refuses a line outside its limits, and Enter alone submits nothing when allowed', async () => {
  const run = await asked(['x\r\r1,2,3\r4\r'], async (context, answers) => {
    answers.push(
      await multiselect(context, { choices: features, max: 2, message: 'Features', min: 1 }),
    );
  });
  const row = 'Enter numbers separated by commas: ';
  expect(run).toMatchObject({
    answers: [['alerts']],
    code: 0,
    stderr: `${featureList}${row}x\n✘ Type numbers from 1 to 4, separated by commas.\n${row}\n✘ Choose at least 1.\n${row}1,2,3\n✘ Choose at most 2.\n${row}4\n`,
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
    terminal: { columns: 80, keys: ['1,2\r1\r'], rows: 24 },
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stdout.text).toBe('["backups"]\n');
  expect(mock.stderr.text).toBe(
    `${featureList}Enter numbers separated by commas: 1,2\n✘ telemetry: Not available on this plan.\nEnter numbers separated by commas: 1\n`,
  );
});

/** The row a search asks on after its list, without a default. */
const refine = 'Enter a number, or text to search again: ';

test('a search asks for a term, prints the matches in any case, and a number chooses from them', async () => {
  const run = await asked(['e\rzzz\rAL\r1\r'], async (context, answers) => {
    answers.push(await select(context, { choices: features, message: 'Feature', search: true }));
  });
  expect(run).toMatchObject({
    answers: ['alerts'],
    code: 0,
    stderr: `Feature\nSearch: e\n  1. telemetry\n  2. metrics\n  3. alerts\n${refine}zzz\n  No matches\n✘ No choice can be selected. Change the search.\nSearch: AL\n  1. alerts\n${refine}1\n`,
  });
});

test('a source is called once for each term, with a signal the next call aborts', async () => {
  const terms: string[] = [];
  const signals: AbortSignal[] = [];
  const run = await asked(['\rpost\r1,\r'], async (context, answers) => {
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
  const row = 'Enter a number, or text to search again [none]: ';
  expect(run).toMatchObject({
    answers: [['postgres']],
    code: 0,
    stderr: `Backend\nSearch: \n  1. sqlite\n  2. postgres\n${row}post\n  1. postgres\n${row}1,\n`,
  });
  expect(terms).toEqual(['', 'post']);
  expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
});

/** The rows a search of `a` and `b` prints for Enter alone at `Search: `. */
const searched = 'Pick\nSearch: \n  1. a\n  2. b\n';

test.each([
  {
    answer: 'b',
    ask: (context: Asking) =>
      select(context, { choices: ['a', 'b'], default: 'b', message: 'Pick', search: true }),
    hint: ' [b]',
    name: 'a select with a default',
  },
  {
    answer: [],
    ask: (context: Asking) =>
      multiselect(context, { choices: ['a', 'b'], message: 'Pick', search: true }),
    hint: ' [none]',
    name: 'a multiselect that may be left empty, with no default,',
  },
  {
    answer: ['b', 'a'],
    ask: (context: Asking) =>
      multiselect(context, {
        choices: ['a', 'b'],
        default: ['b', 'a'],
        message: 'Pick',
        search: true,
      }),
    hint: ' [b,a]',
    name: 'a multiselect with a default',
  },
  {
    answer: 'b',
    ask: (context: Asking) =>
      select(context, {
        default: 'b',
        message: 'Pick',
        source: async (term) => ['a', 'b'].filter((name) => name.includes(term)),
      }),
    hint: ' [b]',
    name: 'a select whose source answers its default',
  },
])(
  'at a search, $name shows its default by its label, and Enter alone takes it',
  async ({ answer, ask, hint }) => {
    const run = await asked(['\r\r'], async (context, answers) => {
      answers.push(await ask(context));
    });
    expect(run).toMatchObject({
      answers: [answer],
      code: 0,
      stderr: `${searched}Enter a number, or text to search again${hint}: \n`,
    });
  },
);

test.each([
  {
    ask: (context: Asking) =>
      select(context, { choices: ['a', 'b'], message: 'Pick', search: true }),
    name: 'a select',
  },
  {
    ask: (context: Asking) =>
      multiselect(context, { choices: ['a', 'b'], message: 'Pick', min: 1, search: true }),
    name: 'a multiselect with min 1',
  },
])(
  'at a search, $name with no default shows no brackets, and Enter alone lists the choices again',
  async ({ ask }) => {
    const run = await asked(['\r\r1\r'], async (context, answers) => {
      answers.push(await ask(context));
    });
    expect(run.code).toBe(0);
    expect(run.stderr).toBe(`${searched}${refine}\n  1. a\n  2. b\n${refine}1\n`);
  },
);

test('at a search, a multiselect whose default holds fewer than min choices refuses Enter alone and asks the refine row again', async () => {
  const run = await asked(['\r\r1,3\r'], async (context, answers) => {
    answers.push(
      await multiselect(context, {
        choices: ['a', 'b', 'c'],
        default: ['a'],
        message: 'Pick',
        min: 2,
        search: true,
      }),
    );
  });
  const again = 'Enter a number, or text to search again [a]: ';
  expect(run).toMatchObject({
    answers: [['a', 'c']],
    code: 0,
    stderr: `Pick\nSearch: \n  1. a\n  2. b\n  3. c\n${again}\n✘ Choose at least 2.\n${again}1,3\n`,
  });
});

test('at a search, a value the operator supplied for the linked option is the default', async () => {
  const run = await asked(
    ['\r\r'],
    async (context, answers) => {
      answers.push(
        await select(context, {
          choices: backends,
          message: 'Storage backend',
          option: 'backend',
          search: true,
        }),
      );
    },
    { argv: ['--backend', 'postgres'], env: { ACCESSIBLE: '1' } },
  );
  expect(run).toMatchObject({
    answers: ['postgres'],
    code: 0,
    stderr: `Storage backend\nSearch: \n${backendList.replace('Storage backend\n', '')}Enter a number, or text to search again [PostgreSQL]: \n`,
  });
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
      '? Release notes › Press Enter to open your editorignored\n? Release notes › Waiting for your editor to close the file…\n? Release notes · seed\n',
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
      // The question holds the keyboard again once the editor exits, which takes the next entry.
      terminal: { columns: 80, keys: ['\r', '\r'], rows: 24 },
    });
    await expect(app.run({ process: mock })).resolves.toBe(0);
    expect(mock.stdout.text).toBe('Final notes\n');
    const asking = '? Release notes › Press Enter to open your editor\n';
    const editing = '? Release notes › Waiting for your editor to close the file…\n';
    expect(mock.stderr.text).toBe(
      `${asking}${editing}✘ Write the notes.\n${asking}${editing}? Release notes · Final notes\n`,
    );
    expect(mock.stdin.isRaw).toBe(false);
  } finally {
    rmSync(folder, { force: true, recursive: true });
  }
});

test('an editor asked line by line writes no cursor or bracketed paste sequence when it takes the keyboard back, even where the terminal controls are kept', async () => {
  const app = new Application('edit', {
    rendering: { color: 'never', modifiers: 'never', terminalControls: 'preserve' },
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
  const saved = ['draft', 'Final notes'];
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
    const asking = '? Release notes › Press Enter to open your editor\n';
    const editing = '? Release notes › Waiting for your editor to close the file…\n';
    expect(mock.stderr.text).toBe(
      `${asking}${editing}✘ Write the notes.\n${asking}${editing}? Release notes · Final notes\n`,
    );
  } finally {
    rmSync(folder, { force: true, recursive: true });
  }
});

test.each([
  { keys: ['ab\u0003'], stderr: 'Name: \n? Name · cancelled\n' },
  { keys: [['ab', '\u0003']], stderr: 'Name: ab\n? Name · cancelled\n' },
])(
  'Ctrl-C after $keys prints the cancelled line on a row of its own and ends the run with 130',
  async ({ keys, stderr }) => {
    const run = await asked(keys, async (context, answers) => {
      answers.push(await text(context, { message: 'Name' }));
    });
    expect(run).toMatchObject({ answers: [], code: 130, rawAfter: false, stderr });
  },
);

test('Ctrl-D on an empty line cancels the question', async () => {
  const run = await asked(['\u0004'], async (context, answers) => {
    answers.push(await text(context, { message: 'Name' }));
  });
  expect(run).toMatchObject({ code: 130, stderr: 'Name: \n? Name · cancelled\n' });
});

test('Ctrl-Z discards the line typed so far and prints the asking row again at the resume', async () => {
  const run = await asked([['ab', '\u001a'], 'cd\r'], async (context, answers) => {
    answers.push(await text(context, { message: 'Name' }));
  });
  expect(run).toMatchObject({ answers: ['cd'], code: 0, stderr: 'Name: abName: cd\n' });
});

test.each([
  { keys: ['bob\r'], path: 'as it starts', stderr: 'Name: bob\n' },
  {
    keys: [['ab', '\u001a'], 'cd\r'],
    path: 'after a suspend and resume',
    stderr: 'Name: abName: cd\n',
  },
])(
  'a question asked line by line writes no cursor or bracketed paste sequence $path, even where the terminal controls are kept',
  async ({ keys, stderr }) => {
    const run = await asked(
      keys,
      async (context, answers) => {
        answers.push(await text(context, { message: 'Name' }));
      },
      { terminalControls: 'preserve' },
    );
    expect(run).toMatchObject({ code: 0, stderr });
  },
);

test('two questions asked at once take turns', async () => {
  const run = await asked(['a\rb\r'], async (context, answers) => {
    answers.push(
      ...(await Promise.all([
        text(context, { message: 'First' }),
        text(context, { message: 'Second' }),
      ])),
    );
  });
  expect(run).toMatchObject({ answers: ['a', 'b'], code: 0, stderr: 'First: a\nSecond: b\n' });
});

/** A view that draws its text as it is. */
const bare = { render: (value: string) => value };

test('an author’s input region and a question asked together take turns, in either order', async () => {
  const regionFirst = await asked(['n\r'], async (context, answers) => {
    const region = context.out.region({ input: true });
    const asking = text(context, { message: 'Name' });
    await region.draw('picker', bare);
    await context.out.info('The author’s region holds the turn.');
    await region.end();
    answers.push(await asking);
  });
  expect(regionFirst).toMatchObject({
    answers: ['n'],
    code: 0,
    stderr: 'ℹ The author’s region holds the turn.\nName: n\n',
  });
  const questionFirst = await asked(['n\r'], async (context, answers) => {
    const asking = text(context, { message: 'Name' });
    const region = context.out.region({ input: true });
    await region.draw('picker', bare);
    await context.out.info('The author’s region took its turn.');
    await region.end();
    answers.push(await asking);
  });
  expect(questionFirst).toMatchObject({
    answers: ['n'],
    code: 0,
    stderr: 'Name: n\nℹ The author’s region took its turn.\n',
  });
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

/** The keys that answer `everyKind`, one entry for each question's hold on the keyboard. */
const everyKey = ['\r', 'token\r', 'y\r', '2\r', '1,4\r', 'ics\r1\r'];

/** What `everyKind` prints with the switch on. */
const everyLine = `ℹ Setting up.\nProject name [my-app]: \nToken: \nDeploy now? [y/N]: y\n${backendList}Enter a number [1]: 2\n${featureList}Enter numbers separated by commas: 1,4\nFeature\nSearch: ics\n  1. metrics\n${refine}1\n`;

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
    ['x\r8080\r'],
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
