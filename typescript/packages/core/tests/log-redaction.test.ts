/*
 * Acceptance plan for redaction (docs/core/logging.md#redaction).
 *
 * Redaction is proven when public APIs alone produce these results:
 *
 * - Every reader. An Application that declares `log: { redact: ['password'] }` and installs the
 *   logging plugin, the verbose plugin, and a second `onLog` hook logs `{ password: 'x', user: 'u' }`
 *   at debug under -v: the hook's event, the -v line, and the file record each read "[Redacted]"
 *   and never the value, a placeholder included.
 * - Paths. A dotted path names a key inside a field, steps through every item of an array it meets,
 *   reaches an Error's copy, and adds no key the copy does not hold.
 * - Bound fields. A field bound with `log.with` is redacted as a call's own field is.
 * - Nothing on its own. An Application that declares no redaction keeps every value as written.
 * - Faults. A path that is not a dotted path of nonempty keys is a DeclarationError from the
 *   Application constructor.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, DeclarationError, plugin } from '@loomcli/core';
import type { JsonValue, Log, LogEvent } from '@loomcli/core';
import { logging } from '@loomcli/plugins/logging';
import { verbose } from '@loomcli/plugins/verbose';
import { mockProcess } from '@loomcli/testing';
import { afterAll, expect, test } from 'vite-plus/test';

const root = mkdtempSync(join(tmpdir(), 'loom-redaction-'));

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

/** A plugin whose `onLog` hook keeps every event it hears. */
function collector(heard: LogEvent[]) {
  return plugin('fixture/collector', {
    onLog: (event) => {
      heard.push(event);
    },
  });
}

/** The fields of each event an application that redacts `redact` logs through `logs`. */
async function fieldsOf(
  redact: readonly string[] | undefined,
  logs: (log: Log) => void,
): Promise<Readonly<Record<string, JsonValue>>[]> {
  const heard: LogEvent[] = [];
  const app = new Application('app', {
    plugins: [collector(heard)],
    ...(redact === undefined ? {} : { log: { redact } }),
  }).action(({ log }) => {
    logs(log);
  });
  await app.run({ process: mockProcess() });
  return heard.map((event) => event.fields);
}

test('a redacted field reads [Redacted] in every hook, the -v line, and the log file', async () => {
  const file = join(root, 'app.jsonl');
  const heard: LogEvent[] = [];
  const mock = mockProcess({ argv: ['-v'] });
  await new Application('app', {
    log: { redact: ['password'] },
    plugins: [verbose(), logging({ file, level: 'debug' }), collector(heard)],
  })
    .action(({ log }) => {
      log.debug('Signed in {user} with {password}.', { password: 'x', user: 'u' });
    })
    .run({ process: mock });

  const signedIn = heard.filter((event) => event.plugin === null);
  expect(signedIn).toHaveLength(1);
  const [event] = signedIn;
  expect(event?.fields).toEqual({ password: '[Redacted]', user: 'u' });
  expect(JSON.stringify(event)).not.toContain('x');

  const [line, ...rest] = mock.stderr.text.split('\n');
  expect(line).toBe('› Signed in u with [Redacted].');
  expect(rest).toEqual([`› Logging to ${file}.`, '']);

  const records = readFileSync(file, 'utf8').trim().split('\n');
  expect(records).toHaveLength(1);
  const [record] = records;
  expect(JSON.parse(record ?? 'null')).toMatchObject({
    fields: { password: '[Redacted]', user: 'u' },
  });
  expect(record).not.toContain('x');
});

test('a dotted path names a key inside a field and steps through every item of an array', async () => {
  const fields = await fieldsOf(['user.token', 'accounts.secret', 'error.stack'], (log) => {
    const error = new Error('failed');
    error.stack = 'at secret';
    log.info('Synced.', {
      accounts: [
        { name: 'a', secret: 's1' },
        { name: 'b', secret: 's2' },
        'plain',
        [{ secret: 's3' }],
      ],
      error,
      token: 'top',
      user: { name: 'u', token: 't' },
    });
  });
  expect(fields).toEqual([
    {
      accounts: [
        { name: 'a', secret: '[Redacted]' },
        { name: 'b', secret: '[Redacted]' },
        'plain',
        [{ secret: '[Redacted]' }],
      ],
      error: { message: 'failed', name: 'Error', stack: '[Redacted]' },
      token: 'top',
      user: { name: 'u', token: '[Redacted]' },
    },
  ]);
});

