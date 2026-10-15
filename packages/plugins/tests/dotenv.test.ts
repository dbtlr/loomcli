// Substitution syntax is intentional literal input: dotenv never expands variables.
/* oxlint-disable eslint/no-template-curly-in-string */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/dotenv-run.mjs', import.meta.url);

function runFile(
  content: string | undefined,
  options: {
    env?: Record<string, string>;
    directory?: boolean;
    unreadable?: boolean;
    mode?: string;
    variables?: readonly string[];
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-dotenv-'));
  try {
    if (options.directory === true) {
      mkdirSync(join(directory, '.env'));
    } else if (content !== undefined) {
      writeFileSync(join(directory, '.env'), content);
    }
    return invoke(fixture, [options.mode ?? 'run'], {
      cwd: directory,
      env: {
        ALT: undefined,
        ENABLED: undefined,
        FIXTURE_ENV: JSON.stringify(options.env ?? {}),
        FIXTURE_UNREADABLE: options.unreadable === true ? '1' : undefined,
        FIXTURE_VARIABLES: JSON.stringify(
          options.variables ?? ['TOKEN', 'ALT', 'EMPTY', 'SET', 'NEXT', 'ENABLED'],
        ),
        TOKEN: undefined,
      },
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test('dotenv imports only allowlisted variables and supplies an env-bound option', () => {
  const result = runFile('TOKEN=from-file\nUNLISTED=ignored\n');
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout)).toMatchObject({
    env: { TOKEN: 'from-file' },
    options: { token: 'from-file' },
  });
  expect(JSON.parse(result.stdout).env).not.toHaveProperty('UNLISTED');
});

test('existing empty values block dotenv while ordered environment bindings can fall through', () => {
  const result = runFile('TOKEN=file\nALT=alternate\nEMPTY=refill\nSET=replace\n', {
    env: { EMPTY: '', SET: 'shell', TOKEN: '' },
  });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout)).toMatchObject({
    env: { ALT: 'alternate', EMPTY: '', SET: 'shell', TOKEN: '' },
    options: { token: 'alternate' },
  });
  expect(JSON.parse(runFile('TOKEN=file\n', { env: { TOKEN: '' } }).stdout).options.token).toBe(
    'fallback',
  );
});

test('an invalid imported option value reports the environment variable without dotenv provenance', () => {
  const result = runFile('ENABLED=secret-value\n');
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('(from ENABLED)');
  expect(result.stderr).not.toContain('.env');
  expect(result.stderr).not.toContain('secret-value');
});

test('warnings use physical starting lines and occur once per malformed assignment', () => {
  const result = runFile(
    '# comment\r\nOTHER="a\r\nb"\r\nTOKEN no-equals\r\nNEXT="bad" trailing\r\n',
  );
  expect(result).toMatchObject({ status: 0, stderr: warning('TOKEN', 4) + warning('NEXT', 5) });
});

test('an ordinary CLI run publishes dotenv additions to libraries and child processes', () => {
  const result = runFile('TOKEN=file\n', { mode: 'process' });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout)).toMatchObject({
    child: 'file',
    options: { token: 'file' },
    process: 'file',
  });
});

test('output capability detection reads the prepared environment', () => {
  const result = runFile('FORCE_COLOR=1\n', { mode: 'color', variables: ['FORCE_COLOR'] });
  expect(result).toMatchObject({ status: 0, stderr: '', stdout: '\u001b[1mcolored\u001b[22m\n' });
});

test('valid variable names that also name object properties reach the process as own values', () => {
  const result = runFile('constructor=file\n', {
    mode: 'process',
    variables: ['constructor'],
  });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  const names = { constructor: 'file' };
  expect(JSON.parse(result.stdout)).toMatchObject({ env: names, processEnv: names });
  const snapshot = runFile('__proto__=file\n', { variables: ['__proto__'] });
  expect(snapshot).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(snapshot.stdout).env).toEqual(JSON.parse('{"__proto__":"file"}'));
});

test('a named run captures warnings and leaves the process untouched', () => {
  const result = runFile('TOKEN=file\nNEXT bad\n', { mode: 'invoke' });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  const outcome = JSON.parse(result.stdout);
  expect(outcome).toMatchObject({ messages: warning('NEXT', 2), status: 'completed' });
  expect(JSON.parse(outcome.output)).toMatchObject({ options: { token: 'file' }, process: null });
});

function warning(name: string, line: number): string {
  return `⚠ Skipped ${name} on line ${line} of .env: the line is not a valid assignment. Correct the line, or remove it.\n`;
}

test.each([
  ['missing equals', 'TOKEN secret-value\nNEXT=ok\n', { NEXT: 'ok' }],
  ['bare export', 'export TOKEN\nNEXT=ok\n', { NEXT: 'ok' }],
  ['unterminated single quote', "TOKEN='secret-value\nNEXT=ok\n", { NEXT: 'ok' }],
  ['unterminated double quote', 'TOKEN="secret-value\nNEXT=hidden\n', {}],
  ['trailing text', 'TOKEN="value" secret-value\nNEXT=ok\n', { NEXT: 'ok' }],
  ['NUL', 'TOKEN=secret-value\0\nNEXT=ok\n', { NEXT: 'ok' }],
])('dotenv warns without values and recovers from %s', (_name, content, env) => {
  const result = runFile(content);
  expect(result).toMatchObject({ status: 0, stderr: warning('TOKEN', 1) });
  expect(JSON.parse(result.stdout).env).toEqual(env);
  expect(result.stderr).not.toContain('secret-value');
});

