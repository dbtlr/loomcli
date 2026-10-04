import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, Command, locate } from '@loomcli/core';
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@loomcli/core';
import { describe, expect, it } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { answer } from '../src/completion/answer.js';
import { bashScript } from '../src/completion/bash.js';
import { fishScript } from '../src/completion/fish.js';
import { identifier } from '../src/completion/name.js';
import { zshScript } from '../src/completion/zsh.js';
import { format } from '../src/format/plugin.js';
import { help } from '../src/help/plugin.js';

const fixture = new URL('fixtures/completion.mjs', import.meta.url);

/** The answer `__complete` writes for the words after the application name. */
function complete(...words: string[]): string {
  const result = invoke(fixture, ['completion', '__complete', '--', ...words]);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  return result.stdout;
}

/** The options in scope on every Command of the fixture, as `--` offers them. */
const globalLines = [
  '--file\tThe document.',
  '--color\tColor output.',
  '--no-color\tColor output.',
  '--help\tShow this help.',
];

/** A validator that accepts any value and publishes exactly the given input-side JSON Schema. */
function shaped(json: Record<string, unknown>): StandardSchemaV1 & StandardJSONSchemaV1 {
  return {
    '~standard': {
      jsonSchema: { input: () => json, output: () => ({}) },
      validate: (value) => ({ value }),
      vendor: 'fixture',
      version: 1,
    },
  };
}

/** Lines joined as the answer frames them: each ends with a newline, the directive last. */
function framed(lines: readonly string[], directive: number): string {
  return [...lines, `:${directive}`].map((line) => `${line}\n`).join('');
}

