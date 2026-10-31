import { expect, test } from 'vite-plus/test';

import { run } from './run.js';

/** A page as its lines, ending with the single newline `out.print` appends. */
function page(...lines: string[]) {
  return { status: 0, stderr: '', stdout: `${lines.join('\n')}\n` };
}

test('textstat --help folds the globals into OPTIONS, because it has no children', async () => {
  await expect(run(['--help'])).resolves.toEqual(
    page(
      'textstat · Count bytes, words, or lines across text sources.',
      '',
      '  Textstat counts files and piped text in order. Use - to place stdin among the files.',
      '',
      'USAGE',
      '  textstat [files...] [options]',
      '',
      'ARGUMENTS',
      '  files  The files and piped text to count. Use - to place stdin.  (files and piped stdin; - places stdin)',
      '',
      'COUNTING',
      '  MEASURE',
      '    -m, --metric <metric>  What each row counts. One of: bytes, words, lines.  (default: bytes)',
      '  FILTER',
      '    -b, --min-bytes <min-bytes>  Drop a source smaller than this many bytes.  (default: 0, env: TEXTSTAT_MIN_BYTES, config: minBytes)',
      '  SUMMARY',
      '    -t, --total  Add a total row.  (env: TEXTSTAT_TOTAL, config: total)',
      '',
      'OPTIONS',
      '  -f, --format <format>  Select the output format, table by default. One of: table, json, jsonl.',
      '  -h, --help             Show this help.',
      '  -V, --version          Print the version.',
      "  -M, --manifest         Print this command's manifest as JSON.",
      '  -c, --config <config>  Read configuration from this file alone.',
      '      --no-config        Read no configuration file.',
      '  -e, --explain          Explain the selected command and exit.',
      '',
      'EXAMPLES',
      '  $ textstat one.txt two.txt',
      '  $ textstat --metric words --total *.md',
    ),
  );
});

test('textstat -h prints the compact page and points to the details and examples it omits', async () => {
  await expect(run(['-h'])).resolves.toEqual(
    page(
      'textstat · Count bytes, words, or lines across text sources.',
      '',
      'USAGE',
      '  textstat [files...] [options]',
      '',
      'ARGUMENTS',
      '  files  The files and piped text to count. Use - to place stdin.  (files and piped stdin; - places stdin)',
      '',
      'COUNTING',
      '  MEASURE',
      '    -m, --metric <metric>  What each row counts. One of: bytes, words, lines.  (default: bytes)',
      '  FILTER',
      '    -b, --min-bytes <min-bytes>  Drop a source smaller than this many bytes.  (default: 0, env: TEXTSTAT_MIN_BYTES, config: minBytes)',
      '  SUMMARY',
      '    -t, --total  Add a total row.  (env: TEXTSTAT_TOTAL, config: total)',
      '',
      'OPTIONS',
      '  -f, --format <format>  Select the output format, table by default. One of: table, json, jsonl.',
      '  -h, --help             Show this help.',
      '  -V, --version          Print the version.',
      "  -M, --manifest         Print this command's manifest as JSON.",
      '  -c, --config <config>  Read configuration from this file alone.',
      '      --no-config        Read no configuration file.',
      '  -e, --explain          Explain the selected command and exit.',
      '',
      'Run textstat --help for details and examples.',
    ),
  );
});

test("textstat -ht mixes help's letter with the root's total and prints the compact page", async () => {
  const compact = await run(['-h']);
  expect(compact.status).toBe(0);
  await expect(run(['-ht'])).resolves.toEqual(compact);
});

test('textstat --version prints the name and the declared version', async () => {
  await expect(run(['--version'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'textstat v0.0.0\n',
  });
});

test.each(['--help', '--version'])(
  'textstat %s takes over a file preparation failure',
  async (spelling) => {
    const expected = await run([spelling]);
    expect(expected.status).toBe(0);
    await expect(run(['missing-fixture.txt', spelling])).resolves.toEqual(expected);
  },
);

test.each([40, 60])('textstat --help fits a %i-column terminal', async (columns) => {
  const result = await run(['--help'], { columns });
  expect(result.status).toBe(0);
  expect(result.stdout.split('\n').filter((line) => line.length > columns)).toEqual([]);
});

test.each([40, 60])(
  'textstat -h shows its bindings and fits a %i-column terminal',
  async (columns) => {
    const result = await run(['-h'], { columns });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('TEXTSTAT_MIN_BYTES');
    expect(result.stdout).toContain('minBytes');
    expect(result.stdout.split('\n').filter((line) => line.length > columns)).toEqual([]);
  },
);
