import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { findOnPath } from '../../../scripts/test-shell.js';
import Package from '../package.json' with { type: 'json' };
import { main } from './documents.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-jsonkit-man-'));
  roots.push(root);
  const home = join(root, 'home');
  const state = join(root, 'state');
  mkdirSync(home);
  mkdirSync(state);
  return { home, root, state };
}

/** Every page `generate` writes into a folder, by file name. */
function generated(folder: string, env: Record<string, string | undefined> = {}) {
  const result = invoke(main, ['manpage', 'generate', '--out', folder], { env });
  expect(result.status).toBe(0);
  return pagesIn(folder);
}

/** Every page in a folder, by file name. */
function pagesIn(folder: string): Map<string, string> {
  return new Map(
    readdirSync(folder).map((file): [string, string] => [
      file,
      readFileSync(join(folder, file), 'utf8'),
    ]),
  );
}

/** The page jsonkit-get.1, with the `get` details from get.md, as the contract pins it. */
const getPage = [
  `.TH "JSONKIT\\-GET" "1" "" "jsonkit ${Package.version}" ""`,
  '.SH "NAME"',
  String.raw`jsonkit\-get \- Read one value at a path.`,
  '.SH "SYNOPSIS"',
  '.nf',
  String.raw`\fBjsonkit get\fR <path> [options]`,
  '.fi',
  '.SH "DESCRIPTION"',
  String.raw`A path is a dot\-separated walk from the root of the document.`,
  String.raw`.IP \(bu 2`,
  String.raw`A \fBkey\fR reads an object\(aqs member, such as \fBuser.name\fR.`,
  String.raw`.IP \(bu 2`,
  String.raw`A \fBwhole number\fR reads an array\(aqs item, such as \fBitems.0\fR.`,
  '.PP',
  String.raw`The document is \fIJSON\fR; see the format <https://www.json.org/json\-en.html>.`,
  '.SH "ARGUMENTS"',
  '.TP',
  String.raw`\fIpath\fR`,
  'Dot path to read.',
  '.SH "OPTIONS"',
  '.TP',
  String.raw`\fB\-f\fR, \fB\-\-file\fR <\fIpath\fR>`,
  String.raw`The document to read. Omit it to read piped text.  (file or piped stdin; \- selects stdin, required)`,
  '.SH "EXAMPLES"',
  '.nf',
  String.raw`\fB$ jsonkit get name \-f doc.json\fR`,
  '.fi',
  '.PP',
  '.nf',
  String.raw`\fB$ jsonkit get nested.deep.value \-f doc.json\fR`,
  '.fi',
  '.SH "SEE ALSO"',
  String.raw`\fBjsonkit\fR(1)`,
  '',
].join('\n');

describe('jsonkit manpage', () => {
  it('generate writes jsonkit-get.1 byte for byte', () => {
    const { root } = sandbox();
    expect(generated(join(root, 'man')).get('jsonkit-get.1')).toBe(getPage);
  });

  it('two runs, a run under another HOME, TERM, COLUMNS, and locale, and install write identical pages', () => {
    const box = sandbox();
    const first = generated(join(box.root, 'first'));
    expect(generated(join(box.root, 'second'))).toEqual(first);
    expect(
      generated(join(box.root, 'third'), {
        COLUMNS: '33',
        HOME: box.home,
        LANG: 'fr_FR.UTF-8',
        LC_ALL: 'fr_FR.UTF-8',
        TERM: 'xterm-256color',
      }),
    ).toEqual(first);
    const installed = invoke(main, ['manpage', 'install'], {
      env: { HOME: box.home, MANPATH: undefined, SHELL: undefined, XDG_STATE_HOME: box.state },
    });
    expect(installed.status).toBe(0);
    const folder = join(box.home, '.local', 'share', 'man', 'man1');
    expect(pagesIn(folder)).toEqual(first);
  });

  it('the set holds the root, each visible child, fetch, and each visible plugin Command, and no hidden Command or alias', () => {
    const { root } = sandbox();
    const pages = generated(join(root, 'man'));
    expect(new Set(pages.keys())).toEqual(
      new Set([
        'jsonkit.1',
        'jsonkit-get.1',
        'jsonkit-keys.1',
        'jsonkit-select.1',
        'jsonkit-fetch.1',
        'jsonkit-doctor.1',
        'jsonkit-completion.1',
        'jsonkit-completion-bash.1',
        'jsonkit-completion-zsh.1',
        'jsonkit-completion-fish.1',
        'jsonkit-completion-powershell.1',
        'jsonkit-completion-install.1',
        'jsonkit-completion-update.1',
        'jsonkit-completion-uninstall.1',
        'jsonkit-mcp.1',
        'jsonkit-manpage.1',
        'jsonkit-manpage-generate.1',
        'jsonkit-manpage-install.1',
        'jsonkit-manpage-update.1',
        'jsonkit-manpage-uninstall.1',
      ]),
    );
    const rootPage = pages.get('jsonkit.1') ?? '';
    expect(rootPage).toContain(
      [
        '.TP',
        String.raw`\fBfetch\fR`,
        'Read one value at a path.  (deprecated: Use get instead.)',
      ].join('\n'),
    );
    expect(rootPage).not.toMatch(/debug|paths|__complete|\bls\b/u);
    expect(pages.get('jsonkit-fetch.1')).toContain(
      ['.SH "DESCRIPTION"', 'Deprecated: Use get instead.'].join('\n'),
    );
  });

  it.skipIf(findOnPath('groff') === undefined)('groff reads every page with no warning', () => {
    const { root } = sandbox();
    for (const [file, text] of generated(join(root, 'man'))) {
      const lint = spawnSync('groff', ['-man', '-Tutf8', '-ww', '-z'], {
        encoding: 'utf8',
        input: text,
      });
      expect({ file, stderr: lint.stderr }).toEqual({ file, stderr: '' });
    }
  });

  it.skipIf(findOnPath('mandoc') === undefined)(
    'mandoc reports the missing date of each page and nothing else',
    () => {
      const { root } = sandbox();
      const folder = join(root, 'man');
      for (const file of generated(folder).keys()) {
        const lint = spawnSync('mandoc', ['-T', 'lint', '-W', 'warning', join(folder, file)], {
          encoding: 'utf8',
        });
        const reports = lint.stdout.trim().split('\n');
        expect(reports).toHaveLength(1);
        expect(reports[0]).toMatch(/missing date/u);
      }
    },
  );
});
