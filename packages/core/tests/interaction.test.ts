import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

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

test('draw preserves controls only on terminal stderr, reports wrapped rows, and keeps write order', () => {
  const result = invoke(new URL('fixtures/draw.mjs', import.meta.url));
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
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

test('draw counts wide graphemes that cannot fit the final cell of a terminal row', () => {
  const result = invoke(new URL('fixtures/draw.mjs', import.meta.url), ['wide']);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ rows: 3 });
});

test('an unawaited draw failure stays in the ordinary run failure path', () => {
  const result = invoke(new URL('fixtures/unawaited-draw.mjs', import.meta.url));
  expect(result).toEqual({
    status: 1,
    stderr: 'draw: Something went wrong.\n',
    stdout: 'CODE:1\n',
  });
});

test('draw measures tab stops before counting terminal wrapping', () => {
  const result = invoke(new URL('fixtures/draw.mjs', import.meta.url), ['tab']);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ rows: 2 });
});

test('view plain text strips styles and controls while retaining destination glyph forms', () => {
  const result = invoke(new URL('fixtures/view-context.mjs', import.meta.url));
  expect(result).toEqual({ status: 0, stderr: '', stdout: '{"cells":6,"plain":"Name >"}\n' });
});

test('draw resets its column at a standalone carriage return', () => {
  const result = invoke(new URL('fixtures/draw.mjs', import.meta.url), ['carriage']);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ rows: 0 });
});
