import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { main } from './documents.js';

/** A page as its lines, ending with the single newline `out.print` appends. */
function page(...lines: string[]) {
  return { status: 0, stderr: '', stdout: `${lines.join('\n')}\n` };
}

/** The `select` page, which every invocation that routes to `select` prints. */
const select = page(
  'jsonkit select · Keep the named fields of the document.',
  '',
  'USAGE',
  '  jsonkit select --field <field>... [options]',
  '',
  'OPTIONS',
  '  -F, --field <field>  A field to keep. Repeat it for several.  (required, repeatable)',
  '',
  'GLOBAL OPTIONS',
  '  -f, --file <path>  The document to read. Omit it to read piped text.',
  '  -h, --help         Show this help.',
  '  -V, --version      Print the version.',
  '      --explain      Explain the selected command and exit.',
);

test('jsonkit --help prints the root page', () => {
  expect(invoke(main, ['--help'])).toEqual(
    page(
      'jsonkit · Read and reshape one JSON document.',
      '',
      '  With no subcommand, jsonkit summarizes the document and its top-level keys.',
      '',
      'USAGE',
      '  jsonkit [options]',
      '  jsonkit <command> [options]',
      '',
      'COMMANDS',
      '  get     Read one value at a path.',
      '  keys    List the keys at a path.',
      '  select  Keep the named fields of the document.',
      '',
      'GLOBAL OPTIONS',
      '  -f, --file <path>  The document to read. Omit it to read piped text.',
      '  -h, --help         Show this help.',
      '  -V, --version      Print the version.',
      '      --explain      Explain the selected command and exit.',
      '',
      'EXAMPLES',
      '  $ jsonkit -f doc.json',
      '  $ jsonkit get user.name -f doc.json',
      '',
      'Run jsonkit <command> --help for command details.',
    ),
  );
});

test('jsonkit select --help prints the leaf page of a Command with a required option', () => {
  expect(invoke(main, ['select', '--help'])).toEqual(select);
});

test('jsonkit get --help renders while the required path is missing', () => {
  expect(invoke(main, ['get', '--help'])).toEqual(
    page(
      'jsonkit get · Read one value at a path.',
      '',
      '  A path is a dot-separated walk from the root of the document.',
      '',
      'USAGE',
      '  jsonkit get <path> [options]',
      '',
      'ARGUMENTS',
      '  path  Dot path to read.',
      '',
      'GLOBAL OPTIONS',
      '  -f, --file <path>  The document to read. Omit it to read piped text.',
      '  -h, --help         Show this help.',
      '  -V, --version      Print the version.',
      '      --explain      Explain the selected command and exit.',
      '',
      'EXAMPLES',
      '  $ jsonkit get name -f doc.json',
      '  $ jsonkit get nested.deep.value -f doc.json',
    ),
  );
});

test('jsonkit select --bogus --help renders too, because local tokens are never parsed', () => {
  expect(invoke(main, ['select', '--bogus', '--help'])).toEqual(select);
});

test('jsonkit --version prints the name and the declared version', () => {
  expect(invoke(main, ['--version'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'jsonkit v0.0.0\n',
  });
});

test('jsonkit get --version prints the same line, because the version is an Application fact', () => {
  expect(invoke(main, ['get', '--version'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'jsonkit v0.0.0\n',
  });
});
