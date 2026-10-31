/*
 * Acceptance plan for the dotenv plugin (docs/plugins/dotenv.md#dotenv-plugin).
 *
 * Acceptance covers parser behavior, warning recovery, empty-value precedence, env-bound options,
 * host isolation, child-process visibility, and named invocation capture. It also covers the layered
 * files and their precedence, the mode `NODE_ENV` names, the test mode's skip of `.env.local`,
 * reference expansion and its escape, the `#` that ends an unquoted value, and the values Bun reads
 * for the same files. The packed consumer also proves the public subpath, emitted types, argv
 * publication, and named isolation under Node and Bun.
 */

// Substitution syntax is intentional input for the references the plugin expands.
/* oxlint-disable eslint/no-template-curly-in-string */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { invokeByName, run as fixtureRun } from './fixtures/dotenv-app.js';

const fixture = new URL('fixtures/dotenv-run.mjs', import.meta.url);

/** The allow list most tests install, so an unlisted name shows what the list leaves out. */
const listed = ['TOKEN', 'ALT', 'EMPTY', 'SET', 'NEXT', 'ENABLED'];

interface FixtureOptions {
  env?: Record<string, string> | undefined;
  launchEnv?: Record<string, string>;
  directory?: string;
  unreadable?: string;
  unset?: readonly string[];
  mode?: string;
  names?: readonly string[];
  runtime?: string;
  settings?: unknown;
}

/** Runs the fixture in a directory holding the given files, under `inFixture`. */
async function runFile(
  content: string | Record<string, string> | undefined,
  options: FixtureOptions = {},
) {
  return await inFixture(content, options, (env, directory) => {
    // The native reference observes Bun's startup dotenv read before any Application runs.
    if (options.mode === 'native') {
      return invoke(fixture, [options.mode], {
        cwd: directory,
        env,
        ...(options.runtime === undefined ? {} : { runtime: options.runtime }),
      });
    }
    return fixtureRun([options.mode ?? 'run'], env, directory);
  });
}

/**
 * Calls `body` with the fixture's environment in a directory holding the given files: a string is
 * the `.env` file, and a record maps each file name to its text.
 */
async function inFixture<Result>(
  content: string | Record<string, string> | undefined,
  options: FixtureOptions,
  body: (env: Record<string, string | undefined>, directory: string) => Result | Promise<Result>,
): Promise<Result> {
  const directory = mkdtempSync(join(tmpdir(), 'loom-dotenv-'));
  try {
    if (typeof content === 'string') {
      writeFileSync(join(directory, '.env'), content);
    } else {
      for (const [name, text] of Object.entries(content ?? {})) {
        writeFileSync(join(directory, name), text);
      }
    }
    if (options.directory !== undefined) {
      mkdirSync(join(directory, options.directory));
    }
    return await body(
      {
        ...options.launchEnv,
        ALT: undefined,
        ENABLED: undefined,
        FIXTURE_ENV: JSON.stringify(options.env ?? {}),
        FIXTURE_NAMES: JSON.stringify(
          options.names ?? ['TOKEN', 'ALT', 'EMPTY', 'SET', 'NEXT', 'ENABLED', 'UNLISTED'],
        ),
        FIXTURE_SETTINGS: JSON.stringify(
          'settings' in options ? options.settings : { only: listed },
        ),
        FIXTURE_UNREADABLE: options.unreadable,
        FIXTURE_UNSET: JSON.stringify(options.unset ?? []),
        TOKEN: undefined,
      },
      directory,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test('dotenv with no settings imports every variable the file defines that the process has not set', async () => {
  const result = await runFile('TOKEN=file\nUNLISTED=also\nSET=replace\n', {
    env: { SET: 'shell' },
    names: ['TOKEN', 'UNLISTED', 'SET'],
    settings: null,
  });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout)).toMatchObject({
    env: { SET: 'shell', TOKEN: 'file', UNLISTED: 'also' },
    options: { token: 'file' },
  });
});

test('an except list imports every variable but the ones it lists', async () => {
  const result = await runFile('TOKEN=file\nUNLISTED=hidden\n', {
    settings: { except: ['UNLISTED'] },
  });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env).toEqual({ TOKEN: 'file' });
});

