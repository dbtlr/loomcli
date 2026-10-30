/*
 * Acceptance plan for the dotenv plugin (docs/plugins/dotenv.md#dotenv-plugin).
 *
 * Acceptance covers parser behavior, warning recovery, empty-value precedence, env-bound options,
 * host isolation, child-process visibility, and named invocation capture. The packed consumer also
 * proves the public subpath, emitted types, argv publication, and named isolation under Node and
 * Bun.
 */

// Substitution syntax is intentional input for the references the plugin expands.
/* oxlint-disable eslint/no-template-curly-in-string */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/dotenv-run.mjs', import.meta.url);

/** The allow list most tests install, so an unlisted name shows what the list leaves out. */
const listed = ['TOKEN', 'ALT', 'EMPTY', 'SET', 'NEXT', 'ENABLED'];

/**
 * Runs the fixture in a directory holding the given files: a string is the `.env` file, and a
 * record maps each file name to its text.
 */
function runFile(
  content: string | Record<string, string> | undefined,
  options: {
    env?: Record<string, string> | undefined;
    launchEnv?: Record<string, string>;
    directory?: boolean;
    unreadable?: string;
    mode?: string;
    names?: readonly string[];
    runtime?: string;
    settings?: unknown;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-dotenv-'));
  try {
    if (options.directory === true) {
      mkdirSync(join(directory, '.env'));
    } else if (typeof content === 'string') {
      writeFileSync(join(directory, '.env'), content);
    } else {
      for (const [name, text] of Object.entries(content ?? {})) {
        writeFileSync(join(directory, name), text);
      }
    }
    return invoke(fixture, [options.mode ?? 'run'], {
      cwd: directory,
      ...(options.runtime === undefined ? {} : { runtime: options.runtime }),
      env: {
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
        TOKEN: undefined,
      },
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test('dotenv with no settings imports every variable the file defines that the process has not set', () => {
  const result = runFile('TOKEN=file\nUNLISTED=also\nSET=replace\n', {
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

test('an except list imports every variable but the ones it lists', () => {
  const result = runFile('TOKEN=file\nUNLISTED=hidden\n', { settings: { except: ['UNLISTED'] } });
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
  (_name, settings, stderr) => {
    const result = runFile('OTHER no-equals\nNEXT=ok\n', { settings });
    expect(result).toMatchObject({ status: 0, stderr });
    expect(JSON.parse(result.stdout).env).toEqual({ NEXT: 'ok' });
  },
);

test('an only list imports only the variables it lists and supplies an env-bound option', () => {
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
  const result = runFile('FORCE_COLOR=1\n', {
    mode: 'color',
    names: ['FORCE_COLOR'],
    settings: { only: ['FORCE_COLOR'] },
  });
  expect(result).toMatchObject({ status: 0, stderr: '', stdout: '\u001b[1mcolored\u001b[22m\n' });
});

test('valid variable names that also name object properties reach the process as own values', () => {
  const result = runFile('constructor=file\n', {
    mode: 'process',
    names: ['constructor'],
    settings: { only: ['constructor'] },
  });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  const names = { constructor: 'file' };
  expect(JSON.parse(result.stdout)).toMatchObject({ env: names, processEnv: names });
  const snapshot = runFile('__proto__=file\n', {
    names: ['__proto__'],
    settings: { only: ['__proto__'] },
  });
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
  const unreadable = runFile(undefined, { unreadable: '.env' });
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
])('dotenv parses %s', (_name, content, value) => {
  const result = runFile(content);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env).toEqual({ TOKEN: value });
});

test('a single-quoted private key spans its lines as one value, and no line of it becomes a name', () => {
  const key = [
    '-----BEGIN PRIVATE KEY-----',
    'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7xyzSECRETabc',
    'AbcDefGhiJklMnoPqrStuVwxYz0123456789secretPartTwo==',
    '-----END PRIVATE KEY-----',
  ].join('\n');
  const result = runFile(`PRIVATE_KEY='${key}'\nDB_URL=postgres://x\n`, {
    names: ['PRIVATE_KEY', 'DB_URL', 'AbcDefGhiJklMnoPqrStuVwxYz0123456789secretPartTwo'],
    settings: null,
  });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env).toEqual({ DB_URL: 'postgres://x', PRIVATE_KEY: key });
});

test('an unterminated single quote consumes the rest of the file and warns once for its line', () => {
  const result = runFile("TOKEN='secret-value\nNEXT=hidden\nMIIsecret==\n", { settings: null });
  expect(result).toMatchObject({ status: 0, stderr: warning('TOKEN', 1) });
  expect(JSON.parse(result.stdout).env).toEqual({});
  expect(result.stderr).not.toContain('secret');
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

/** Runs the plugin over the given files with every name imported, and returns the names it read. */
function readLayers(
  files: Record<string, string>,
  options: { env?: Record<string, string>; names?: readonly string[] } = {},
) {
  const result = runFile(files, {
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
])('the more specific file wins: %s', (_name, files, value) => {
  const result = readLayers(files, { env: production });
  expect(result).toMatchObject({ env: { TOKEN: value }, status: 0, stderr: '' });
});

test('each layered file contributes the names the others leave unset', () => {
  const result = readLayers(
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

test('a variable the environment holds beats every file, empty included', () => {
  const files = { '.env': 'TOKEN=base', '.env.production.local': 'TOKEN=both\nALT=both' };
  expect(readLayers(files, { env: { ...production, TOKEN: 'shell' } }).env).toEqual({
    ALT: 'both',
    TOKEN: 'shell',
  });
  expect(readLayers(files, { env: { ...production, TOKEN: '' } }).env).toEqual({
    ALT: 'both',
    TOKEN: '',
  });
});

test.each([
  ['unset', {}],
  ['empty', { NODE_ENV: '' }],
])('with NODE_ENV %s the plugin reads .env and .env.local alone', (_name, env) => {
  const result = readLayers(
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

test('the mode is read as written, and a file for another mode is not read', () => {
  const files = { '.env': 'TOKEN=base', '.env.Production': 'TOKEN=cased', '.env.staging': 'ALT=x' };
  expect(readLayers(files, { env: production }).env).toEqual({ TOKEN: 'base' });
  expect(readLayers(files, { env: { NODE_ENV: 'Production' } }).env).toEqual({ TOKEN: 'cased' });
});

test('under the test mode the plugin skips .env.local and reads the other three', () => {
  const result = readLayers(
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

test('a file the mode names twice is read once, at its more specific place', () => {
  const result = readLayers(
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

test('a variable a file defines never chooses the mode the plugin reads', () => {
  const result = readLayers(
    { '.env': 'NODE_ENV=production\nTOKEN=base', '.env.production': 'TOKEN=mode' },
    {
      names: ['NODE_ENV', 'TOKEN'],
    },
  );
  expect(result.env).toEqual({ NODE_ENV: 'production', TOKEN: 'base' });
});

test('a malformed assignment in one file never erases a valid one in another', () => {
  const result = readLayers(
    { '.env': 'TOKEN=base', '.env.production': 'TOKEN no-equals\nALT=mode' },
    { env: production },
  );
  expect(result).toMatchObject({
    env: { ALT: 'mode', TOKEN: 'base' },
    status: 0,
    stderr: warning('TOKEN', 1, '.env.production'),
  });
});

test('warnings name their file and come in the order the plugin reads the files', () => {
  const result = readLayers(
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

test('a layered file that is missing or is a directory is silent', () => {
  const result = runFile({ '.env': 'TOKEN=base' }, { env: production, settings: null });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env).toEqual({ TOKEN: 'base' });
});

test('an unreadable layered file warns once with its name while the other files contribute', () => {
  const result = runFile(
    { '.env': 'TOKEN=base', '.env.production': 'ALT=mode' },
    { env: production, names: ['TOKEN', 'ALT', 'NEXT'], settings: null, unreadable: '.env.local' },
  );
  expect(result).toMatchObject({
    status: 0,
    stderr: '⚠ Skipped .env.local: the file could not be read. Make it readable, or remove it.\n',
  });
  expect(JSON.parse(result.stdout).env).toEqual({ ALT: 'mode', TOKEN: 'base' });
});

test('an allow list and a deny list apply to every layered file', () => {
  const files = { '.env': 'TOKEN=base\nNEXT=base', '.env.production': 'TOKEN=mode\nNEXT=mode' };
  const only = runFile(files, { env: production, settings: { only: ['TOKEN'] } });
  expect(JSON.parse(only.stdout).env).toEqual({ TOKEN: 'mode' });
  const except = runFile(files, { env: production, settings: { except: ['TOKEN'] } });
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
  ['a name that starts with a digit', 'TOKEN=$1abc-${2:-d}', '-d'],
  ['a reference does not scan its value again', "ALT='$TOKEN'\nTOKEN=$ALT", '$TOKEN'],
  ['a reference to a later line reads empty', 'TOKEN=[$ALT]\nALT=x', '[]'],
  ['a reference reads the last assignment above it', 'ALT=1\nALT=2\nTOKEN=$ALT\nALT=3', '2'],
  ['a hash ends the value before its references', 'ALT=x\nTOKEN=$ALT#${ALT}', 'x'],
])('a value expands %s', (_name, content, value) => {
  const result = runFile(content, { names: ['TOKEN', 'ALT'], settings: null });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env.TOKEN).toBe(value);
});

test('a reference reads the environment first, and never expands the environment value', () => {
  const result = readLayers(
    { '.env': 'ALT=file\nTOKEN=$ALT-${NEXT}', '.env.local': 'NEXT=local' },
    { env: { ALT: '$NEXT', NEXT: '' } },
  );
  expect(result.env).toEqual({ ALT: '$NEXT', NEXT: '', TOKEN: '$NEXT-' });
});

test('a reference reads a more specific file, and never a less specific one', () => {
  const result = readLayers(
    {
      '.env': 'ALT=base\nNEXT=base\nTOKEN=$ALT-$NEXT',
      '.env.local': 'ALT=local\nTOKEN=$ALT-$NEXT',
    },
    { env: {} },
  );
  expect(result.env).toEqual({ ALT: 'local', NEXT: 'base', TOKEN: 'local-' });
});

test('a reference reads a name an allow list keeps the plugin from importing', () => {
  const result = runFile('SECRET=s3\nTOKEN=<$SECRET>\n', {
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
])('an unquoted value ends at any hash: %s', (_name, content, value) => {
  const result = runFile(content);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout).env).toEqual({ TOKEN: value });
});

// Bun loads these files itself before the plugin runs. The values the plugin reads under Node are
// The values Bun reads for the same project, which is why the plugin follows Bun's order.
test('the plugin reads under Node the values Bun reads for the same layered files', () => {
  const files = {
    '.env': 'TOKEN=base\nALT=base-$TOKEN\nNEXT=${TOKEN}#comment',
    '.env.local': 'ALT=local-${MISSING:-d}',
    '.env.production': 'TOKEN=mode',
    '.env.production.local': String.raw`NEXT="both $TOKEN \$"`,
  };
  const names = ['TOKEN', 'ALT', 'NEXT'];
  const bun = runFile(files, {
    launchEnv: production,
    mode: 'native',
    names,
    runtime: 'bun',
    settings: null,
  });
  const node = runFile(files, { env: production, names, runtime: 'node', settings: null });
  expect(JSON.parse(node.stdout).env).toEqual(JSON.parse(bun.stdout));
});