describe('the answer', () => {
  it('a Command position offers visible canonical children with descriptions reduced to display text', () => {
    expect(complete('')).toBe(
      framed(
        [
          'completion\tPrint a shell completion script.',
          'paths\tWalkall paths.',
          'keys\tList keys.',
          'cache',
        ],
        4,
      ),
    );
    expect(complete('cache', '')).toBe(framed(['clear', 'list\tList entries.'], 4));
    expect(complete('p')).toBe(framed(['paths\tWalkall paths.'], 4));
  });

  it('the completion group offers its shells and never __complete', () => {
    expect(complete('completion', '')).toBe(
      framed(
        [
          'bash\tPrint the Bash completion script.',
          'zsh\tPrint the Zsh completion script.',
          'fish\tPrint the Fish completion script.',
        ],
        4,
      ),
    );
    expect(complete('completion', '_')).toBe(framed([], 4));
  });

  it('an alias, a hidden Command, and a deprecated Command are never offered, and each still routes', () => {
    expect(complete('l')).toBe(framed([], 4));
    expect(complete('d')).toBe(framed([], 4));
    expect(complete('f')).toBe(framed([], 4));
    expect(complete('ls', '--')).toBe(framed(globalLines, 4));
    expect(complete('debug', '--d')).toBe(framed(['--dump'], 4));
    expect(complete('fetch', '--d')).toBe(framed(['--deep'], 4));
  });

  it('an option position offers long spellings, and short ones too when the word is exactly a hyphen', () => {
    expect(complete('paths', '--')).toBe(
      framed([...globalLines, '--format\tThe view.', '--field\tA field.', '--quiet\tSay less.'], 4),
    );
    expect(complete('paths', '-')).toBe(
      framed(
        [
          '--file\tThe document.',
          '--color\tColor output.',
          '--no-color\tColor output.',
          '--help\tShow this help.',
          '-h\tShow this help.',
          '--format\tThe view.',
          '-f\tThe view.',
          '--field\tA field.',
          '--quiet\tSay less.',
          '-q\tSay less.',
        ],
        4,
      ),
    );
    expect(complete('paths', '--n')).toBe(framed(['--no-color\tColor output.'], 4));
    expect(complete('paths', '-q')).toBe(framed([], 4));
  });

  it("a root's own --format before a group's name leaves routing open, so the group's children are offered", () => {
    const table = { render: () => 'table\n' };
    const graph = new Application('store', { plugins: [format()] })
      .command(new Command('cache').command(new Command('list').action(() => {})))
      .result({ views: { table } })
      .action(() => {})
      .inspect();
    expect(answer(graph, locate(graph, ['--format', 'json', 'cache', '']))).toBe(
      answer(graph, locate(graph, ['cache', ''])),
    );
    expect(answer(graph, locate(graph, ['--format', 'json', 'cache', '']))).toBe(
      framed(['list'], 4),
    );
  });

  it("a root's own --format before a group's name leaves routing open for a hyphen word too", () => {
    const table = { render: () => 'table\n' };
    const graph = new Application('store', { plugins: [format(), help()] })
      .command(new Command('cache').command(new Command('list').action(() => {})))
      .result({ views: { table } })
      .action(() => {})
      .inspect();
    const offered = answer(graph, locate(graph, ['cache', '--h']));
    expect(offered).toBe(framed(['--help\tShow this help.'], 4));
    expect(answer(graph, locate(graph, ['--format', 'json', 'cache', '--h']))).toBe(offered);
  });

  it('a value is never offered empty, and never as a word whose first character is a tilde', () => {
    const graph = new Application('kit')
      .command(
        new Command('one')
          .option('v', { type: 'string', validate: shaped({ enum: ['', '~', '~root', 'a~b'] }) })
          .argument('value', { validate: shaped({ enum: ['~root', 'b~c'] }) })
          .action(() => {}),
      )
      .inspect();
    // After a lead the word starts with a hyphen, and no shell expands a tilde after `--v=`.
    expect(answer(graph, locate(graph, ['one', '--v=']))).toBe(
      framed(['--v=~', '--v=~root', '--v=a~b'], 4),
    );
    expect(answer(graph, locate(graph, ['one', '--v', '']))).toBe(framed(['a~b'], 4));
    expect(answer(graph, locate(graph, ['one', '']))).toBe(framed(['b~c'], 4));
  });

  it('a supplied option is not offered again unless it is a multiple string option', () => {
    expect(complete('paths', '--format', 'json', '-q', '--f')).toBe(
      framed(['--file\tThe document.', '--field\tA field.'], 4),
    );
    expect(complete('paths', '--field', 'a', '--fi')).toBe(
      framed(['--file\tThe document.', '--field\tA field.'], 4),
    );
    expect(complete('--file', 'x', 'paths', '--fi')).toBe(framed(['--field\tA field.'], 4));
  });

  it('a value position offers the closed set after its lead, filtered by the typed value', () => {
    expect(complete('paths', '--format', '')).toBe(framed(['json', 'jsonl', 'table'], 4));
    expect(complete('paths', '-f', 't')).toBe(framed(['table'], 4));
    expect(complete('paths', '--format=')).toBe(
      framed(['--format=json', '--format=jsonl', '--format=table'], 4),
    );
    expect(complete('paths', '--format=j')).toBe(framed(['--format=json', '--format=jsonl'], 4));
    expect(complete('paths', '--format=x')).toBe(framed([], 4));
  });

  it('an argument offers exact values once, leaving out every value a shell cannot hold', () => {
    expect(complete('keys', '')).toBe(
      framed(['plain', '$(touch sentinel)', '`touch sentinel`', ';touch sentinel'], 4),
    );
    expect(complete('ls', '$')).toBe(framed(['$(touch sentinel)'], 4));
  });

  it('an input with no closed set and the passthrough tail leave the shell its files', () => {
    expect(complete('--file', '')).toBe(framed([], 0));
    expect(complete('--old', '')).toBe(framed([], 0));
    expect(complete('paths', '--', 'x')).toBe(framed([], 0));
  });

  it('a structural fault offers nothing and reports an error', () => {
    expect(complete('nope', '')).toBe(framed([], 1));
    expect(complete('paths', '--bogus', '')).toBe(framed([], 1));
  });

  it('a typed --help or a hostile word is read as a word and never activates anything', () => {
    expect(complete('--help', '')).toBe(
      framed(
        [
          'completion\tPrint a shell completion script.',
          'paths\tWalkall paths.',
          'keys\tList keys.',
          'cache',
        ],
        4,
      ),
    );
    expect(complete('$(touch sentinel)', '')).toBe(framed([], 1));
  });

  it('a description keeps its first line with every control character removed', () => {
    const graph = new Application('kit')
      .command(new Command('one', { description: 'First.' }).action(() => {}))
      .inspect();
    const [one] = graph.root.children;
    if (one === undefined) {
      throw new Error('The graph holds no child.');
    }
    const root = {
      ...graph.root,
      children: [
        { ...one, description: `Line${String.fromCodePoint(7)} one.\r\nLine two.` },
        { ...one, description: `\t${String.fromCodePoint(8233)}Two.`, name: 'two' },
        { ...one, description: undefined, name: 'three' },
      ],
    };
    expect(answer(graph, { command: root, kind: 'command', prefix: '' })).toBe(
      framed(['one\tLine one.', 'two', 'three'], 4),
    );
  });
});