test.each([
  ['no settings', null, warning('OTHER', 1)],
  ['an only list that leaves the name out', { only: ['NEXT'] }, ''],
  ['an except list that names it', { except: ['OTHER'] }, ''],
  ['an except list that leaves it out', { except: ['TOKEN'] }, warning('OTHER', 1)],
])(
  'a malformed assignment warns only when the plugin would import its name: %s',
  async (_name, settings, stderr) => {
    const result = await runFile('OTHER no-equals\nNEXT=ok\n', { settings });
    expect(result).toMatchObject({ status: 0, stderr });
    expect(JSON.parse(result.stdout).env).toEqual({ NEXT: 'ok' });
  },
);

test('an only list imports only the variables it lists and supplies an env-bound option', async () => {
  const result = await runFile('TOKEN=from-file\nUNLISTED=ignored\n');
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout)).toMatchObject({
    env: { TOKEN: 'from-file' },
    options: { token: 'from-file' },
  });
  expect(JSON.parse(result.stdout).env).not.toHaveProperty('UNLISTED');
});

test('existing empty values block dotenv while ordered environment bindings can fall through', async () => {
  const result = await runFile('TOKEN=file\nALT=alternate\nEMPTY=refill\nSET=replace\n', {
    env: { EMPTY: '', SET: 'shell', TOKEN: '' },
  });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout)).toMatchObject({
    env: { ALT: 'alternate', EMPTY: '', SET: 'shell', TOKEN: '' },
    options: { token: 'alternate' },
  });
  const invocation1 = await runFile('TOKEN=file\n', { env: { TOKEN: '' } });
  expect(JSON.parse(invocation1.stdout).options.token).toBe('fallback');
});

test("a file's empty assignment supplies an option whose binding allows an empty value", async () => {
  const names = ['PREFIX'];
  const only = { only: ['PREFIX'] };
  const fromFile = await runFile('PREFIX=\n', { names, settings: only });
  expect(fromFile).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(fromFile.stdout)).toMatchObject({
    env: { PREFIX: '' },
    options: { prefix: '' },
  });
  // A process's own empty variable wins over the file and supplies the empty string too.
  const fromProcess = await runFile('PREFIX=file\n', {
    env: { PREFIX: '' },
    names,
    settings: only,
  });
  expect(JSON.parse(fromProcess.stdout).options.prefix).toBe('');
  // Without the assignment the default applies.
  const invocation2 = await runFile('OTHER=1\n', { names, settings: only });
  expect(JSON.parse(invocation2.stdout).options.prefix).toBe('fallback');
});

test('an invalid imported option value reports the environment variable without dotenv provenance', async () => {
  const result = await runFile('ENABLED=secret-value\n');
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('(from ENABLED)');
  expect(result.stderr).not.toContain('.env');
  expect(result.stderr).not.toContain('secret-value');
});

test('warnings use physical starting lines and occur once per malformed assignment', async () => {
  const result = await runFile(
    '# comment\r\nOTHER="a\r\nb"\r\nTOKEN no-equals\r\nNEXT="bad" trailing\r\n',
  );
  expect(result).toMatchObject({ status: 0, stderr: warning('TOKEN', 4) + warning('NEXT', 5) });
});

test('an ordinary CLI run publishes dotenv additions to libraries and child processes', async () => {
  const result = await runFile('TOKEN=file\n', { mode: 'process' });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout)).toMatchObject({
    child: 'file',
    options: { token: 'file' },
    process: 'file',
  });
});

test('output capability detection reads the prepared environment', async () => {
  const result = await runFile('FORCE_COLOR=1\n', {
    mode: 'color',
    names: ['FORCE_COLOR'],
    settings: { only: ['FORCE_COLOR'] },
  });
  expect(result).toMatchObject({ status: 0, stderr: '', stdout: '\u001b[1mcolored\u001b[22m\n' });
});

test('valid variable names that also name object properties reach the process as own values', async () => {
  const result = await runFile('constructor=file\n', {
    mode: 'process',
    names: ['constructor'],
    settings: { only: ['constructor'] },
  });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  const names = { constructor: 'file' };
  expect(JSON.parse(result.stdout)).toMatchObject({ env: names, processEnv: names });
  const snapshot = await runFile('__proto__=file\n', {
    names: ['__proto__'],
    settings: { only: ['__proto__'] },
  });
  expect(snapshot).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(snapshot.stdout).env).toEqual(JSON.parse('{"__proto__":"file"}'));
});

