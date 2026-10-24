/**
 * The real process's handle reads the C library from the runtime's report only when a run's code
 * reads `host.libc`, once per process, and leaves the report's network section out where the
 * runtime can, because Node resolves every open socket's peer to fill it. This file stands alone
 * so the handle's once-per-process read is still unread when the first test starts.
 */
import { Writable } from 'node:stream';

import { afterEach, expect, test, vi } from 'vite-plus/test';

import { Application, processHandle } from '../src/index.js';

const quiet = () => new Writable({ write: (_chunk, _encoding, done) => done() });

/** Whether the network section was left out while each report was made. */
function spyReports() {
  const { report } = process;
  const excludedDuring: unknown[] = [];
  const spy = vi.spyOn(report, 'getReport').mockImplementation(() => {
    excludedDuring.push(Reflect.get(report, 'excludeNetwork'));
    return { header: { glibcVersionRuntime: '2.41' } };
  });
  return { excludedDuring, spy };
}

afterEach(() => {
  vi.restoreAllMocks();
});

test('the real handle makes no report for a run whose code never reads host.libc', async () => {
  const { spy } = spyReports();
  const app = new Application('notes').action(({ out }) => out.print('done'));
  await app.run({ process: processHandle({ argv: [], stdout: quiet() }) });
  await app.invoke([], {}, { process: processHandle({ stdout: quiet() }) });
  expect(spy).not.toHaveBeenCalled();
});

test('the real handle reads the report once with its network section left out, then restores the setting', async () => {
  const { report } = process;
  const { excludedDuring, spy } = spyReports();
  const before: unknown = Reflect.get(report, 'excludeNetwork');
  const seen: unknown[] = [];
  const app = new Application('notes').action(({ host }) => {
    seen.push(host.libc);
  });
  await app.run({ process: processHandle({ argv: [] }) });
  await app.run({ process: processHandle({ argv: [] }) });
  // Off Linux the handle reads no report and answers undefined.
  // Bun's report has no network section to leave out, so it has no setting to change.
  const linux = process.platform === 'linux';
  expect({ calls: spy.mock.calls.length, excludedDuring, seen }).toEqual({
    calls: linux ? 1 : 0,
    excludedDuring: linux ? ['excludeNetwork' in report ? true : undefined] : [],
    seen: linux ? ['glibc', 'glibc'] : [undefined, undefined],
  });
  expect(Reflect.get(report, 'excludeNetwork')).toBe(before);
});