describe('the Commands', () => {
  it('each shell Command prints its script for the application name in one exact write', () => {
    const shells = { bash: bashScript, fish: fishScript, zsh: zshScript };
    for (const [shell, script] of Object.entries(shells)) {
      expect(invoke(fixture, ['completion', shell])).toEqual({
        status: 0,
        stderr: '',
        stdout: script('kit'),
      });
    }
  });

  it('the completion group lists its visible shells when the subcommand is missing', () => {
    const result = invoke(fixture, ['completion']);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('bash, zsh, fish');
    expect(result.stderr).not.toContain('__complete');
  });

  it('a shell Command reaches help when help is installed', () => {
    const result = invoke(fixture, ['completion', 'bash', '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Print the Bash completion script.');
  });
});

describe('the name', () => {
  it('an identifier keeps ASCII letters and digits and encodes every other code point', () => {
    expect(identifier('jsonkit')).toBe('jsonkit');
    expect(identifier('git-lfs')).toBe('git_2d_lfs');
    expect(identifier('a_b.c')).toBe('a_5f_b_2e_c');
    expect(identifier(`x${String.fromCodePoint(128_512)}`)).toBe('x_1f600_');
    expect(identifier('a-b')).not.toBe(identifier('a_2d_b'));
  });

  it('an empty name has no identifier', () => {
    expect(() => identifier('')).toThrow(TypeError);
  });
});

/** Names outside the portable set, several of which would run a command as shell source. */
const hostileNames = [
  'x\ntouch pwned\n',
  "evil'; touch pwned; echo '",
  '$(touch pwned)',
  '`touch pwned`',
  String.raw`back\'slash; touch pwned`,
  '-x',
  '.x',
  '',
];

/** Portable names, including ones that match a Zsh completion system function's suffix. */
const portableNames = ['kit', 'git-lfs', 'a.b_c', '9', 'describe', 'files', 'arguments'];

/** One shell's script, and the command line a bare shell sources a script file with. */
interface ScriptShell {
  flags: string[];
  script: (name: string) => string;
  shell: string;
  source: string;
}

/**
 * Whether the shell runs here. A missing shell skips its case, unless `LOOM_REQUIRE_SHELLS` is
 * set, when it fails the case, as it fails the conformance suites.
 */
function shellRuns(shell: string): boolean {
  if (spawnSync(shell, ['-c', 'true']).error === undefined) {
    return true;
  }
  if (process.env.LOOM_REQUIRE_SHELLS) {
    throw new Error(`LOOM_REQUIRE_SHELLS is set, but ${shell} not installed.`);
  }
  return false;
}

/**
 * Sources the script text from a file in a fresh directory, then runs `after`, and reports the
 * run and whether a `pwned` file appeared. A file, because a spawned stdin is a socket on Linux,
 * which `/dev/stdin` cannot open.
 */
function sourceScript({ flags, shell, source }: ScriptShell, text: string, after = '') {
  const directory = mkdtempSync(join(tmpdir(), 'loom-completion-'));
  try {
    const file = join(directory, 'script');
    writeFileSync(file, text);
    const result = spawnSync(shell, [...flags, '-c', `${source} '${file}'${after}`], {
      cwd: directory,
      encoding: 'utf8',
      env: { HOME: directory, PATH: process.env.PATH },
    });
    return { pwned: existsSync(join(directory, 'pwned')), result };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

describe('the scripts', () => {
  const bash: ScriptShell = {
    flags: ['--noprofile', '--norc'],
    script: bashScript,
    shell: 'bash',
    source: 'source',
  };
  const scripts: ScriptShell[] = [
    bash,
    {
      flags: ['-f'],
      script: zshScript,
      shell: 'zsh',
      source: 'autoload -U compinit; compinit -u -D; source',
    },
    { flags: ['--no-config'], script: fishScript, shell: 'fish', source: 'source' },
  ];

  it.each(scripts)('the $shell script refuses a name outside the portable set', ({ script }) => {
    for (const name of hostileNames) {
      expect(() => script(name)).toThrow(TypeError);
    }
  });

  it.each(scripts)('the $shell script evaluates nothing', ({ script }) => {
    const text = script('kit');
    expect(text).not.toMatch(/\beval\b/u);
    expect(text).not.toMatch(/compgen\s+-[WfdG]/u);
    expect(text).not.toContain('_activeHelp_');
  });

  it('the Bash script escapes every tilde in a word it inserts, which printf %q may leave bare', () => {
    if (!shellRuns('bash')) {
      return;
    }
    const { result } = sourceScript(
      bash,
      bashScript('kit'),
      String.raw`; for word in "~root" "a b" "a~b" "a=~root" "~~"; do __kit_quote "$word"; printf '%s\n' "$quoted"; done`,
    );
    expect(result).toMatchObject({ status: 0, stderr: '' });
    expect(result.stdout).toBe(String.raw`\~root
a\ b
a\~b
a=\~root
\~\~
`);
  });

  it('the Zsh script for describe, files, or arguments defines none of the completion system functions', () => {
    for (const name of ['describe', 'files', 'arguments']) {
      const text = zshScript(name);
      expect(text).not.toMatch(/^_(?:describe|files|arguments)\s*\(\)/mu);
      expect(text).toMatch(new RegExp(String.raw`^_loom_${name}\(\)$`, 'mu'));
      expect(text).toContain(`compdef _loom_${name} '${name}'`);
    }
  });

  it.each(scripts)(
    'the $shell script sources without running anything for every portable name',
    (entry) => {
      if (!shellRuns(entry.shell)) {
        return;
      }
      for (const name of portableNames) {
        const { pwned, result } = sourceScript(entry, entry.script(name));
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(pwned).toBe(false);
      }
    },
  );
});
