/*
 * Acceptance plan for interaction (docs/core/interaction.md#interaction).
 *
 * - The decision. With stdin and stderr terminals and no mark, `interactive` is `true`. It is
 *   `false` with stdin piped, with stderr redirected, under `--no-input` from the interaction
 *   plugin, under its bound variable set to `false`, from the configuration source, under
 *   `app.invoke`, under an action's `invoke`, and in an MCP tool call. A piped stdout leaves it
 *   `true`, and a marked option that reads `true` with stdin piped leaves it `false`.
 * - Conditional requiredness. With interaction off, an omitted `required: 'non-interactive'` option
 *   fails with exit 2 before the action and the sentence the reference states, beside any other
 *   input problem in authoring order, by declared name under `invoke` and in an MCP tool call, and
 *   a supplied one validates and reaches the action. With interaction on, the omitted option
 *   reaches the action as `undefined`. Each declaration error the reference lists throws from its
 *   call, and help, the manifest, and the MCP schema print the facts the reference states.
 * - `supplied` and `missingInputError`. `supplied` matches the validation context's record for
 *   argv, environment, configuration, and by-name values, holds `undefined` for a defaulted option,
 *   and rejects writes at every depth. `missingInputError` builds both sentences by spelling and by
 *   name, and rejects a global option and an undeclared name.
 *
 * Acceptance plan for the interaction plugin (docs/plugins/interaction.md#interaction-plugin).
 *
 * - `mimir --help` lists `--no-input` with its description among the global options, the manifest
 *   marks it `control` and `interaction`, and `mimir setup --no-input` with stdin and stderr
 *   terminals runs with `interactive` false.
 * - `MIMIR_INPUT=false`, and the configuration source's `false`, turn interaction off,
 *   `MIMIR_INPUT=yes` fails with the environment grammar's usage failure, and an application that
 *   marks its own option and installs the plugin fails with the two-marks error.
 */

import { Application } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** The terminal width and the text that each draw scenario wraps against. */
const whole = { columns: 4, text: 'abcdef\n界界\n' };

const drawn = {
  carriage: { columns: 4, text: 'abc\rdef' },
  tab: { columns: 10, text: 'ab\tXXX\n' },
  wide: { columns: 3, text: '界界界\n' },
};

/** One run that draws the scenario's text between two lines on a mock whose stderr is a terminal. */
async function draw(scenario?: keyof typeof drawn) {
  const { columns, text } = scenario === undefined ? whole : drawn[scenario];
  let rows = 0;
  const mock = mockProcess({ terminal: { columns, rows: 24, streams: ['stderr'] } });
  const app = new Application('draw', { description: 'Draw terminal output.' }).action(
    async ({ out }) => {
      const first = out.info('before');
      rows = await out.draw(text, { render: (value) => `\u001b[?25l${value}\u001b[?25h` });
      await out.info('after');
      await first;
    },
  );
  const code = await app.run({ process: mock });
  return { code, rows, text: mock.stderr.text };
}

test('conditional requiredness rejects missing input before dispatch without interaction', () => {
  const result = invoke(new URL('fixtures/interaction.mjs', import.meta.url));
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(
    'Option "--port" is required when input is not interactive. Supply a value.',
  );
});

test('actions see the raw supplied value beside the validated value', () => {
  const result = invoke(new URL('fixtures/interaction.mjs', import.meta.url), ['--port', '8080']);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({ interactive: false, port: 8080, raw: '8080' });
});

test.each([
  ['terminal', { interactive: true }],
  ['disabled', { interactive: false }],
  ['env', { interactive: false }],
  ['invoke', { interactive: false }],
])('the run interaction decision honors capabilities and intent: %s', (scenario, expected) => {
  const result = invoke(new URL('fixtures/interaction-policy.mjs', import.meta.url), [scenario]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual(expected);
});

test('action cancellation is silent and resolves the normal cancellation status', () => {
  const result = invoke(new URL('fixtures/interaction-policy.mjs', import.meta.url), ['cancel']);
  expect(result.status).toBe(130);
  expect(result.stderr).toBe('');
});

test('two interaction marks fail at declaration, naming each option as its own site does', () => {
  const result = invoke(new URL('fixtures/interaction-policy.mjs', import.meta.url), ['twice']);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ name: 'DeclarationError' });
  expect(JSON.parse(result.stdout).message).toContain(
    'Global option "input" and global option "other" both declare interaction.',
  );
});

test('draw preserves controls only on terminal stderr, reports wrapped rows, and keeps write order', async () => {
  await expect(draw()).resolves.toEqual({
    code: 0,
    rows: 3,
    text: 'ℹ before\n\u001b[?25labcdef\n界界\n\u001b[?25hℹ after\n',
  });
});

test('help and manifest preserve required as Boolean and publish conditional requiredness', () => {
  const fixture = new URL('fixtures/interaction-projection.mjs', import.meta.url);
  const help = invoke(fixture, ['--help']);
  expect(help.status).toBe(0);
  expect(help.stdout).toContain('required when not interactive');
  expect(help.stdout).toContain('setup [options]');
  const printed = invoke(fixture, ['--manifest']);
  expect(printed.status).toBe(0);
  expect(JSON.parse(printed.stdout)).toMatchObject({
    command: { options: [{ name: 'port', required: false, requiredWhen: 'non-interactive' }] },
    globals: expect.arrayContaining([
      expect.objectContaining({ interaction: true, name: 'input' }),
    ]),
  });
});

test('draw counts wide graphemes that cannot fit the final cell of a terminal row', async () => {
  await expect(draw('wide')).resolves.toMatchObject({ code: 0, rows: 3 });
});

test('an unawaited draw failure stays in the ordinary run failure path', () => {
  const result = invoke(new URL('fixtures/unawaited-draw.mjs', import.meta.url));
  expect(result).toEqual({
    status: 1,
    stderr: 'draw: Something went wrong.\n',
    stdout: 'CODE:1\n',
  });
});

test('draw measures tab stops before counting terminal wrapping', async () => {
  await expect(draw('tab')).resolves.toMatchObject({ code: 0, rows: 2 });
});

test('view plain text strips styles and controls while retaining destination glyph forms', () => {
  const result = invoke(new URL('fixtures/view-context.mjs', import.meta.url));
  expect(result).toEqual({ status: 0, stderr: '', stdout: '{"cells":6,"plain":"Name >"}\n' });
});

test('draw resets its column at a standalone carriage return', async () => {
  await expect(draw('carriage')).resolves.toMatchObject({ code: 0, rows: 0 });
});
