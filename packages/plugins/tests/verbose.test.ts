/*
 * Acceptance plan for the verbose plugin (docs/plugins/verbose.md#verbose-plugin).
 *
 * - A fixture application installs `verbose()` and declares no verbose-marked or quiet-marked
 *   option of its own. Its action writes one debug line and one result. The plugin's `--help` rows
 *   are proven in help-page.test.ts and its `control` marks in control-marks.test.ts. The
 *   `verbose` and `quiet` marks, and an unmarked counted option reading `false` for both, are
 *   proven in packages/core/tests/verbosity-declarations.test.ts.
 * - `-v` and `-vv` write the debug line on stderr, and no flag, or `-v -q`, writes none. `-q`
 *   writes the result on stdout and nothing on stderr. Piped, the line is `› Reading doc.json.`.
 * - `--verbose=2` fails with the counted unexpected-value error.
 * - An application that marks its own verbose option and installs the plugin fails with the
 *   two-marks error, and so does one that marks its own quiet option. Both are proven in
 *   packages/core/tests/verbosity-declarations.test.ts.
 * - A consumer installs the packed pack, imports `@loomcli/plugins/verbose`, compiles against its
 *   declarations, and `pnpm check:packed` resolves the subpath from the packed tarball under Node
 *   and Bun.
 */
import { Application } from '@loomcli/core';
import { verbose } from '@loomcli/plugins/verbose';
import { expect, test } from 'vite-plus/test';

import { runOnMock } from './fixtures/in-process.ts';

/** An application whose action names the document it reads on a debug line, then prints a result. */
function reader() {
  return new Application('reader', { plugins: [verbose()] }).action(async ({ out }) => {
    await out.debug('Reading doc.json.');
    await out.print('a');
  });
}

test.each([[['-v']], [['-vv']], [['--verbose', '-v']]])(
  '%j writes the debug line on stderr, and the result on stdout',
  async (argv) => {
    await expect(runOnMock(reader(), { argv })).resolves.toEqual({
      status: 0,
      stderr: '› Reading doc.json.\n',
      stdout: 'a\n',
    });
  },
);

test.each([[[]], [['-v', '-q']]])('%j writes no debug line', async (argv) => {
  await expect(runOnMock(reader(), { argv })).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'a\n',
  });
});

test('-q writes the result on stdout and nothing on stderr', async () => {
  await expect(runOnMock(reader(), { argv: ['-q'] })).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'a\n',
  });
});

test('--verbose=2 fails with the counted unexpected-value error', async () => {
  const result = await runOnMock(reader(), { argv: ['--verbose=2'] });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain(
    'reader: Counted option "--verbose" does not accept a value. Repeat "--verbose" to raise its count.\n',
  );
});