test('a named run captures warnings and leaves the process untouched', async () => {
  const result = await inFixture('TOKEN=file\nNEXT bad\n', {}, invokeByName);
  expect(result).toMatchObject({ exitCode: undefined, stderr: '', stdout: '' });
  const { outcome } = result;
  expect(outcome).toMatchObject({ messages: warning('NEXT', 2), status: 'completed' });
  if (outcome.status === 'cancelled') {
    throw new Error('The named run was cancelled.');
  }
  expect(JSON.parse(outcome.output)).toMatchObject({ options: { token: 'file' }, process: null });
});

function warning(name: string, line: number, file = '.env'): string {
  return `⚠ Skipped ${name} on line ${line} of ${file}: the line is not a valid assignment. Correct the line, or remove it.\n`;
}

test.each([
  ['missing equals', 'TOKEN secret-value\nNEXT=ok\n', { NEXT: 'ok' }],
  ['bare export', 'export TOKEN\nNEXT=ok\n', { NEXT: 'ok' }],
  ['unterminated single quote', "TOKEN='secret-value\nNEXT=hidden\n", {}],
  ['unterminated double quote', 'TOKEN="secret-value\nNEXT=hidden\n', {}],
  ['trailing text', 'TOKEN="value" secret-value\nNEXT=ok\n', { NEXT: 'ok' }],
  ['NUL', 'TOKEN=secret-value\0\nNEXT=ok\n', { NEXT: 'ok' }],
])('dotenv warns without values and recovers from %s', async (_name, content, env) => {
  const result = await runFile(content);
  expect(result).toMatchObject({ status: 0, stderr: warning('TOKEN', 1) });
  expect(JSON.parse(result.stdout).env).toEqual(env);
  expect(result.stderr).not.toContain('secret-value');
});

test('a malformed duplicate does not erase a valid value and warns even when the environment already holds the name', async () => {
  const result = await runFile('TOKEN=first\nTOKEN="secret-value" trailing\n', {
    env: { TOKEN: 'shell' },
  });
  expect(result).toMatchObject({ status: 0, stderr: warning('TOKEN', 2) });
  expect(JSON.parse(result.stdout)).toMatchObject({
    env: { TOKEN: 'shell' },
    options: { token: 'shell' },
  });
  const duplicate = await runFile('TOKEN=first\nTOKEN=bad\0\n');
  expect(duplicate.stderr).toBe(warning('TOKEN', 2));
  expect(JSON.parse(duplicate.stdout).env).toEqual({ TOKEN: 'first' });
});

test('unlisted malformed lines and names that only resemble an allowlisted name stay silent', async () => {
  const result = await runFile(
    'OTHER no-equals\nTOKEN-TYPO=secret-value\nTOKEN_OTHER\n# TOKEN invalid\nNEXT=ok\n',
  );
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env).toEqual({ NEXT: 'ok' });
  const unclosed = await runFile('OTHER="secret-value\nTOKEN=hidden\n');
  expect(unclosed).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(unclosed.stdout).env).toEqual({});
});

test('missing files and .env directories are silent while unreadable files warn once', async () => {
  const missing = await runFile(undefined);
  expect(missing).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(missing.stdout).options.token).toBe('fallback');
  const directory = await runFile(undefined, { directory: '.env' });
  expect(directory).toMatchObject({ status: 0, stderr: '' });
  const unreadable = await runFile(undefined, { unreadable: '.env' });
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
  ['multiline single quotes', 'TOKEN=\'a\r\n\\n "b"\r\nc\' # comment\r\n', 'a\n\\n "b"\nc'],
  ['double quote escapes', 'TOKEN="a\\nb\\rc\\td\\"e\\\\f"\n', 'a\nb\rc\td"e\\f'],
  ['multiline double quotes', 'TOKEN="a\r\nb\r\nc" # comment\r\n', 'a\nb\nc'],
  [
    String.raw`unknown escapes stay literal and \$ is a dollar`,
    'TOKEN="a\\qb\\$c"\n',
    String.raw`a\qb$c`,
  ],
  ['backslash before a physical newline', 'TOKEN="a\\\nb"\n', 'a\\\nb'],
  ['an embedded hash ends an unquoted value', 'TOKEN=a#b # comment\n', 'a'],
  ['a quoted hash stays', 'TOKEN="a#b" # comment\n', 'a#b'],
  ['comment as the value', 'TOKEN=# comment\n', ''],
  ['quotes within unquoted text', 'TOKEN=a"b\'c\n', 'a"b\'c'],
  ['last valid assignment wins', 'TOKEN=first\nTOKEN=last\n', 'last'],
])('dotenv parses %s', async (_name, content, value) => {
  const result = await runFile(content);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env).toEqual({ TOKEN: value });
});

