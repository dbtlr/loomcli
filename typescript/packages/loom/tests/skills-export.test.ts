import type Fs from 'node:fs';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { assertSkillsMatch, mockProcess } from '@loomcli/testing';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { put, removeRoots, temporaryRoot } from './fixture.js';
import { makeApplication } from './fixtures/export-application.js';
import { fixturePackage, loom, snapshot } from './package.js';

vi.mock('node:fs', async (original) => {
  const { ceiled } = await import('./ceiling.js');
  return ceiled(await original<typeof Fs>());
});

afterEach(removeRoots);

function fixture() {
  return fixturePackage(
    {
      'package.json': '{"type":"module"}',
      'src/application.ts': readFileSync(
        new URL('fixtures/export-application.ts', import.meta.url),
        'utf8',
      ),
    },
    ['core', 'plugins'],
  );
}

test('export equals a real install byte for byte and mode for mode, is idempotent, and passes the assertion', async () => {
  const root = fixture();
  const args = ['skills', 'export', 'committed'];
  const first = await loom(root, args);
  expect(first.stderr).toBe('');
  expect(first.status).toBe(0);
  const home = temporaryRoot('loom-export-home-');
  const process = mockProcess({
    argv: ['skills', 'install', '--agent', 'claude'],
    ceiling: root,
    cwd: root,
    env: {},
    home,
    platform: 'linux',
  });
  await makeApplication().run({ process });
  expect(process.exitCode).toBe(0);
  const installed = join(home, '.claude/skills');
  const output = join(root, 'committed');
  expect(snapshot(output)).toEqual(snapshot(installed));
  for (const file of snapshot(output).keys()) {
    expect(lstatSync(join(output, file)).mode & 0o777).toBe(
      lstatSync(join(installed, file)).mode & 0o777,
    );
  }
  await assertSkillsMatch(makeApplication(), output);
  const before = snapshot(output);
  const second = await loom(root, args);
  expect(second.status).toBe(0);
  expect(snapshot(output)).toEqual(before);
  await expect(assertSkillsMatch(makeApplication('Manage notes.'), output)).rejects.toThrow(
    'notes/references/commands/index.md',
  );
});

test('named export replaces only selected skill folders and removes stale files', async () => {
  const root = fixture();
  put(root, 'committed/notes/SKILL.md', '# Old');
  put(root, 'committed/notes/stale', 'Old');
  put(root, 'committed/sibling/keep', 'Keep');
  const result = await loom(root, ['skills', 'export', 'committed', '--skill', 'notes']);
  expect(result.status).toBe(0);
  expect(existsSync(join(root, 'committed/notes/stale'))).toBe(false);
  expect(existsSync(join(root, 'committed/other'))).toBe(false);
  expect(readFileSync(join(root, 'committed/sibling/keep'), 'utf8')).toBe('Keep');
});

