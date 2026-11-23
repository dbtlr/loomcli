import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Application } from '@loomcli/core';
import { skillFolders, skills } from '@loomcli/plugins/skills';
import { afterEach, expect, test } from 'vite-plus/test';

import { assertSkillsMatch } from '../src/index.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** The author's files of the fixture skill: its SKILL.md and one executable script. */
const authored = () => [
  { content: '# Notes', path: 'SKILL.md' },
  { content: '#!/bin/sh\n', executable: true, path: 'scripts/run.sh' },
];

async function committed() {
  const root = mkdtempSync(join(tmpdir(), 'loom-assert-skills-'));
  roots.push(root);
  const application = new Application('notes', {
    description: 'Notes.',
    plugins: [
      skills({
        skills: [
          {
            commands: [[]],
            files: authored,
            name: 'notes',
          },
        ],
      }),
    ],
  });
  for (const folder of (await skillFolders(application.inspect())) ?? []) {
    for (const file of folder.files) {
      const path = join(root, folder.name, file.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.content);
      chmodSync(path, file.executable ? 0o755 : 0o644);
    }
  }
  return { application, root };
}

test('a fresh copy passes and changing the graph names the first changed file', async () => {
  const { application, root } = await committed();
  await expect(assertSkillsMatch(application, root)).resolves.toBeUndefined();
  const changed = new Application('notes', {
    description: 'Changed.',
    plugins: [
      skills({
        skills: [
          {
            commands: [[]],
            files: authored,
            name: 'notes',
          },
        ],
      }),
    ],
  });
  await expect(assertSkillsMatch(changed, root)).rejects.toThrow(
    'notes/references/commands/index.md',
  );
});

test.each(['missing', 'extra', 'extra-reference', 'content', 'mode'])(
  '%s names the differing file',
  async (kind) => {
    const { application, root } = await committed();
    const path = join(root, 'notes/SKILL.md');
    if (kind === 'missing') {
      rmSync(path);
    }
    if (kind === 'extra') {
      writeFileSync(join(root, 'notes/extra.md'), 'Extra');
    }
    if (kind === 'extra-reference') {
      writeFileSync(join(root, 'notes/references/commands/notes-old.md'), 'Stale');
    }
    if (kind === 'content') {
      writeFileSync(path, 'Changed');
    }
    if (kind === 'mode') {
      chmodSync(path, 0o755);
    }
    let expected = 'notes/SKILL.md';
    if (kind === 'extra') {
      expected = 'notes/extra.md';
    }
    if (kind === 'extra-reference') {
      expected = 'notes/references/commands/notes-old.md';
    }
    await expect(assertSkillsMatch(application, root)).rejects.toThrow(expected);
  },
);

test('an application without the plugin fails with the correction', async () => {
  const application = new Application('notes', { description: 'Notes.' }).action(() => {});
  await expect(assertSkillsMatch(application, '.')).rejects.toThrow('Declare skills()');
});

test('dot entries at every depth are ignored', async () => {
  const { application, root } = await committed();
  writeFileSync(join(root, 'notes/.DS_Store'), 'metadata');
  mkdirSync(join(root, 'notes/references/.hidden'));
  writeFileSync(join(root, 'notes/references/.hidden/file'), 'metadata');
  await expect(assertSkillsMatch(application, root)).resolves.toBeUndefined();
});

test('missing skill folders and links differ, and differences are sorted', async () => {
  const { application, root } = await committed();
  const { symlinkSync } = await import('node:fs');
  writeFileSync(join(root, 'identical'), '# Notes');
  rmSync(join(root, 'notes/SKILL.md'));
  symlinkSync(join(root, 'identical'), join(root, 'notes/SKILL.md'));
  writeFileSync(join(root, 'notes/z-extra'), 'extra');
  await expect(assertSkillsMatch(application, root)).rejects.toThrow('notes/SKILL.md');
  rmSync(join(root, 'notes'), { recursive: true });
  await expect(assertSkillsMatch(application, root)).rejects.toThrow('notes/SKILL.md');
});