test('a single-quoted private key spans its lines as one value, and no line of it becomes a name', async () => {
  const key = [
    '-----BEGIN PRIVATE KEY-----',
    'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7xyzSECRETabc',
    'AbcDefGhiJklMnoPqrStuVwxYz0123456789secretPartTwo==',
    '-----END PRIVATE KEY-----',
  ].join('\n');
  const result = await runFile(`PRIVATE_KEY='${key}'\nDB_URL=postgres://x\n`, {
    names: ['PRIVATE_KEY', 'DB_URL', 'AbcDefGhiJklMnoPqrStuVwxYz0123456789secretPartTwo'],
    settings: null,
  });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env).toEqual({ DB_URL: 'postgres://x', PRIVATE_KEY: key });
});

test('an unterminated single quote consumes the rest of the file and warns once for its line', async () => {
  const result = await runFile("TOKEN='secret-value\nNEXT=hidden\nMIIsecret==\n", {
    settings: null,
  });
  expect(result).toMatchObject({ status: 0, stderr: warning('TOKEN', 1) });
  expect(JSON.parse(result.stdout).env).toEqual({});
  expect(result.stderr).not.toContain('secret');
});

test('unlisted multiline assignments cannot introduce allowlisted assignments from their contents', async () => {
  const result = await runFile('UNLISTED="first\nTOKEN=hidden\nlast"\nNEXT=visible\n');
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env).toEqual({ NEXT: 'visible' });
});

test.each(['\u2028', '\u2029', '\r'])(
  'non-LF characters remain inside quoted values and comments: %j',
  async (separator) => {
    const result = await runFile(
      `OTHER="hello${separator}world\nTOKEN=hidden\nend"\nNEXT="visible${separator}text" # comment${separator}tail\n`,
    );
    expect(result).toMatchObject({ status: 0, stderr: '' });
    expect(JSON.parse(result.stdout).env).toEqual({ NEXT: `visible${separator}text` });
  },
);

/** Runs the plugin over the given files with every name imported, and returns the names it read. */
async function readLayers(
  files: Record<string, string>,
  options: { env?: Record<string, string>; names?: readonly string[] } = {},
) {
  const result = await runFile(files, {
    env: options.env,
    names: options.names ?? ['TOKEN', 'ALT', 'NEXT'],
    settings: null,
  });
  return { ...result, env: result.stdout === '' ? {} : JSON.parse(result.stdout).env };
}

const production = { NODE_ENV: 'production' };

test.each([
  ['.env.<mode> over .env', { '.env': 'TOKEN=base', '.env.production': 'TOKEN=mode' }, 'mode'],
  [
    '.env.local over .env.<mode>',
    { '.env.local': 'TOKEN=local', '.env.production': 'TOKEN=mode' },
    'local',
  ],
  [
    '.env.<mode>.local over .env.local',
    { '.env.local': 'TOKEN=local', '.env.production.local': 'TOKEN=both' },
    'both',
  ],
  ['.env.local over .env', { '.env': 'TOKEN=base', '.env.local': 'TOKEN=local' }, 'local'],
  [
    'the most specific of all four',
    {
      '.env': 'TOKEN=base',
      '.env.local': 'TOKEN=local',
      '.env.production': 'TOKEN=mode',
      '.env.production.local': 'TOKEN=both',
    },
    'both',
  ],
])('the more specific file wins: %s', async (_name, files, value) => {
  const result = await readLayers(files, { env: production });
  expect(result).toMatchObject({ env: { TOKEN: value }, status: 0, stderr: '' });
});

test('each layered file contributes the names the others leave unset', async () => {
  const result = await readLayers(
    {
      '.env': 'TOKEN=base\nALT=base\nNEXT=base',
      '.env.local': 'ALT=local',
      '.env.production': 'NEXT=mode',
    },
    { env: production },
  );
  expect(result).toMatchObject({
    env: { ALT: 'local', NEXT: 'mode', TOKEN: 'base' },
    status: 0,
    stderr: '',
  });
});