test('a path whose key the copy does not hold adds nothing', async () => {
  const fields = await fieldsOf(['password', 'user.token', 'gone'], (log) => {
    log.info('Nothing to hide.', { gone: undefined, user: 'u' });
  });
  expect(fields).toEqual([{ user: 'u' }]);
});

test('a redacted path covers the whole value under it', async () => {
  const fields = await fieldsOf(['credentials'], (log) => {
    log.info('Loaded.', { credentials: { key: 'k', nested: [1, 2] }, user: 'u' });
  });
  expect(fields).toEqual([{ credentials: '[Redacted]', user: 'u' }]);
});

test('a bound field is redacted as a call field is', async () => {
  const fields = await fieldsOf(['password'], (log) => {
    log.with({ password: 'bound', requestId: 'r1' }).info('Handled.');
  });
  expect(fields).toEqual([{ password: '[Redacted]', requestId: 'r1' }]);
});

test('an Application that declares no redaction keeps every value as written', async () => {
  const fields = await fieldsOf(undefined, (log) => {
    log.info('Signed in.', { password: 'x', secret: 's', token: 't' });
  });
  expect(fields).toEqual([{ password: 'x', secret: 's', token: 't' }]);
});

/** What the Application constructor throws for one redact list, or `undefined`. */
function thrownFor(redact: readonly string[]): unknown {
  try {
    return new Application('app', { log: { redact } }) instanceof Application
      ? undefined
      : 'not an Application';
  } catch (error) {
    return error;
  }
}

test.each([[''], ['.password'], ['password.'], ['user..token'], ['.']])(
  'the constructor rejects the path %j',
  (path) => {
    const thrown = thrownFor(['token', path]);
    expect(thrown).toBeInstanceOf(DeclarationError);
    expect(
      thrown instanceof DeclarationError
        ? {
            correction: thrown.correction,
            rule: thrown.rule?.identity,
            sentence: thrown.sentence,
          }
        : undefined,
    ).toEqual({
      correction: 'List dotted paths of nonempty keys, such as password or user.token.',
      rule: '@loomcli/core/invalid-redact-path',
      sentence: `The Application redacts ${JSON.stringify(path)}, which is not a dotted path of nonempty keys.`,
    });
  },
);

test('the constructor accepts dotted paths of nonempty keys', () => {
  expect(thrownFor(['password', 'user.token', 'a.b.c', 'with space', 'user-id'])).toBeUndefined();
});

test("redacting an Error's message also hides its stack from every reader", async () => {
  const file = join(root, 'error-message.jsonl');
  const heard: LogEvent[] = [];
  const mock = mockProcess({ argv: ['-v'] });
  await new Application('app', {
    log: { redact: ['error.message'] },
    plugins: [verbose(), logging({ file, level: 'debug' }), collector(heard)],
  })
    .action(({ log }) => {
      log.debug('Connection failed: {error}.', {
        error: new Error('connect with hunter2-SECRET'),
      });
    })
    .run({ process: mock });

  const events = heard.filter((event) => event.plugin === null);
  expect(events).toHaveLength(1);
  expect(events[0]?.fields).toEqual({
    error: { message: '[Redacted]', name: 'Error', stack: '[Redacted]' },
  });
  expect(JSON.stringify(heard)).not.toContain('hunter2-SECRET');
  expect(readFileSync(file, 'utf8')).not.toContain('hunter2-SECRET');
  expect(mock.stderr.text).not.toContain('hunter2-SECRET');
  expect(mock.stderr.text).toContain('[Redacted]');
});
