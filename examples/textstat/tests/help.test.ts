import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const main = new URL('../dist/src/main.js', import.meta.url);

/** A page as its lines, ending with the single newline `out.print` appends. */
function page(...lines: string[]) {
  return { status: 0, stderr: '', stdout: `${lines.join('\n')}\n` };
}

test('textstat --help folds the globals into OPTIONS, because it has no children', () => {
  expect(invoke(main, ['--help'])).toEqual(
    page(
      'textstat · Count bytes, words, or lines across text sources.',
      '',
      '  With no files, textstat counts the text piped to it and names the source "stdin".',
      '',
      'USAGE',
      '  textstat [files...] [options]',
      '',
      'ARGUMENTS',
      '  files  The files to count. Omit them to read piped text.',
      '',
      'OPTIONS',
      '  -m, --metric <metric>        What each row counts.  (default: bytes)',
      '      --min-bytes <min-bytes>  Drop a source smaller than this many bytes.  (default: 0)',
      '      --minimum <minimum>      Drop a source smaller than this many bytes. The larger threshold wins.  (deprecated: Use --min-bytes instead.)',
      '  -t, --total                  Add a total row.',
      '  -h, --help                   Show this help.',
      '  -V, --version                Print the version.',
      '      --explain                Explain the selected command and exit.',
      '',
      'EXAMPLES',
      '  $ textstat one.txt two.txt',
      '  $ textstat --metric words --total *.md',
    ),
  );
});

test('textstat --version prints the name and the declared version', () => {
  expect(invoke(main, ['--version'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'textstat v0.0.0\n',
  });
});