test('a variable the environment holds beats every file, empty included', async () => {
  const files = { '.env': 'TOKEN=base', '.env.production.local': 'TOKEN=both\nALT=both' };
  const invocation3 = await readLayers(files, { env: { ...production, TOKEN: 'shell' } });
  expect(invocation3.env).toEqual({
    ALT: 'both',
    TOKEN: 'shell',
  });
  const invocation4 = await readLayers(files, { env: { ...production, TOKEN: '' } });
  expect(invocation4.env).toEqual({
    ALT: 'both',
    TOKEN: '',
  });
});

test.each([
  ['unset', {}],
  ['empty', { NODE_ENV: '' }],
])('with NODE_ENV %s the plugin reads .env and .env.local alone', async (_name, env) => {
  const result = await readLayers(
    {
      '.env': 'TOKEN=base\nALT=base\nNEXT=base',
      '.env.': 'ALT=dot',
      '.env.development': 'NEXT=development',
      '.env.local': 'TOKEN=local',
      '.env.local.local': 'NEXT=twice',
    },
    { env },
  );
  expect(result).toMatchObject({
    env: { ALT: 'base', NEXT: 'base', TOKEN: 'local' },
    status: 0,
    stderr: '',
  });
});

// The mode names a file as written; whether a name in another case matches is the file system's
// Rule, as for any path, so no assertion here depends on a case-sensitive file system.
test('the mode is read as written, and a file for another mode is not read', async () => {
  const files = { '.env': 'TOKEN=base', '.env.Production': 'TOKEN=cased', '.env.staging': 'ALT=x' };
  const invocation5 = await readLayers(files, { env: { NODE_ENV: 'Production' } });
  expect(invocation5.env).toEqual({
    TOKEN: 'cased',
  });
  const invocation6 = await readLayers(files, { env: { NODE_ENV: 'qa' } });
  expect(invocation6.env).toEqual({ TOKEN: 'base' });
});

test('under the test mode the plugin skips .env.local and reads the other three', async () => {
  const result = await readLayers(
    {
      '.env': 'TOKEN=base\nALT=base\nNEXT=base',
      '.env.local': 'TOKEN=local\nALT=local\nNEXT=local',
      '.env.test': 'ALT=mode\nNEXT=mode',
      '.env.test.local': 'NEXT=both',
    },
    { env: { NODE_ENV: 'test' } },
  );
  expect(result).toMatchObject({
    env: { ALT: 'mode', NEXT: 'both', TOKEN: 'base' },
    status: 0,
    stderr: '',
  });
});

test('a file the mode names twice is read once, at its more specific place', async () => {
  const result = await readLayers(
    {
      '.env': 'TOKEN=base',
      '.env.local': 'TOKEN=local\nBAD no-equals',
      '.env.local.local': 'ALT=deep',
    },
    { env: { NODE_ENV: 'local' } },
  );
  expect(result).toMatchObject({
    env: { ALT: 'deep', TOKEN: 'local' },
    status: 0,
    stderr: warning('BAD', 2, '.env.local'),
  });
});

test('a variable a file defines never chooses the mode the plugin reads', async () => {
  const result = await readLayers(
    { '.env': 'NODE_ENV=production\nTOKEN=base', '.env.production': 'TOKEN=mode' },
    {
      names: ['NODE_ENV', 'TOKEN'],
    },
  );
  expect(result.env).toEqual({ NODE_ENV: 'production', TOKEN: 'base' });
});

test('a malformed assignment in one file never erases a valid one in another', async () => {
  const result = await readLayers(
    { '.env': 'TOKEN=base', '.env.production': 'TOKEN no-equals\nALT=mode' },
    { env: production },
  );
  expect(result).toMatchObject({
    env: { ALT: 'mode', TOKEN: 'base' },
    status: 0,
    stderr: warning('TOKEN', 1, '.env.production'),
  });
});

test('warnings name their file and come in the order the plugin reads the files', async () => {
  const result = await readLayers(
    {
      '.env': 'TOKEN no-equals',
      '.env.local': 'ALT no-equals',
      '.env.production': 'NEXT no-equals',
      '.env.production.local': 'TOKEN="a" trailing',
    },
    { env: production },
  );
  expect(result.stderr).toBe(
    warning('TOKEN', 1, '.env.production.local') +
      warning('ALT', 1, '.env.local') +
      warning('NEXT', 1, '.env.production') +
      warning('TOKEN', 1, '.env'),
  );
});