test('an unknown skill fails before writing any skill', async () => {
  const root = fixture();
  const result = await loom(root, ['skills', 'export', 'committed', '--skill', 'missing']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Skill "missing" is not declared.');
  expect(existsSync(join(root, 'committed'))).toBe(false);
});

test.each([
  { plugins: '', sentence: 'records no skills plugin' },
  {
    plugins: "plugins: [skills({ folder: new URL('../skills/', import.meta.url) })],",
    sentence: 'holds no skill',
  },
])('$sentence fails with a correction', async ({ plugins, sentence }) => {
  const root = fixture();
  put(root, 'skills/.keep', '');
  put(
    root,
    'src/application.ts',
    `import { Application } from '@loomcli/core';\nimport { skills } from '@loomcli/plugins/skills';\nexport const app = new Application('notes', { description: 'Notes.', ${plugins} }).action(() => {});`,
  );
  const result = await loom(root, ['skills', 'export', 'committed']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(sentence);
});

test('configured application and a relative skills folder resolve from the package and module', async () => {
  const root = fixture();
  put(root, 'loom.config.json', '{"paths":{"application":"lib/app.ts"}}');
  put(
    root,
    'lib/app.ts',
    `import { Application } from '@loomcli/core';
import { skills } from '@loomcli/plugins/skills';
export const app = new Application('notes', { description: 'Notes.', plugins: [skills({ folder: 'skills' })] });`,
  );
  put(root, 'lib/skills/notes/SKILL.md', '# Relative');
  const result = await loom(root, ['skills', 'export', 'committed']);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(readFileSync(join(root, 'committed/notes/SKILL.md'), 'utf8')).toBe('# Relative');
});

test('a module that throws is reported as a load diagnostic', async () => {
  const root = fixture();
  put(root, 'src/application.ts', 'throw new Error("broken module");');
  const result = await loom(root, ['skills', 'export', 'committed']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('src/application.ts threw while it loaded: Error: broken module');
  expect(result.stderr).toContain('Fix the code that throws');
});

test('a file blocking output gets a system-cause sentence', async () => {
  const root = fixture();
  put(root, 'committed', 'A file');
  const result = await loom(root, ['skills', 'export', 'committed']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('because a path on the way is a file');
  expect(result.stderr).toContain('then run the command again');
});

test('two exported Applications fail before writing', async () => {
  const root = fixture();
  put(
    root,
    'src/application.ts',
    `import { Application } from '@loomcli/core';
export const a = new Application('a', { description: 'A.' });
export const b = new Application('b', { description: 'B.' });`,
  );
  const result = await loom(root, ['skills', 'export', 'committed']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('exports 2 Applications');
  expect(existsSync(join(root, 'committed'))).toBe(false);
});

test.each([
  'throw new Error("broken loader")',
  'await import("node:fs/promises").then(fs => fs.readFile(new URL("./missing", import.meta.url)))',
])('a failing loader reports author code and writes nothing: %s', async (body) => {
  const root = fixture();
  put(
    root,
    'src/application.ts',
    `import { Application } from '@loomcli/core';
import { skills } from '@loomcli/plugins/skills';
export const app = new Application('notes', { description: 'Notes.', plugins: [skills({ skills: [{ name: 'notes', files: async () => { ${body}; return []; } }] })] });`,
  );
  const result = await loom(root, ['skills', 'export', 'committed']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    'The files loader of skill "notes" in src/application.ts threw: ',
  );
  expect(result.stderr).toContain(
    'Fix the files loader of skill "notes" and run loom skills export again.',
  );
  expect(existsSync(join(root, 'committed'))).toBe(false);
});

test.each([
  ['nothing', '{ }'],
  [
    'one file and not a list',
    '{ return { path: "SKILL.md", content: "# Notes", executable: false }; }',
  ],
])('a loader that answers %s is named, and its loader is the fix', async (_label, block) => {
  const root = fixture();
  put(
    root,
    'src/application.ts',
    `import { Application } from '@loomcli/core';
import { skills } from '@loomcli/plugins/skills';
export const app = new Application('notes', { description: 'Notes.', plugins: [skills({ skills: [{ name: 'notes', files: async () => ${block} }] })] });`,
  );
  const result = await loom(root, ['skills', 'export', 'committed']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    'The files loader of skill "notes" in src/application.ts threw: ',
  );
  expect(result.stderr).toContain(
    'Fix the files loader of skill "notes" and run loom skills export again.',
  );
  expect(result.stderr).not.toContain('skills-read-failed');
  expect(existsSync(join(root, 'committed'))).toBe(false);
});

test('a loader whose answer breaks a declaration rule still prints that rule', async () => {
  const root = fixture();
  put(
    root,
    'src/application.ts',
    `import { Application } from '@loomcli/core';
import { skills } from '@loomcli/plugins/skills';
export const app = new Application('notes', { description: 'Notes.', plugins: [skills({ skills: [{ name: 'notes', files: async () => [] }] })] });`,
  );
  const result = await loom(root, ['skills', 'export', 'committed']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('@loomcli/plugins/skills/files');
  expect(result.stderr).toContain('Skill "notes" lists no SKILL.md.');
  expect(result.stderr).not.toContain('skill-loader-failed');
  expect(existsSync(join(root, 'committed'))).toBe(false);
});

test.each(['skills', 'skills/inside'])(
  'refuses output overlapping source at %s without changing it',
  async (output) => {
    const root = fixture();
    put(
      root,
      'src/application.ts',
      `import { Application } from '@loomcli/core';
import { skills } from '@loomcli/plugins/skills';
export const app = new Application('notes', { description: 'Notes.', plugins: [skills({ folder: '../skills' })] });`,
    );
    put(root, 'skills/notes/SKILL.md', '# Notes');
    put(root, 'skills/.keep', 'Keep');
    const before = snapshot(join(root, 'skills'));
    const result = await loom(root, ['skills', 'export', output]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("application's skills folder");
    expect(snapshot(join(root, 'skills'))).toEqual(before);
  },
);

test.each(['directory', 'file', 'link'])(
  'refuses a destination that export did not write: %s',
  async (kind) => {
    const root = fixture();
    put(root, 'committed/notes/keep', 'Keep');
    if (kind !== 'directory') {
      const fs = await import('node:fs');
      fs.rmSync(join(root, 'committed/notes'), { recursive: true });
      if (kind === 'file') {
        put(root, 'committed/notes', 'Keep');
      } else {
        put(root, 'original/SKILL.md', '# Original');
        fs.symlinkSync(join(root, 'original'), join(root, 'committed/notes'));
      }
    }
    const before = snapshot(join(root, 'committed'));
    const result = await loom(root, ['skills', 'export', 'committed']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('it is not a skill folder, which holds a SKILL.md');
    expect(snapshot(join(root, 'committed'))).toEqual(before);
    expect(lstatSync(join(root, 'committed/notes')).isSymbolicLink()).toBe(kind === 'link');
  },
);

test.each(['directory', 'link'])('refuses a folder whose SKILL.md is a %s', async (kind) => {
  const root = fixture();
  if (kind === 'directory') {
    put(root, 'committed/notes/SKILL.md/inside', 'Not a skill');
  } else {
    const fs = await import('node:fs');
    put(root, 'elsewhere/SKILL.md', '# Elsewhere');
    put(root, 'committed/notes/keep', 'Keep');
    fs.symlinkSync(join(root, 'elsewhere/SKILL.md'), join(root, 'committed/notes/SKILL.md'));
  }
  put(root, 'committed/notes/keep', 'Keep');
  const before = snapshot(join(root, 'committed'));
  const result = await loom(root, ['skills', 'export', 'committed']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('it is not a skill folder, which holds a SKILL.md');
  expect(snapshot(join(root, 'committed'))).toEqual(before);
});

test('a graph DeclarationError stays its own diagnostic', async () => {
  const root = fixture();
  put(
    root,
    'src/application.ts',
    `import { Application, DeclarationError, diagnosticRule, plugin } from '@loomcli/core';
const rejected = diagnosticRule('@notes/judge/rejected', { headline: 'Rejected graph', explanation: 'The judge rejects this graph.' });
const judge = plugin('@notes/judge', { onGraphBuilt: () => { throw new DeclarationError(rejected, { sentence: 'The judge rejects the graph.', correction: 'Remove the judge.' }); } });
export const app = new Application('notes', { description: 'Notes.', plugins: [judge] }).action(() => {});`,
  );
  const result = await loom(root, ['skills', 'export', 'committed']);
  expect(result.status).toBe(1);
  expect(result.stderr).not.toContain('@loomcli/loom/application-load-failed');
  expect(result.stderr).not.toContain('warning:');
  expect(result.stderr).toContain('The judge rejects the graph.');
  expect(result.stderr).toContain('Remove the judge.');
  expect(existsSync(join(root, 'committed'))).toBe(false);
});

test('a relative output resolves from a different working directory', async () => {
  const root = fixture();
  put(root, 'work/.keep', '');
  const result = await loom(join(root, 'work'), ['skills', 'export', '../committed']);
  expect(result.status).toBe(0);
  expect(readFileSync(join(root, 'committed/notes/SKILL.md'), 'utf8')).toContain('Notes');
});

test('an output parent cannot replace the source skill folder', async () => {
  const root = fixture();
  put(
    root,
    'src/application.ts',
    `import { Application } from '@loomcli/core';
import { skills } from '@loomcli/plugins/skills';
export const app = new Application('notes', { description: 'Notes.', plugins: [skills({ folder: '../notes', skills: [{ name: 'notes', files: () => [{ path: 'SKILL.md', content: '# Listed' }] }] })] });`,
  );
  put(root, 'notes/other/SKILL.md', '# Other');
  const before = snapshot(join(root, 'notes'));
  const result = await loom(root, ['skills', 'export', '.']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("application's skills folder");
  expect(snapshot(join(root, 'notes'))).toEqual(before);
});

test('a DeclarationError while loading stays its own diagnostic', async () => {
  const root = fixture();
  put(
    root,
    'src/application.ts',
    `import { DeclarationError, diagnosticRule } from '@loomcli/core';
throw new DeclarationError(diagnosticRule('@notes/app/declaration', { headline: 'Notes declaration failed', explanation: 'The notes declaration failed.' }), { sentence: 'The notes declaration is broken.', correction: 'Fix the declaration.' });`,
  );
  const result = await loom(root, ['skills', 'export', 'committed']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('NOTES DECLARATION FAILED');
  expect(result.stderr).toContain('Fix the declaration.');
  expect(result.stderr).not.toContain('@loomcli/loom/application-load-failed');
  expect(result.stderr).not.toContain('warning:');
  expect(existsSync(join(root, 'committed'))).toBe(false);
});

test('all destination checks finish before any skill is written', async () => {
  const root = fixture();
  put(root, 'committed/other/keep', 'Keep');
  const before = snapshot(join(root, 'committed'));
  const result = await loom(root, ['skills', 'export', 'committed']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('it is not a skill folder, which holds a SKILL.md');
  expect(existsSync(join(root, 'committed/notes'))).toBe(false);
  expect(snapshot(join(root, 'committed'))).toEqual(before);
});

/**
 * An application whose second skill's files loader throws. `entry` rewrites what the skills plugin
 * records for the graph, given the plugin's own record as `recorded`, so a test reads the graph
 * through a reader another copy of the plugin could have recorded.
 */
function throwingReview(entry = 'recorded'): string {
  return `import { Application } from '@loomcli/core';
import { skills } from '@loomcli/plugins/skills';
class Graphs extends WeakMap {
  set(graph, recorded) { return super.set(graph, ${entry}); }
}
Reflect.set(globalThis, Symbol.for('@loomcli/plugins/skills/graphs'), new Graphs());
const review = () => { throw new Error('The review skill broke.'); };
export const app = new Application('notes', { description: 'Notes.', plugins: [skills({ skills: [{ name: 'notes', files: () => [{ content: '# Notes', path: 'SKILL.md' }] }, { name: 'review', files: review }] })] });`;
}

/** The diagnostic of a loader that threw where the bin cannot tell which skill's it was. */
const unnamedLoader = [
  '-- SKILL FILES LOADER FAILED ----------------- @loomcli/loom/skill-loader-failed',
  '',
  "A skill's files loader in src/application.ts threw: Error: The review skill broke.",
  '',
  'loom skills export loaded the application, but the author code that supplies the',
  'files of a skill threw, so nothing was written.',
  '',
  'Fix the skill files loader and run loom skills export again.',
  '',
].join('\n');

test("a skill's files loader that throws names its skill and writes nothing", async () => {
  const root = fixture();
  put(root, 'src/application.ts', throwingReview());
  const result = await loom(root, ['skills', 'export', 'committed']);
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    [
      '-- SKILL FILES LOADER FAILED ----------------- @loomcli/loom/skill-loader-failed',
      '',
      'The files loader of skill "review" in src/application.ts threw: Error: The review skill broke.',
      '',
      'loom skills export loaded the application, but the author code that supplies the',
      'files of a skill threw, so nothing was written.',
      '',
      'Fix the files loader of skill "review" and run loom skills export again.',
      '',
    ].join('\n'),
  );
  expect(existsSync(join(root, 'committed'))).toBe(false);
});

test('a reader that throws while no loader runs reports a fault of @loomcli/plugins', async () => {
  const root = fixture();
  put(
    root,
    'src/application.ts',
    throwingReview("{ ...recorded, read: () => Promise.reject(new Error('The reader broke.')) }"),
  );
  const result = await loom(root, ['skills', 'export', 'committed']);
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    [
      '-- SKILLS FAILED TO READ ---------------------- @loomcli/loom/skills-read-failed',
      '',
      "@loomcli/plugins threw outside every skill's files loader while it read the skills of src/application.ts: Error: The reader broke.",
      '',
      'loom skills export loaded the application, then asked the @loomcli/plugins the',
      'package resolves for the files of its skills. The plugin threw while no files',
      'loader ran, so nothing was written.',
      '',
      'Install @loomcli/plugins and @loomcli/core at one version, then run loom skills export again.',
      '',
    ].join('\n'),
  );
  expect(existsSync(join(root, 'committed'))).toBe(false);
});

test("an earlier plugin's reader, which reports no loader, keeps the loader diagnostic that names no skill", async () => {
  const root = fixture();
  put(
    root,
    'src/application.ts',
    throwingReview('{ format: 1, read: (graph, options) => recorded.read(graph, options) }'),
  );
  const result = await loom(root, ['skills', 'export', 'committed']);
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(unnamedLoader);
  expect(existsSync(join(root, 'committed'))).toBe(false);
});

test('a throw while two loaders run names neither skill', async () => {
  const root = fixture();
  put(
    root,
    'src/application.ts',
    throwingReview(
      "{ ...recorded, read: (graph, options, report) => { report({ loader: 'started', skill: 'other' }); return recorded.read(graph, options, report); } }",
    ),
  );
  const result = await loom(root, ['skills', 'export', 'committed']);
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(unnamedLoader);
});

test.skipIf(process.getuid?.() === 0)(
  'an output folder the user cannot write names write access to that folder',
  async () => {
    const root = fixture();
    const output = join(root, 'committed');
    mkdirSync(output);
    chmodSync(output, 0o555);
    try {
      const result = await loom(root, ['skills', 'export', 'committed']);
      expect(result).toMatchObject({
        status: 1,
        stderr: `Cannot create ${join(output, 'notes')}, because permission was denied. Check that your user can write to the folder that holds it and has execute access to each folder above that, then run the command again.\n`,
      });
    } finally {
      chmodSync(output, 0o755);
    }
  },
);

test('an output that is a link to nothing names the link, not a missing path', async () => {
  const root = fixture();
  symlinkSync(join(root, 'missing'), join(root, 'committed'));
  const result = await loom(root, ['skills', 'export', 'committed']);
  expect(result).toMatchObject({
    status: 1,
    stderr: `Cannot create ${join(root, 'committed/notes')}, because it or a folder on the way to it is a link to a path that does not exist, or a folder on the way is missing. Check where each link on the way points and that each folder on the way exists, then run the command again.\n`,
  });
});
