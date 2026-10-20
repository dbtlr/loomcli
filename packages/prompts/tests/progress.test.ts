import { expect, test } from 'vite-plus/test';

import { invoke, start } from '../../../scripts/test-process.js';
import { replay, until } from '../../../scripts/test-screen.js';
import type { Recorded } from '../../../scripts/test-screen.js';

const fixture = new URL('fixtures/progress.mjs', import.meta.url);

interface Run {
  code: number | string;
  events: Recorded[];
  messages?: string;
  notes: Record<string, unknown>;
  stderr: string;
}

/** A shell environment with no color variable, and NO_COLOR unless a test asks for color. */
const plain = { COLORTERM: undefined, FORCE_COLOR: undefined, NO_COLOR: '1', TERM: 'xterm' };

/** One run of a scenario on a terminal, `tty` unless named, with the command line after it. */
function lines(
  scenario: string,
  terminal = 'tty',
  argv: string[] = [],
  env: Record<string, string | undefined> = {},
): Run {
  const result = invoke(fixture, [scenario, terminal, ...argv], { env: { ...plain, ...env } });
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

/** The rows the emulator shows once it has taken every event up to the mark, or all of them. */
async function screen(run: Run, mark?: string): Promise<readonly string[]> {
  const shown = await replay(until(run.events, mark), { columns: 60 });
  return shown.lines;
}

/** One elapsed time as the view writes it under a minute. */
const seconds = String.raw`\d+\.\ds`;

test('a counted line, a spinner line, and a count without a total draw below a lane line', async () => {
  const shown = await screen(lines('look'), 'running');
  expect(shown[0]).toBe('ℹ lane line');
  expect(shown[1]).toMatch(new RegExp(`^◐ Fetching records ▰▰▰▰▰▰▱▱▱▱ 6/10 · ${seconds}$`, 'u'));
  expect(shown[2]).toMatch(new RegExp(`^◐ Building the index · ${seconds}$`, 'u'));
  expect(shown[3]).toMatch(new RegExp(`^◐ Reading rows 1204 · ${seconds}$`, 'u'));
  expect(shown).toHaveLength(4);
});

test('each success and failure line replaces its frame and stays in scrollback', async () => {
  const shown = await screen(lines('look'), 'ended');
  expect(shown).toHaveLength(4);
  expect(shown[1]).toMatch(new RegExp(`^✔ Fetched 10 records · ${seconds}$`, 'u'));
  expect(shown[2]).toMatch(new RegExp(`^✘ Building the index · ${seconds}$`, 'u'));
  expect(shown[3]).toMatch(new RegExp(`^✔ Reading rows · ${seconds}$`, 'u'));
});

test('on a host that takes compat glyph forms, the failure line opens with ×', async () => {
  const shown = await screen(lines('look', 'tty', [], { TERM: 'linux' }), 'ended');
  expect(shown[2]).toMatch(/^× Building the index · /u);
});

test('with color, the spinner frame and the complete cells are styled and the text is the same', async () => {
  const run = lines('look', 'tty', [], { NO_COLOR: undefined });
  expect(run.stderr).toContain(String.fromCodePoint(27));
  const shown = await screen(run, 'running');
  expect(shown[1]).toMatch(new RegExp(`^◐ Fetching records ▰▰▰▰▰▰▱▱▱▱ 6/10 · ${seconds}$`, 'u'));
});

test('a line open when the run is cancelled draws its cancelled line and writes no report', async () => {
  const run = lines('cancel');
  expect(run.code).toBe(130);
  await expect(screen(run)).resolves.toEqual(['ℹ started', '■ Waiting (cancelled)']);
});

test("a line opened after the run's cancellation draws no frame and starts no frame timer", () => {
  const run = lines('late');
  expect(run.code).toBe(130);
  expect(run.notes).toEqual({ draws: 0 });
});

test('the spinner advances one frame each interval, in order', () => {
  const { frames } = lines('advance').notes;
  const running = (Array.isArray(frames) ? frames : []).slice(0, -1);
  expect(running.length).toBeGreaterThanOrEqual(3);
  expect(running.slice(0, 4)).toEqual(['a', 'b', 'c', 'a'].slice(0, Math.min(4, running.length)));
});

test("the style's spinner draws, and a call's own spinner wins for its line", () => {
  expect(lines('style').notes.seen).toEqual({ Own: '+', Styled: '⠋' });
});

test('without the style plugin a line draws the default circle halves', () => {
  expect(lines('style', 'tty', ['default']).notes.seen).toEqual({ Own: '+', Styled: '◐' });
});

test("an override of the progress view draws every frame, and its data carries the line's facts", async () => {
  const run = lines('override');
  await expect(screen(run, 'running')).resolves.toEqual(['running|Counting|1|4|◐|#-|number']);
  await expect(screen(run)).resolves.toEqual(['ended|Counted|1|4|◐|#-|number']);
});

test('a question asked while two lines run holds them still and lets each catch up once', async () => {
  const run = lines('question');
  const asking = await screen(run, 'asking');
  expect(asking[0]).toMatch(/^◐ First · /u);
  expect(asking[1]).toMatch(/^◐ Second ▱▱▱▱▱▱▱▱▱▱ 0\/4 · /u);
  expect(asking[2]).toBe('? Continue ›');
  const answered = await screen(run, 'answered');
  expect(answered[0]).toBe('? Continue · yes');
  expect(answered[1]).toMatch(/^◐ First moved · /u);
  expect(answered[2]).toMatch(/^◐ Second ▰▰▰▰▰▰▰▱▱▱ 3\/4 · /u);
});

test('the default view draws the bar cells, the counts, and the elapsed time', () => {
  const run = invoke(fixture, ['view', 'pipe'], { env: plain });
  expect(run.stderr).toBe('');
  expect(run.stdout.split('\n').slice(0, 8)).toEqual([
    '* Work ###------- 1/3 · 0.0s',
    '* Work ########## 12/10 · 0.0s',
    '* Work ########## 0/0 · 0.0s',
    '* Work ###------- 33% · 0.0s',
    '* Work ---------- 0/5 · 0.0s',
    '* Work · 59.9s',
    '* Work · 1m 05s',
    '* Work · 1h 02m',
  ]);
});

test('track returns the value and ends with done from a function of it', async () => {
  const run = lines('done');
  expect(run.notes).toEqual({ value: 812 });
  const [line] = await screen(run);
  expect(line).toMatch(new RegExp(`^✔ Indexed 812 records · ${seconds}$`, 'u'));
});

test('a rejection fails the line with failed from a function of it and rethrows the same object', async () => {
  const run = lines('failed');
  expect(run.notes).toEqual({ same: true });
  const [line] = await screen(run);
  expect(line).toMatch(new RegExp(`^✘ Could not fetch: the host is down · ${seconds}$`, 'u'));
});

test('a line closed before its work settles draws nothing more and track returns the value', async () => {
  const run = lines('settled');
  expect(run.notes).toEqual({ value: 'late' });
  const shown = await screen(run);
  expect(shown).toHaveLength(1);
  expect(shown[0]).toMatch(/^✔ Ended early · /u);
});

test('an action that throws with two lines open writes both failure lines above the report', async () => {
  const run = lines('throw');
  expect(run.code).toBe(1);
  const shown = await screen(run);
  expect(shown[0]).toBe('ℹ working');
  expect(shown[1]).toMatch(/^✘ First · /u);
  expect(shown[2]).toMatch(/^✘ Second · /u);
  expect(shown[3]).toBe('It failed.');
  expect(shown).toHaveLength(4);
});

test('an action that returns with a line open writes its success line', async () => {
  const shown = await screen(lines('return'));
  expect(shown[0]).toBe('ℹ returning');
  expect(shown[1]).toMatch(/^✔ Left open · /u);
});

test("a middleware's line stays open through the action and ends once the chain has unwound", async () => {
  const shown = await screen(lines('middleware'));
  expect(shown.slice(0, 2)).toEqual(['ℹ action ran', 'ℹ after next']);
  expect(shown[2]).toMatch(/^✔ Around the run · /u);
});

test('with stderr piped, the run writes one start line and one end line per progress line', () => {
  expect(lines('plain', 'pipe').stderr).toBe(
    'ℹ Fetching records\n✔ Fetched 10 records\nℹ Building the index\n✔ Indexed 812 records\nℹ Uploading\n✘ Uploading\n',
  );
});

test('under -q only the failure lines print', () => {
  expect(lines('plain', 'tty', ['-q']).stderr).toBe('✘ Uploading\n');
});

test('under app.invoke the lines land in messages', () => {
  expect(lines('plain', 'invoke').messages).toBe(
    'ℹ Fetching records\n✔ Fetched 10 records\nℹ Building the index\n✔ Indexed 812 records\nℹ Uploading\n✘ Uploading\n',
  );
});

test('under app.invoke the observer reads every progress event of every line in order', () => {
  const progress = [Object(lines('plain', 'invoke').notes.progress)].flat();
  const counted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((completed) => [1, 'updated', completed]);
  expect(progress.map(({ completed, id, state }) => [id, state, completed])).toEqual([
    [1, 'started', 0],
    ...counted,
    [1, 'ended', 10],
    [2, 'started', undefined],
    [2, 'ended', undefined],
    [3, 'started', undefined],
    [3, 'failed', undefined],
  ]);
  expect(progress.map(({ label }) => label)).toEqual([
    ...Array.from({ length: 12 }, () => 'Fetching records'),
    'Building the index',
    'Building the index',
    'Uploading',
    'Uploading',
  ]);
});

test.skipIf(process.platform === 'win32')(
  "SIGINT under a signals owner writes the line's cancelled line, exits 130, and leaves no timer",
  async () => {
    const running = start(fixture, ['signal', 'tty'], { env: plain });
    await running.announced('READY');
    running.child.kill('SIGINT');
    const exit = await running.exit;
    expect(exit.signal).toBeNull();
    const run: Run = JSON.parse(exit.stdout.slice(exit.stdout.indexOf('{')));
    expect(run.code).toBe(130);
    await expect(screen(run)).resolves.toEqual(['■ Waiting for SIGINT (cancelled)']);
  },
);

test.each([
  ['label', 'The progress line received a label that is not a string. Supply a string label.'],
  [
    'total',
    'The progress line "Fetching records" received a total that is not a finite number of 0 or more. Supply a finite number of 0 or more.',
  ],
  [
    'completed',
    'The progress line "Fetching records" received a completed that is not a finite number of 0 or more. Supply a finite number of 0 or more.',
  ],
  ['frames', 'The progress spinner has no frames. Supply at least one frame.'],
  ['frame', 'The progress spinner frame 2 is not a string. Supply each frame as a string.'],
  [
    'interval',
    'The progress spinner interval is not a finite number above 0. Supply the milliseconds between frames.',
  ],
  [
    'bar',
    "The progress bar's complete cell is not a nonempty string. Supply the text of one cell.",
  ],
  [
    'incomplete',
    "The progress bar's incomplete cell is not a nonempty string. Supply the text of one cell.",
  ],
  [
    'update',
    'The progress line "Fetching records" received an update that is not an object. Supply an object, such as { completed: 3 }.',
  ],
  ['end', 'The progress line received a label that is not a string. Supply a string label.'],
  [
    'done',
    'The progress line "Fetching records" received a done message that is neither a string nor a function. Supply a string, or a function that returns one.',
  ],
  [
    'failed',
    'The progress line "Fetching records" received a failed message that is neither a string nor a function. Supply a string, or a function that returns one.',
  ],
  [
    'settings',
    'The progress style received settings that are not an object. Supply an object, such as { spinner }.',
  ],
])('a malformed %s throws its sentence at the call', (setting, message) => {
  expect(lines('fault', 'tty', [setting]).notes).toEqual({
    message,
    name: 'DeclarationError',
    rule: '@loomcli/prompts/progress',
  });
});
