import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { main } from './documents.js';

/** The same application, started behind the hook that records each plugin module it loads. */
const loads = new URL('fixtures/loads.mjs', import.meta.url);

/** A page as its lines, ending with the single newline `out.print` appends. */
function page(...lines: string[]) {
  return { status: 0, stderr: '', stdout: `${lines.join('\n')}\n` };
}

/**
 * One invocation with a marks file, so a test reads which plugin middleware modules the invocation
 * evaluated. A module the chain never reached leaves no line.
 */
function loaded(argv: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-jsonkit-marks-'));
  const marks = join(directory, 'marks.txt');
  try {
    const result = invoke(loads, argv, { env: { LOOM_FIXTURE_MARKS: marks } });
    let lines: string[] = [];
    try {
      lines = readFileSync(marks, 'utf8').split('\n').filter(Boolean);
    } catch {
      lines = [];
    }
    return { ...result, marks: lines };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/** The root page, which every invocation help takes over on the root prints. */
const root = page(
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
);

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
  expect(invoke(main, ['--help'])).toEqual(root);
});

test('jsonkit --help --version prints help and never loads the version middleware module', () => {
  const result = loaded(['--help', '--version']);
  expect(result.marks).toEqual(['loaded:help']);
  expect(result).toMatchObject(root);
});

test('jsonkit --version --help prints the same page, because help wins the tie', () => {
  expect(loaded(['--version', '--help'])).toMatchObject(root);
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