test('a malformed duplicate does not erase a valid value and warns even when the environment already holds the name', () => {
  const result = runFile('TOKEN=first\nTOKEN="secret-value" trailing\n', {
    env: { TOKEN: 'shell' },
  });
  expect(result).toMatchObject({ status: 0, stderr: warning('TOKEN', 2) });
  expect(JSON.parse(result.stdout)).toMatchObject({
    env: { TOKEN: 'shell' },
    options: { token: 'shell' },
  });
  const duplicate = runFile('TOKEN=first\nTOKEN=bad\0\n');
  expect(duplicate.stderr).toBe(warning('TOKEN', 2));
  expect(JSON.parse(duplicate.stdout).env).toEqual({ TOKEN: 'first' });
});

test('unlisted malformed lines and names that only resemble an allowlisted name stay silent', () => {
  const result = runFile(
    'OTHER no-equals\nTOKEN-TYPO=secret-value\nTOKEN_OTHER\n# TOKEN invalid\nNEXT=ok\n',
  );
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env).toEqual({ NEXT: 'ok' });
  const unclosed = runFile('OTHER="secret-value\nTOKEN=hidden\n');
  expect(unclosed).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(unclosed.stdout).env).toEqual({});
});

test('missing files and .env directories are silent while unreadable files warn once', () => {
  const missing = runFile(undefined);
  expect(missing).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(missing.stdout).options.token).toBe('fallback');
  const directory = runFile(undefined, { directory: true });
  expect(directory).toMatchObject({ status: 0, stderr: '' });
  const unreadable = runFile(undefined, { unreadable: true });
  expect(unreadable).toMatchObject({
    status: 0,
    stderr: '⚠ Skipped .env: the file could not be read. Make it readable, or remove it.\n',
  });
  expect(JSON.parse(unreadable.stdout).env).toEqual({});
});

test.each([
  [
    'BOM, export, whitespace, and CRLF',
    '\uFEFF \texport\t TOKEN \t= \t value \t # comment\r\n',
    'value',
  ],
  ['empty assignment', 'TOKEN=\n', ''],
  ['single quotes are literal', "TOKEN='  a\\n${HOME}#b  '\n", '  a\\n${HOME}#b  '],
  ['double quote escapes', 'TOKEN="a\\nb\\rc\\td\\"e\\\\f"\n', 'a\nb\rc\td"e\\f'],
  ['multiline double quotes', 'TOKEN="a\r\nb\r\nc" # comment\r\n', 'a\nb\nc'],
  ['unknown escapes stay literal', 'TOKEN="a\\qb\\$c"\n', String.raw`a\qb\$c`],
  ['backslash before a physical newline', 'TOKEN="a\\\nb"\n', 'a\\\nb'],
  ['embedded hash', 'TOKEN=a#b # comment\n', 'a#b'],
  ['comment as the value', 'TOKEN=# comment\n', ''],
  ['quotes within unquoted text', 'TOKEN=a"b\'c\n', 'a"b\'c'],
  ['no expansion', 'TOKEN=${HOME}\n', '${HOME}'],
  ['last valid assignment wins', 'TOKEN=first\nTOKEN=last\n', 'last'],
])('dotenv parses %s', (_name, content, value) => {
  const result = runFile(content);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env).toEqual({ TOKEN: value });
});

test('unlisted multiline assignments cannot introduce allowlisted assignments from their contents', () => {
  const result = runFile('UNLISTED="first\nTOKEN=hidden\nlast"\nNEXT=visible\n');
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env).toEqual({ NEXT: 'visible' });
});

test.each(['\u2028', '\u2029', '\r'])(
  'non-LF characters remain inside quoted values and comments: %j',
  (separator) => {
    const result = runFile(
      `OTHER="hello${separator}world\nTOKEN=hidden\nend"\nNEXT="visible${separator}text" # comment${separator}tail\n`,
    );
    expect(result).toMatchObject({ status: 0, stderr: '' });
    expect(JSON.parse(result.stdout).env).toEqual({ NEXT: `visible${separator}text` });
  },
);

test.each([
  undefined,
  {},
  { variables: [] },
  { variables: 'TOKEN' },
  { variables: ['TOKEN', 'TOKEN'] },
  { variables: ['NOT-VALID'] },
  { variables: [4] },
])('dotenv rejects an invalid allowlist at declaration: %j', (settings) => {
  const result = invoke(fixture, ['settings'], {
    env: { FIXTURE_SETTINGS: JSON.stringify(settings) },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('@loomcli/plugins/dotenv/variables');
});

test('dotenv copies the allowlist at declaration', () => {
  const result = runFile('TOKEN=file\nNEXT=ignored\n', { mode: 'copy' });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env).toEqual({ TOKEN: 'file' });
});
