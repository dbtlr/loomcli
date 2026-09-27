import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, Command } from '@loomcli/core';
import { describe, expect, it } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { answer } from '../src/completion/answer.js';
import { bashScript } from '../src/completion/bash.js';
import { fishScript } from '../src/completion/fish.js';
import { identifier } from '../src/completion/name.js';
import { zshScript } from '../src/completion/zsh.js';

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

/** Names that would run a command if a script put them into shell source as they are. */
const hostileNames = [
  "evil'; touch pwned; echo '",
  '$(touch pwned)',
  '`touch pwned`',
  String.raw`back\'slash; touch pwned`,
];

/** A name single-quoted in Bash and Zsh. */
function posixQuoted(name: string): string {
  return `'${name.replaceAll("'", String.raw`'\''`)}'`;
}

/** A name single-quoted in Fish, whose single quotes read `\'` and `\\` as escapes. */
function fishQuoted(name: string): string {
  return `'${name.replaceAll('\\', String.raw`\\`).replaceAll("'", String.raw`\'`)}'`;
}

describe('the scripts', () => {
  /** Each script, how its shell quotes a name, and how a bare shell sources it from stdin. */
  const scripts = [
    {
      flags: ['--noprofile', '--norc'],
      quoted: posixQuoted,
      script: bashScript,
      shell: 'bash',
      source: 'source /dev/stdin',
    },
    {
      flags: ['-f'],
      quoted: posixQuoted,
      script: zshScript,
      shell: 'zsh',
      source: 'autoload -U compinit; compinit -u -D; source /dev/stdin',
    },
    {
      flags: ['--no-config'],
      quoted: fishQuoted,
      script: fishScript,
      shell: 'fish',
      source: 'source /dev/stdin',
    },
  ];

  it.each(scripts)(
    'the $shell script carries a hostile name only quoted or encoded',
    ({ quoted, script, shell }) => {
      for (const name of hostileNames) {
        const text = script(name);
        expect(text).toContain(quoted(name));
        expect(text).toContain(`_${identifier(name)}_`);
        // The Zsh #compdef comment carries the name as it is, so it is set aside with the quoted form.
        const rest = text
          .split('\n')
          .filter((line) => shell !== 'zsh' || line !== `#compdef ${name}`)
          .join('\n')
          .replaceAll(quoted(name), '')
          // Fish triggers loading with the name and a space, one quoted string.
          .replaceAll(quoted(`${name} `), '')
          .replaceAll(identifier(name), '');
        expect(rest).not.toMatch(/touch|pwned/u);
      }
    },
  );

  it.each(scripts)('the $shell script evaluates nothing', ({ script }) => {
    const text = script('kit');
    expect(text).not.toMatch(/\beval\b/u);
    expect(text).not.toMatch(/compgen\s+-W/u);
    expect(text).not.toContain('_activeHelp_');
  });

  it.each(scripts)(
    'the $shell script sources without running anything for a hostile name',
    ({ flags, script, shell, source }) => {
      // A shell this machine lacks has nothing to source into; the conformance run requires each.
      const probe = spawnSync(shell, ['-c', 'true']);
      if (probe.error !== undefined) {
        return;
      }
      const directory = mkdtempSync(join(tmpdir(), 'loom-completion-'));
      try {
        for (const name of hostileNames) {
          const result = spawnSync(shell, [...flags, '-c', source], {
            cwd: directory,
            encoding: 'utf8',
            env: { HOME: directory, PATH: process.env.PATH },
            input: script(name),
          });
          expect(result.stderr).toBe('');
          expect(result.status).toBe(0);
          expect(existsSync(join(directory, 'pwned'))).toBe(false);
        }
      } finally {
        rmSync(directory, { force: true, recursive: true });
      }
    },
  );
});