test('a layered file that is missing is silent', async () => {
  const result = await runFile({ '.env': 'TOKEN=base' }, { env: production, settings: null });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env).toEqual({ TOKEN: 'base' });
});

test('a directory at a layered name is silent while the other files contribute', async () => {
  const result = await runFile(
    { '.env': 'TOKEN=base', '.env.production': 'ALT=mode' },
    { directory: '.env.local', env: production, settings: null },
  );
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env).toEqual({ ALT: 'mode', TOKEN: 'base' });
});

test('an unreadable layered file warns once with its name while the other files contribute', async () => {
  const result = await runFile(
    { '.env': 'TOKEN=base', '.env.production': 'ALT=mode' },
    { env: production, names: ['TOKEN', 'ALT', 'NEXT'], settings: null, unreadable: '.env.local' },
  );
  expect(result).toMatchObject({
    status: 0,
    stderr: '⚠ Skipped .env.local: the file could not be read. Make it readable, or remove it.\n',
  });
  expect(JSON.parse(result.stdout).env).toEqual({ ALT: 'mode', TOKEN: 'base' });
});

test('an allow list and a deny list apply to every layered file', async () => {
  const files = { '.env': 'TOKEN=base\nNEXT=base', '.env.production': 'TOKEN=mode\nNEXT=mode' };
  const only = await runFile(files, { env: production, settings: { only: ['TOKEN'] } });
  expect(JSON.parse(only.stdout).env).toEqual({ TOKEN: 'mode' });
  const except = await runFile(files, { env: production, settings: { except: ['TOKEN'] } });
  expect(JSON.parse(except.stdout).env).toEqual({ NEXT: 'mode' });
});

test.each([
  ['$NAME', 'ALT=x\nTOKEN=a-$ALT-b', 'a-x-b'],
  ['${NAME}', 'ALT=x\nTOKEN=a${ALT}b', 'axb'],
  ['a name that ends at a non-name character', 'ALT=x\nTOKEN=$ALT.$ALT/', 'x.x/'],
  ['an unset name reads empty', 'TOKEN=a${MISSING}b$MISSING', 'ab'],
  ['${NAME:-default} for an unset name', 'TOKEN=${MISSING:-fallback}', 'fallback'],
  ['${NAME:-default} for a set name', 'ALT=x\nTOKEN=${ALT:-fallback}', 'x'],
  ['an empty value is a value', 'ALT=\nTOKEN=${ALT:-fallback}', ''],
  ['a default holding a reference', 'ALT=x\nTOKEN=${MISSING:-<${ALT}>}', '<x>'],
  ['a default holding a nested default', 'TOKEN=${A:-${B:-deep}}end', 'deepend'],
  ['an escaped dollar inside a default', 'TOKEN=${MISSING:-\\${}', '${'],
  ['a double-quoted value', 'ALT=x\nTOKEN="a $ALT ${ALT}\\n"', 'a x x\n'],
  ['a multiline double-quoted value', 'ALT=x\nTOKEN="$ALT\n${ALT}"', 'x\nx'],
  [
    'single quotes stay literal',
    "ALT=x\nTOKEN='$ALT ${ALT} ${ALT:-d} \\$'",
    '$ALT ${ALT} ${ALT:-d} \\$',
  ],
  [String.raw`\$ is a dollar when unquoted`, 'ALT=x\nTOKEN=\\$ALT-\\${ALT}', '$ALT-${ALT}'],
  [
    String.raw`\$ is a dollar in double quotes`,
    'ALT=x\nTOKEN="\\$ALT \\\\$ALT"',
    String.raw`$ALT \x`,
  ],
  ['another backslash is no escape when unquoted', 'ALT=x\nTOKEN=a\\n\\x', String.raw`a\n\x`],
  ['$(command) stays literal', 'TOKEN=$(echo hi) and `x`', '$(echo hi) and `x`'],
  ['a dollar before a non-name character', 'TOKEN=a$ b$', 'a$ b$'],
  ['an unclosed ${', 'ALT=x\nTOKEN=${ALT', '${ALT'],
  ['${ with neither a name nor a default', 'TOKEN=${a b} ${} ${-x}', '${a b} ${} ${-x}'],
  [
    'a failed ${ keeps the references inside it literal',
    'ALT=x\nTOKEN=${A$ALT} ${$ALT}-$ALT',
    '${A$ALT} ${$ALT}-x',
  ],
  ['an unclosed ${ keeps the references after it literal', 'ALT=x\nTOKEN=${A$ALT', '${A$ALT'],
  ['a name that starts with a digit', 'TOKEN=$1abc-${2:-d}', '-d'],
  ['a reference does not scan its value again', "ALT='$TOKEN'\nTOKEN=$ALT", '$TOKEN'],
  ['a reference to a later line reads empty', 'TOKEN=[$ALT]\nALT=x', '[]'],
  ['a reference reads the last assignment above it', 'ALT=1\nALT=2\nTOKEN=$ALT\nALT=3', '2'],
  ['a hash ends the value before its references', 'ALT=x\nTOKEN=$ALT#${ALT}', 'x'],
])('a value expands %s', async (_name, content, value) => {
  const result = await runFile(content, { names: ['TOKEN', 'ALT'], settings: null });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env.TOKEN).toBe(value);
});

