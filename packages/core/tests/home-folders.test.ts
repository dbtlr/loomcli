/**
 * The home and temporary folders a run reads through its process handle, under ADR-0107 and
 * docs/core/host.md#the-home-and-temporary-folders.
 *
 * - processHandle. `home` is the handle's `env.HOME` when it is absolute, else the user database's
 *   home, and `tmpdir` its `env.TMPDIR` when it is absolute, else `/tmp`; a supplied `env` is the
 *   environment they follow, and a supplied `home` or `tmpdir` wins over it.
 * - The host. A run copies both at entry, before environment preparation, so a `HOME` or `TMPDIR`
 *   an environment hook adds reaches `host.env` and moves neither folder. `app.invoke` and an
 *   action's `invoke` read the same folders, and the log destination carries the outermost run's
 *   home.
 */
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { isAbsolute } from 'node:path';
import { Writable } from 'node:stream';

import { expect, test } from 'vite-plus/test';

import { Application, Command, plugin, processHandle } from '../src/index.js';
import type { LogDestination } from '../src/index.js';

/** A stream that keeps what a run writes to it. */
function sink(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  return { stream, text: () => chunks.join('') };
}

/**
 * The home the user database holds for the test's user: `getent` where it runs, which reads every
 * database source, else what Node's `os.userInfo()` reads from the database.
 */
function databaseHome(): string {
  try {
    const entry = execFileSync('getent', ['passwd', String(process.getuid?.())], {
      encoding: 'utf8',
    });
    return entry.trim().split(':')[5] ?? '';
  } catch {
    return userInfo().homedir;
  }
}

/** An application that prints the folders and the variables its action reads. */
const folders = new Application('notes').action(({ host, out }) =>
  out.print(
    JSON.stringify({
      HOME: host.env.HOME,
      TMPDIR: host.env.TMPDIR,
      home: host.home,
      tmpdir: host.tmpdir,
    }),
  ),
);

/** The folders one run of `folders` read on a handle built from the fields. */
async function runFolders(fields: Parameters<typeof processHandle>[0]) {
  const stdout = sink();
  await folders.run({ process: processHandle({ argv: [], ...fields, stdout: stdout.stream }) });
  return JSON.parse(stdout.text());
}

test('an absolute HOME and TMPDIR in the supplied env are the home and the temporary folder', () => {
  const handle = processHandle({ env: { HOME: '/srv/notes', TMPDIR: '/srv/scratch' } });
  expect(handle.home).toBe('/srv/notes');
  expect(handle.tmpdir).toBe('/srv/scratch');
});

test.each([
  ['unset', undefined],
  ['empty', ''],
  ['relative', 'notes/home'],
])('a HOME that is %s gives the user database home', (_case, home) => {
  const handle = processHandle({ env: { HOME: home } });
  expect(handle.home).toBe(databaseHome());
  expect(handle.home === '' || isAbsolute(handle.home)).toBe(true);
});

test.each([
  ['unset', undefined],
  ['empty', ''],
  ['relative', 'scratch'],
])("a TMPDIR that is %s gives /tmp, whatever the machine's TMP and TEMP hold", (_case, tmpdir) => {
  const handle = processHandle({ env: { TEMP: '/srv/temp', TMP: '/srv/tmp', TMPDIR: tmpdir } });
  expect(handle.tmpdir).toBe('/tmp');
});

test('a supplied home and tmpdir win over the environment', () => {
  const handle = processHandle({
    env: { HOME: '/srv/notes', TMPDIR: '/srv/scratch' },
    home: '/home/me',
    tmpdir: '/var/tmp',
  });
  expect(handle.home).toBe('/home/me');
  expect(handle.tmpdir).toBe('/var/tmp');
});

test('a supplied home is what the caller gave, even when it is not absolute', () => {
  expect(processHandle({ env: { HOME: '/srv/notes' }, home: '' }).home).toBe('');
});

test('a run copies the folders into its host', async () => {
  const read = await runFolders({ env: { HOME: '/srv/notes', TMPDIR: '/srv/scratch' } });
  expect(read).toEqual({
    HOME: '/srv/notes',
    TMPDIR: '/srv/scratch',
    home: '/srv/notes',
    tmpdir: '/srv/scratch',
  });
});

test('a HOME and TMPDIR that environment preparation adds reach host.env and move neither folder', async () => {
  const dotenv = plugin('@fixture/dotenv', {
    onEnvironment: () => ({ HOME: '/moved/home', TMPDIR: '/moved/tmp' }),
  });
  const app = new Application('notes', { plugins: [dotenv] }).action(({ host, out }) =>
    out.print(JSON.stringify({ HOME: host.env.HOME, home: host.home, tmpdir: host.tmpdir })),
  );
  const stdout = sink();
  await app.run({
    process: processHandle({ argv: [], env: {}, home: '/home/me', stdout: stdout.stream }),
  });
  expect(JSON.parse(stdout.text())).toEqual({
    HOME: '/moved/home',
    home: '/home/me',
    tmpdir: '/tmp',
  });
});

test("app.invoke and an action's invoke read the handle's folders", async () => {
  const nested = new Command('where', { description: 'Print the folders.' }).action(
    ({ host, out }) => out.print(`${host.home} ${host.tmpdir}`),
  );
  const app = new Application('notes').command(nested).command(
    new Command('outer', { description: 'Invoke where.' }).action(async ({ invoke, out }) => {
      const outcome = await invoke(['where'], {});
      await out.print(outcome.status === 'completed' ? outcome.output : outcome.status);
    }),
  );
  const handle = processHandle({ cwd: '/', env: {}, home: '/home/me', tmpdir: '/var/tmp' });
  const direct = await app.invoke(['where'], {}, { process: handle });
  expect(direct).toMatchObject({ output: '/home/me /var/tmp\n', status: 'completed' });
  const outer = await app.invoke(['outer'], {}, { process: handle });
  expect(outer).toMatchObject({ output: '/home/me /var/tmp\n\n', status: 'completed' });
});

test("an onLog hook's destination carries the run's home", async () => {
  const destinations: LogDestination[] = [];
  const observer = plugin('@fixture/observer', {
    onLog: (_event, destination) => {
      destinations.push(destination);
    },
  });
  const app = new Application('notes', { plugins: [observer] }).action(({ log }) => {
    log.info('hello');
  });
  await app.run({
    process: processHandle({ argv: [], env: { HOME: '/ignored' }, home: '/home/me' }),
  });
  await app.invoke([], {}, { process: processHandle({ cwd: '/', env: {}, home: '/home/you' }) });
  expect(destinations.map(({ home }) => home)).toEqual(['/home/me', '/home/you']);
});