test('a link to an identical executable file, and a directory in place of a file, differ', async () => {
  const linked = await committed();
  const { symlinkSync } = await import('node:fs');
  writeFileSync(join(linked.root, 'identical.sh'), '#!/bin/sh\n');
  chmodSync(join(linked.root, 'identical.sh'), 0o755);
  rmSync(join(linked.root, 'notes/scripts/run.sh'));
  symlinkSync(join(linked.root, 'identical.sh'), join(linked.root, 'notes/scripts/run.sh'));
  await expect(assertSkillsMatch(linked.application, linked.root)).rejects.toThrow(
    'Committed skill differs at "notes/scripts/run.sh".',
  );
  const replaced = await committed();
  rmSync(join(replaced.root, 'notes/scripts/run.sh'));
  mkdirSync(join(replaced.root, 'notes/scripts/run.sh'));
  await expect(assertSkillsMatch(replaced.application, replaced.root)).rejects.toThrow(
    'Committed skill differs at "notes/scripts/run.sh".',
  );
});

test('a link where the skill folder belongs differs, though it points at a matching copy', async () => {
  const { application, root } = await committed();
  const { renameSync, symlinkSync } = await import('node:fs');
  renameSync(join(root, 'notes'), join(root, 'elsewhere'));
  symlinkSync(join(root, 'elsewhere'), join(root, 'notes'));
  await expect(assertSkillsMatch(application, root)).rejects.toThrow(
    'Committed skill differs at "notes".',
  );
});

test('skill choices select names and reject undeclared names', async () => {
  const { application, root } = await committed();
  await expect(
    assertSkillsMatch(application, root, { skills: ['notes'] }),
  ).resolves.toBeUndefined();
  await expect(assertSkillsMatch(application, root, { skills: [] })).resolves.toBeUndefined();
  await expect(assertSkillsMatch(application, root, { skills: ['missing'] })).rejects.toThrow(
    'Skill "missing" is not declared.',
  );
});

test('no declared skills differs from no plugin', async () => {
  const application = new Application('notes', {
    description: 'Notes.',
    plugins: [skills({ skills: [] })],
  });
  await expect(assertSkillsMatch(application, '.')).rejects.toThrow(
    'The application declares no skills.',
  );
});

test('moduleDirectory resolves a relative source folder', async () => {
  const { root } = await committed();
  const application = new Application('notes', {
    description: 'Notes.',
    plugins: [skills({ folder: '.' })],
  });
  await expect(
    assertSkillsMatch(application, root, { moduleDirectory: root }),
  ).resolves.toBeUndefined();
});

test('subcommand descriptions and removed Commands make references differ', async () => {
  const { Command } = await import('@loomcli/core');
  const make = (description: string | undefined) => {
    const application = new Application('notes', {
      description: 'Notes.',
      plugins: [
        skills({
          skills: [
            {
              commands: [[]],
              files: authored,
              name: 'notes',
            },
          ],
        }),
      ],
    });
    return description === undefined
      ? application
      : application.command(new Command('list', { description }).action(() => {}));
  };
  const { root } = await committed();
  const original = make('List notes.');
  for (const folder of (await skillFolders(original.inspect())) ?? []) {
    for (const file of folder.files) {
      const path = join(root, folder.name, file.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.content);
      chmodSync(path, file.executable ? 0o755 : 0o644);
    }
  }
  await expect(assertSkillsMatch(original, root)).resolves.toBeUndefined();
  await expect(assertSkillsMatch(make('List changed notes.'), root)).rejects.toThrow(
    'notes/references/commands/',
  );
  const removed = make(undefined);
  for (const folder of (await skillFolders(removed.inspect())) ?? []) {
    for (const file of folder.files) {
      const path = join(root, folder.name, file.path);
      writeFileSync(path, file.content);
      chmodSync(path, file.executable ? 0o755 : 0o644);
    }
  }
  await expect(assertSkillsMatch(removed, root)).rejects.toThrow('notes/references/commands/');
});

test('the first of several differences follows sorted path order', async () => {
  const { application, root } = await committed();
  writeFileSync(join(root, 'notes/SKILL.md'), 'Changed');
  writeFileSync(join(root, 'notes/A-first'), 'Extra');
  writeFileSync(join(root, 'notes/Z-last'), 'Extra');
  await expect(assertSkillsMatch(application, root)).rejects.toThrow('notes/A-first');
});