test('a reference reads the environment first, and never expands the environment value', async () => {
  const result = await readLayers(
    { '.env': 'ALT=file\nTOKEN=$ALT-${NEXT}', '.env.local': 'NEXT=local' },
    { env: { ALT: '$NEXT', NEXT: '' } },
  );
  expect(result.env).toEqual({ ALT: '$NEXT', NEXT: '', TOKEN: '$NEXT-' });
});

test('a reference reads a more specific file, and never a less specific one', async () => {
  const result = await readLayers(
    {
      '.env': 'ALT=base\nNEXT=base\nTOKEN=$ALT-$NEXT',
      '.env.local': 'ALT=local\nTOKEN=$ALT-$NEXT',
    },
    { env: {} },
  );
  expect(result.env).toEqual({ ALT: 'local', NEXT: 'base', TOKEN: 'local-' });
});

test('a reference reads past a name the supplied environment holds as undefined', async () => {
  const result = await runFile(
    { '.env': 'TOKEN=<$ALT>', '.env.local': 'ALT=local' },
    { names: ['TOKEN', 'ALT'], settings: null, unset: ['ALT'] },
  );
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env).toEqual({ ALT: 'local', TOKEN: '<local>' });
});

test('a reference reads a name an allow list keeps the plugin from importing', async () => {
  const result = await runFile('SECRET=s3\nTOKEN=<$SECRET>\n', {
    names: ['TOKEN', 'SECRET'],
    settings: { only: ['TOKEN'] },
  });
  expect(JSON.parse(result.stdout).env).toEqual({ TOKEN: '<s3>' });
});

test.each([
  ['a hash after other text', 'TOKEN=a#b\n', 'a'],
  ['a hash that starts the value', 'TOKEN=#b\n', ''],
  ['a hash after whitespace', 'TOKEN=a #b\n', 'a'],
  ['a URL fragment', 'TOKEN=https://x.test/p#frag\n', 'https://x.test/p'],
  ['a quoted hash', 'TOKEN="https://x.test/p#frag"\n', 'https://x.test/p#frag'],
  ['a single-quoted hash', "TOKEN='a#b'\n", 'a#b'],
])('an unquoted value ends at any hash: %s', async (_name, content, value) => {
  const result = await runFile(content);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env).toEqual({ TOKEN: value });
});

// The plugin follows Bun's startup ordering; the native reference runs before any Application.
test('the plugin reads the values Bun reads for the same layered files', async () => {
  const files = {
    '.env': 'TOKEN=base\nALT=base-$TOKEN\nNEXT=${TOKEN}#comment',
    '.env.local': 'ALT=local-${MISSING:-d}',
    '.env.production': 'TOKEN=mode',
    '.env.production.local': String.raw`NEXT="both $TOKEN \$"`,
  };
  const names = ['TOKEN', 'ALT', 'NEXT'];
  const native = await runFile(files, {
    launchEnv: production,
    mode: 'native',
    names,
    runtime: 'bun',
    settings: null,
  });
  const plugin = await runFile(files, { env: production, names, settings: null });
  expect(JSON.parse(plugin.stdout).env).toEqual(JSON.parse(native.stdout));
});
