import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, Command } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { skills } from '@loomcli/plugins/skills';
import { expect, test, afterEach } from 'vite-plus/test';

import { runOnMock } from './fixtures/in-process.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});
const app = (description = 'List notes.') =>
  new Application('notes', {
    plugins: [
      format(),
      skills({
        skills: [
          {
            commands: [['list']],
            files: () => [{ content: '# Notes', path: 'SKILL.md' }],
            name: 'notes',
          },
        ],
      }),
    ],
  }).command(new Command('list', { description }).action(() => {}));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'loom-status-'));
  roots.push(root);
  const home = join(root, 'home');
  const state = join(root, 'state');
  const repo = join(root, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(home);
  const run = (argv: string[], application: Application = app()) =>
    runOnMock(application, {
      argv: ['skills', ...argv],
      cwd: repo,
      env: { HOME: home, XDG_STATE_HOME: state },
      home,
      platform: 'linux',
      release: { build: 'source' },
    });
  const folder = join(home, '.claude', 'skills', 'notes');
  const record = join(state, 'notes', 'installation', 'skills.claude.json');
  const report = async (args: string[] = [], application: Application = app()) => {
    const result = await run(
      ['status', '--agent', 'claude', '--format', 'json', ...args],
      application,
    );
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout);
  };
  return { app, folder, home, record, repo, report, root, run, state };
}

test('reports missing declared skills as ordered JSON rows without installing anything', async () => {
  const box = fixture();
  const result = await box.run(['status', '--format', 'json']);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual(
    ['claude', 'agents'].map((target) => ({
      files: [],
      folder: join(box.home, `.${target}`, 'skills', 'notes'),
      notes: [
        `Run notes skills install --agent ${target} to install it, once no skill reads modified or unmanaged.`,
      ],
      scope: 'global',
      skill: 'notes',
      state: 'missing',
      target,
    })),
  );
});

test('status refuses --fields under its own json view and names only the appended jsonl view', async () => {
  const box = fixture();
  const result = await box.run(['status', '--format', 'json', '--fields', 'skill,state']);
  expect(result).toEqual({
    status: 2,
    stderr: `{"error":{"code":"invalid-input","exitCode":2,"message":${JSON.stringify('Option "--fields" applies to the json and jsonl output the formatter provides. Remove --fields, or select output the formatter provides with --format jsonl.')},"hints":[]}}\n`,
    stdout: '',
  });
});

test('records every file, protects changed generated references, and lets force replace them', async () => {
  const box = fixture();
  const observation1 = await box.run(['install']);
  expect(observation1.status).toBe(0);
  const rows = await box.report();
  expect(rows[0].state).toBe('current');
  expect(Object.keys(rows[0])).toEqual([
    'skill',
    'target',
    'scope',
    'state',
    'folder',
    'files',
    'notes',
  ]);
  const record = JSON.parse(readFileSync(box.record, 'utf8'));
  expect(record.format).toBe(2);
  expect(Object.keys(record)).toEqual(['format', 'state', 'directories', 'files', 'folders']);
  expect(record.folders[0].files.map((file: { path: string }) => file.path)).toEqual([
    'SKILL.md',
    'references/commands/index.md',
    'references/commands/notes-list.md',
  ]);
  expect(Object.keys(record.folders[0].files[1])).toEqual(['path', 'digest', 'generated']);
  expect(record.folders[0].files[0].generated).toBeUndefined();
  const reference = join(box.folder, 'references', 'commands', 'notes-list.md');
  writeFileSync(join(box.folder, '.DS_Store'), 'extra');
  const observation2 = await box.report();
  expect(observation2[0].state).toBe('current');
  writeFileSync(join(box.folder, 'SKILL.md'), 'edited');
  const observation3 = await box.report();
  expect(observation3[0].state).toBe('stale');
  const observation4 = await box.run(['update']);
  expect(observation4.status).toBe(0);
  expect(readFileSync(join(box.folder, 'SKILL.md'), 'utf8')).toBe('# Notes');
  writeFileSync(reference, 'keep me');
  const before = readFileSync(box.record, 'utf8');
  const observation5 = await box.report();
  expect(observation5[0]).toMatchObject({
    files: ['references/commands/notes-list.md'],
    state: 'modified',
  });
  expect(readFileSync(box.record, 'utf8')).toBe(before);
  for (const verb of ['install', 'update']) {
    const result = await box.run([verb]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${reference} changed since notes skills install wrote it.`);
    expect(result.stderr).toContain('Copy any file you want to keep out of them');
  }
  writeFileSync(join(box.folder, 'references', 'commands', 'index.md'), 'also changed');
  const observation6 = await box.run(['install', '--force']);
  expect(observation6.status).toBe(0);
  expect(observation6.stderr.split(`Replaced ${box.folder},`)).toHaveLength(2);
  const observation7 = await box.report();
  expect(observation7[0].state).toBe('current');
  writeFileSync(reference, 'keep me');
  const observation8 = await box.run(['uninstall']);
  expect(observation8.status).toBe(0);
  expect(readFileSync(reference, 'utf8')).toBe('keep me');
  const observation9 = await box.report();
  expect(observation9[0].state).toBe('unmanaged');
});

test('reports graph changes at both scopes, missing files as stale, and executable changes', async () => {
  const box = fixture();
  await box.run(['install']);
  await box.run(['install', '--project']);
  const observation10 = await box.report([], box.app('A new description.'));
  expect(observation10[0].state).toBe('stale');
  const observation11 = await box.report(['--project'], box.app('A new description.'));
  expect(observation11[0].state).toBe('stale');
  const observation12 = await box.report(['--project']);
  expect(observation12[0].state).toBe('current');
  chmodSync(join(box.folder, 'SKILL.md'), 0o600);
  const observation13 = await box.report();
  expect(observation13[0].state).toBe('current');
  chmodSync(join(box.folder, 'SKILL.md'), 0o700);
  const observation14 = await box.report();
  expect(observation14[0].files).toEqual(['SKILL.md']);
  rmSync(join(box.folder, 'references', 'commands', 'notes-list.md'));
  const observation15 = await box.report();
  expect(observation15[0].state).toBe('stale');
  const observation16 = await box.run(['update']);
  expect(observation16.status).toBe(0);
});

test('rolls format 1 forward on update and resolves a pending path-only prior without changing status records', async () => {
  const box = fixture();
  await box.run(['install', '--agent', 'claude']);
  const current = JSON.parse(readFileSync(box.record, 'utf8'));
  writeFileSync(
    box.record,
    JSON.stringify({ ...current, folders: [{ path: box.folder }], format: 1 }),
  );
  await box.report();
  expect(JSON.parse(readFileSync(box.record, 'utf8')).format).toBe(1);
  const observation17 = await box.run(['update']);
  expect(observation17.status).toBe(0);
  expect(JSON.parse(readFileSync(box.record, 'utf8')).format).toBe(2);
  const pending = {
    ...current,
    folders: [{ intended: current.folders[0].files, path: box.folder, prior: 'path' }],
    state: 'pending',
  };
  writeFileSync(join(box.folder, '.DS_Store'), 'extra');
  writeFileSync(box.record, JSON.stringify(pending));
  const observation18 = await box.report();
  expect(observation18[0].state).toBe('current');
  expect(JSON.parse(readFileSync(box.record, 'utf8')).state).toBe('pending');
  writeFileSync(join(box.folder, 'SKILL.md'), 'interrupted old version');
  const observation19 = await box.report();
  expect(observation19[0].state).toBe('stale');
  const observation20 = await box.run(['update']);
  expect(observation20.status).toBe(0);
  const observation21 = await box.report();
  expect(observation21[0].state).toBe('current');
});

test('does not follow a skill folder link and project status reports unmanaged and missing', async () => {
  const box = fixture();
  const observation22 = await box.report(['--project']);
  expect(observation22[0].state).toBe('missing');
  await box.run(['install', '--project', '--agent', 'claude']);
  const folder = join(box.repo, '.claude', 'skills', 'notes');
  rmSync(folder, { recursive: true });
  symlinkSync(box.home, folder);
  const observation23 = await box.report(['--project']);
  expect(observation23[0].state).toBe('unmanaged');
  await box.run(['install', '--agent', 'claude']);
  rmSync(box.folder, { recursive: true });
  symlinkSync(box.home, box.folder);
  const observation24 = await box.report();
  expect(observation24[0].state).toBe('stale');
  const observation25 = await box.run(['update']);
  expect(observation25.status).toBe(0);
  const observation26 = await box.report();
  expect(observation26[0].state).toBe('current');
});

test('renders the documented current text blocks and keeps both targets untouched on refusal', async () => {
  const box = fixture();
  await box.run(['install']);
  const observation27 = await box.run(['status']);
  expect(observation27.stdout).toBe(
    `notes for claude: current\n  folder  ${box.folder}\n\nnotes for agents: current\n  folder  ${join(box.home, '.agents', 'skills', 'notes')}\n`,
  );
  const agents = join(
    box.home,
    '.agents',
    'skills',
    'notes',
    'references',
    'commands',
    'notes-list.md',
  );
  writeFileSync(agents, 'changed');
  const before = readFileSync(join(box.folder, 'references', 'commands', 'index.md'), 'utf8');
  const observation28 = await box.run(['update'], box.app('A new description.'));
  expect(observation28.status).toBe(1);
  expect(readFileSync(join(box.folder, 'references', 'commands', 'index.md'), 'utf8')).toBe(before);
  const text = await box.run(['status', '--agent', 'agents']);
  expect(text.stdout).toBe(
    `notes for agents: modified\n  folder   ${join(box.home, '.agents', 'skills', 'notes')}\n  changed  references/commands/notes-list.md\n  note     Its command references changed since notes skills install wrote them, so notes skills update will not replace it. Copy the changed files elsewhere to keep them, then run notes skills install --agent agents --force to replace the folder.\n`,
  );
});

test('leaves modified obsolete skills in place even under force, with no remaining ownership', async () => {
  const box = fixture();
  await box.run(['install', '--agent', 'claude']);
  const reference = join(box.folder, 'references', 'commands', 'notes-list.md');
  writeFileSync(reference, 'keep');
  const replacement = new Application('notes', {
    plugins: [
      format(),
      skills({
        skills: [{ files: () => [{ content: '# Other', path: 'SKILL.md' }], name: 'other' }],
      }),
    ],
  });
  const report = await box.run(['status', '--agent', 'claude'], replacement);
  expect(report.stderr).toContain(
    'a skill this version no longer declares, and command references in it changed',
  );
  const result = await box.run(['install', '--force', '--agent', 'claude'], replacement);
  expect(result.status).toBe(0);
  expect(result.stderr).toContain(
    `${box.folder} was left in place, because command references in it changed since notes skills install wrote them.`,
  );
  expect(readFileSync(reference, 'utf8')).toBe('keep');
  const observation29 = await box.report();
  expect(observation29[0].state).toBe('unmanaged');
});

test('does not follow directory links inside a recorded skill, and a link at a reference is modified', async () => {
  const box = fixture();
  await box.run(['install', '--agent', 'claude']);
  const commands = join(box.folder, 'references', 'commands');
  const reference = join(commands, 'notes-list.md');
  rmSync(reference);
  symlinkSync(join(box.folder, 'SKILL.md'), reference);
  const observation30 = await box.report();
  expect(observation30[0].state).toBe('modified');
  await box.run(['install', '--force', '--agent', 'claude']);
  rmSync(commands, { recursive: true });
  symlinkSync(box.home, commands);
  const observation31 = await box.report();
  expect(observation31[0].state).toBe('stale');
  const observation32 = await box.run(['update']);
  expect(observation32.status).toBe(0);
});

test.each(['missing prior', 'false generated'])(
  'refuses a malformed format-2 record: %s',
  async (fault) => {
    const box = fixture();
    await box.run(['install', '--agent', 'claude']);
    const current = JSON.parse(readFileSync(box.record, 'utf8'));
    if (fault === 'missing prior') {
      current.state = 'pending';
      current.folders = [{ intended: current.folders[0].files, path: box.folder }];
    } else {
      current.folders[0].files[1].generated = false;
    }
    const bytes = JSON.stringify(current);
    writeFileSync(box.record, bytes);
    const result = await box.run(['status', '--agent', 'claude']);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      `${box.record} cannot be read, so notes cannot tell which skills it installed.`,
    );
    expect(readFileSync(box.record, 'utf8')).toBe(bytes);
  },
);

test('sorts stale file paths by Unicode code point rather than UTF-16 surrogate order', async () => {
  const box = fixture();
  const privateFile = `${String.fromCodePoint(57_344)}.md`;
  const emojiFile = `${String.fromCodePoint(128_512)}.md`;
  const application = new Application('notes', {
    plugins: [
      format(),
      skills({
        skills: [
          {
            files: () => [
              { content: '# Notes', path: 'SKILL.md' },
              { content: 'new', path: emojiFile },
              { content: 'new', path: privateFile },
            ],
            name: 'notes',
          },
        ],
      }),
    ],
  });
  await box.run(['install', '--agent', 'claude'], application);
  writeFileSync(join(box.folder, emojiFile), 'old');
  writeFileSync(join(box.folder, privateFile), 'old');
  const rows = await box.report([], application);
  expect(rows[0].files).toEqual([privateFile, emojiFile]);
});

test.each(['List notes.', 'A changed graph.'])(
  'force names modified references with graph %s',
  async (description) => {
    const box = fixture();
    await box.run(['install', '--agent', 'claude']);
    writeFileSync(join(box.folder, 'references/commands/notes-list.md'), 'my edit');
    await expect(
      box.run(['install', '--agent', 'claude', '--force'], box.app(description)),
    ).resolves.toEqual({
      status: 0,
      stderr: `ℹ Replaced ${box.folder}, whose command references changed since notes skills install wrote them.\n✔ Installed notes for claude in ${box.folder}.\n`,
      stdout: '',
    });
  },
);

/** The complete global row promised by the status contract. */
function globalRow(folder: string, state: string, files: string[] = []) {
  const notes: Record<string, string[]> = {
    current: [],
    missing: [
      'Run notes skills install --agent claude to install it, once no skill reads modified or unmanaged.',
    ],
    modified: [
      'Its command references changed since notes skills install wrote them, so notes skills update will not replace it. Copy the changed files elsewhere to keep them, then run notes skills install --agent claude --force to replace the folder.',
    ],
    stale: [
      'Run notes skills update to bring it up to date, once no skill reads modified or unmanaged.',
    ],
    unmanaged: [
      'The installation record does not list what is at this path. Remove it, or run notes skills install --agent claude --force to replace it.',
    ],
  };
  return {
    files,
    folder,
    notes: notes[state],
    scope: 'global',
    skill: 'notes',
    state,
    target: 'claude',
  };
}

/** Leaves an interrupted write, keeping the prior digests independent of the intended ones. */
function leavePending(box: ReturnType<typeof fixture>, prior: unknown, intended: unknown) {
  const record = JSON.parse(readFileSync(box.record, 'utf8'));
  writeFileSync(
    box.record,
    JSON.stringify({
      ...record,
      folders: [{ intended, path: box.folder, prior }],
      state: 'pending',
    }),
  );
}

test('pending prior digests protect an edited reference during status and uninstall', async () => {
  const box = fixture();
  await box.run(['install', '--agent', 'claude']);
  const files = JSON.parse(readFileSync(box.record, 'utf8')).folders[0].files;
  const reference = join(box.folder, 'references/commands/notes-list.md');
  leavePending(box, files, [{ digest: `sha256:${'0'.repeat(64)}`, path: 'SKILL.md' }]);
  writeFileSync(reference, 'my edit');
  await expect(box.report()).resolves.toEqual([
    globalRow(box.folder, 'modified', ['references/commands/notes-list.md']),
  ]);
  // The recovered record still protects the edit: an update refuses and writes nothing.
  const refused = await box.run(['update']);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain('notes-list.md');
  expect(readFileSync(reference, 'utf8')).toBe('my edit');
  await expect(box.run(['uninstall', '--agent', 'claude'])).resolves.toEqual({
    status: 0,
    stderr: `⚠ ${box.folder} was left in place, because command references in it changed since notes skills install wrote them. Copy what you want to keep, then remove the folder.\n`,
    stdout: '',
  });
  expect(readFileSync(reference, 'utf8')).toBe('my edit');
});

test('a graph update interrupted before swap keeps prior digests and remains stale', async () => {
  const box = fixture();
  await box.run(['install', '--agent', 'claude']);
  const prior = JSON.parse(readFileSync(box.record, 'utf8')).folders[0].files;
  // A separate completed install supplies the next graph's intended digests.
  const other = fixture();
  await other.run(['install', '--agent', 'claude'], other.app('Changed.'));
  const intended = JSON.parse(readFileSync(other.record, 'utf8')).folders[0].files;
  leavePending(box, prior, intended);
  await expect(box.report([], box.app('Changed.'))).resolves.toEqual([
    globalRow(box.folder, 'stale', [
      'references/commands/index.md',
      'references/commands/notes-list.md',
    ]),
  ]);
  await expect(box.run(['update'], box.app('Changed.'))).resolves.toEqual({
    status: 0,
    stderr: `✔ Updated notes for claude in ${box.folder}.\n`,
    stdout: '',
  });
});

test('a fresh pending install before rename is completed by update', async () => {
  const box = fixture();
  await box.run(['install', '--agent', 'claude']);
  const files = JSON.parse(readFileSync(box.record, 'utf8')).folders[0].files;
  leavePending(box, null, files);
  rmSync(box.folder, { recursive: true });
  await expect(box.run(['update'])).resolves.toEqual({
    status: 0,
    stderr: `✔ Updated notes for claude in ${box.folder}.\n`,
    stdout: '',
  });
  await expect(box.report()).resolves.toEqual([globalRow(box.folder, 'current')]);
});

test('a completed pending swap records intended files despite extra entries and differing prior', async () => {
  const box = fixture();
  await box.run(['install', '--agent', 'claude']);
  const files = JSON.parse(readFileSync(box.record, 'utf8')).folders[0].files;
  leavePending(
    box,
    [
      {
        digest: `sha256:${'0'.repeat(64)}`,
        generated: true,
        path: 'references/commands/notes-list.md',
      },
    ],
    files,
  );
  writeFileSync(join(box.folder, '.DS_Store'), 'extra');
  await expect(box.report()).resolves.toEqual([globalRow(box.folder, 'current')]);
});

test('a completed pending swap records each intended file, so one this version dropped reads stale', async () => {
  const box = fixture();
  const old = new Application('notes', {
    plugins: [
      format(),
      skills({
        skills: [
          {
            commands: [['list']],
            files: () => [
              { content: '# Notes', path: 'SKILL.md' },
              { content: 'old', path: 'old.md' },
            ],
            name: 'notes',
          },
        ],
      }),
    ],
  }).command(new Command('list', { description: 'List notes.' }).action(() => {}));
  await box.run(['install', '--agent', 'claude'], old);
  const files = JSON.parse(readFileSync(box.record, 'utf8')).folders[0].files;
  leavePending(box, null, files);
  await expect(box.report()).resolves.toEqual([globalRow(box.folder, 'stale', ['old.md'])]);
});

test('a file whose execute bit differs from what this version writes reads stale', async () => {
  const box = fixture();
  await box.run(['install', '--agent', 'claude']);
  chmodSync(join(box.folder, 'SKILL.md'), 0o755);
  await expect(box.report()).resolves.toEqual([globalRow(box.folder, 'stale', ['SKILL.md'])]);
});

test('a failed fresh pending install drops ownership of something at its path', async () => {
  const box = fixture();
  await box.run(['install', '--agent', 'claude']);
  const files = JSON.parse(readFileSync(box.record, 'utf8')).folders[0].files;
  leavePending(box, null, files);
  writeFileSync(join(box.folder, 'SKILL.md'), 'not intended');
  await expect(box.report()).resolves.toEqual([globalRow(box.folder, 'unmanaged')]);
});

test('a pending folder without intended is malformed', async () => {
  const box = fixture();
  await box.run(['install', '--agent', 'claude']);
  const record = JSON.parse(readFileSync(box.record, 'utf8'));
  writeFileSync(
    box.record,
    JSON.stringify({ ...record, folders: [{ path: box.folder, prior: 'path' }], state: 'pending' }),
  );
  await expect(box.run(['status', '--agent', 'claude'])).resolves.toEqual({
    status: 1,
    stderr: `${box.record} cannot be read, so notes cannot tell which skills it installed. Remove it and the folders it lists, then run notes skills install again.\n`,
    stdout: '',
  });
});

test.each(['folder', 'commands'])(
  'does not follow a %s link even to an identical copy',
  async (kind) => {
    const box = fixture();
    await box.run(['install', '--agent', 'claude']);
    const path = kind === 'folder' ? box.folder : join(box.folder, 'references/commands');
    const copy = join(box.root, 'copy');
    cpSync(path, copy, { recursive: true });
    rmSync(path, { recursive: true });
    symlinkSync(copy, path);
    await expect(box.report()).resolves.toEqual([
      globalRow(
        box.folder,
        'stale',
        kind === 'folder'
          ? ['SKILL.md', 'references/commands/index.md', 'references/commands/notes-list.md']
          : ['references/commands/index.md', 'references/commands/notes-list.md'],
      ),
    ]);
  },
);

test('a deleted recorded folder is missing', async () => {
  const box = fixture();
  await box.run(['install', '--agent', 'claude']);
  rmSync(box.folder, { recursive: true });
  await expect(box.report()).resolves.toEqual([globalRow(box.folder, 'missing')]);
});

test('a dropped author file is stale and update removes it', async () => {
  const box = fixture();
  const old = new Application('notes', {
    plugins: [
      format(),
      skills({
        skills: [
          {
            commands: [['list']],
            files: () => [
              { content: '# Notes', path: 'SKILL.md' },
              { content: 'old', path: 'old.md' },
            ],
            name: 'notes',
          },
        ],
      }),
    ],
  }).command(new Command('list', { description: 'List notes.' }).action(() => {}));
  await box.run(['install', '--agent', 'claude'], old);
  await expect(box.report()).resolves.toEqual([globalRow(box.folder, 'stale', ['old.md'])]);
  const updated = await box.run(['update']);
  expect(updated.status).toBe(0);
  expect(existsSync(join(box.folder, 'old.md'))).toBe(false);
});

test('modified files exclude edited author files and use code point order', async () => {
  const box = fixture();
  const application = new Application('notes', {
    plugins: [
      format(),
      skills({
        skills: [
          {
            commands: [['zeta'], ['alpha']],
            files: () => [{ content: '# Notes', path: 'SKILL.md' }],
            name: 'notes',
          },
        ],
      }),
    ],
  })
    .command(new Command('zeta').action(() => {}))
    .command(new Command('alpha').action(() => {}));
  await box.run(['install', '--agent', 'claude'], application);
  for (const path of [
    'SKILL.md',
    'references/commands/notes-zeta.md',
    'references/commands/notes-alpha.md',
  ]) {
    writeFileSync(join(box.folder, path), 'edited');
  }
  await expect(box.report([], application)).resolves.toEqual([
    globalRow(box.folder, 'modified', [
      'references/commands/notes-alpha.md',
      'references/commands/notes-zeta.md',
    ]),
  ]);
});

test('format 1 edited references are stale and replaceable', async () => {
  const box = fixture();
  await box.run(['install', '--agent', 'claude']);
  const record = JSON.parse(readFileSync(box.record, 'utf8'));
  writeFileSync(
    box.record,
    JSON.stringify({ ...record, folders: [{ path: box.folder }], format: 1 }),
  );
  writeFileSync(join(box.folder, 'references/commands/notes-list.md'), 'edited');
  await expect(box.report()).resolves.toEqual([
    globalRow(box.folder, 'stale', ['references/commands/notes-list.md']),
  ]);
  await expect(box.run(['update'])).resolves.toEqual({
    status: 0,
    stderr: `✔ Updated notes for claude in ${box.folder}.\n`,
    stdout: '',
  });
  await expect(box.report()).resolves.toEqual([globalRow(box.folder, 'current')]);
});

test.skipIf(process.getuid?.() === 0)(
  'an interrupted format 1 upgrade keeps path ownership',
  async () => {
    const box = fixture();
    await box.run(['install', '--agent', 'claude']);
    const record = JSON.parse(readFileSync(box.record, 'utf8'));
    writeFileSync(
      box.record,
      JSON.stringify({ ...record, folders: [{ path: box.folder }], format: 1 }),
    );
    writeFileSync(join(box.folder, 'SKILL.md'), 'old');
    chmodSync(join(box.home, '.claude/skills'), 0o555);
    try {
      const interrupted = await box.run(['update']);
      expect(interrupted.status).toBe(1);
    } finally {
      chmodSync(join(box.home, '.claude/skills'), 0o755);
    }
    await expect(box.report()).resolves.toEqual([globalRow(box.folder, 'stale', ['SKILL.md'])]);
    await expect(box.run(['update'])).resolves.toEqual({
      status: 0,
      stderr: `✔ Updated notes for claude in ${box.folder}.\n`,
      stdout: '',
    });
  },
);

test.each([false, true])(
  'project notes name directory only when explicitly supplied: %s',
  async (explicit) => {
    const box = fixture();
    await box.run(['install', '--project', '--agent', 'claude']);
    const folder = join(box.repo, '.claude/skills/notes');
    writeFileSync(join(folder, 'SKILL.md'), 'old');
    const args = ['--project', ...(explicit ? ['--directory', box.repo] : [])];
    const note = `Run notes skills install --project --agent claude${explicit ? ` --directory ${box.repo}` : ''} to replace it with this version's.`;
    await expect(box.report(args)).resolves.toEqual([
      {
        files: ['SKILL.md'],
        folder,
        notes: [note],
        scope: 'project',
        skill: 'notes',
        state: 'stale',
        target: 'claude',
      },
    ]);
    await expect(box.run(['status', '--agent', 'claude', ...args])).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: `notes for claude: stale\n  folder  ${folder}\n  note    ${note}\n`,
    });
  },
);

test('a file at a project skill path is unmanaged', async () => {
  const box = fixture();
  const folder = join(box.repo, '.claude/skills/notes');
  mkdirSync(join(folder, '..'), { recursive: true });
  writeFileSync(folder, 'file');
  await expect(box.report(['--project'])).resolves.toEqual([
    {
      files: [],
      folder,
      notes: [
        'notes skills install --project did not write this, because it is not a folder. Run notes skills install --project --agent claude to replace it.',
      ],
      scope: 'project',
      skill: 'notes',
      state: 'unmanaged',
      target: 'claude',
    },
  ]);
});

test('global stale text and unmanaged notes are complete', async () => {
  const box = fixture();
  await box.run(['install', '--agent', 'claude']);
  writeFileSync(join(box.folder, 'SKILL.md'), 'old');
  await expect(box.run(['status', '--agent', 'claude'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `notes for claude: stale\n  folder  ${box.folder}\n  note    Run notes skills update to bring it up to date, once no skill reads modified or unmanaged.\n`,
  });
  rmSync(box.record);
  await expect(box.report()).resolves.toEqual([globalRow(box.folder, 'unmanaged')]);
});

test('shared global skills are reported once with the status sentence', async () => {
  const box = fixture();
  await box.run(['install', '--agent', 'agents']);
  mkdirSync(join(box.home, '.claude'));
  symlinkSync(join(box.home, '.agents/skills'), join(box.home, '.claude/skills'));
  const result = await box.run(['status', '--format', 'json']);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe(
    `ℹ ${join(box.home, '.agents/skills')} is the same folder as ${join(box.home, '.claude/skills')}, so notes reports on it once, for claude.\n`,
  );
  expect(JSON.parse(result.stdout)).toEqual([globalRow(box.folder, 'unmanaged')]);
});

test.each(['install', 'update'])(
  'modified references refuse %s with complete correction',
  async (verb) => {
    const box = fixture();
    await box.run(['install', '--agent', 'claude']);
    const reference = join(box.folder, 'references/commands/notes-list.md');
    writeFileSync(reference, 'edit');
    await expect(
      box.run([verb, ...(verb === 'install' ? ['--agent', 'claude'] : [])]),
    ).resolves.toEqual({
      status: 1,
      stderr: `⚠ ${reference} changed since notes skills install wrote it.\nnotes skills ${verb} changed nothing, because folders it did not install, or whose command references changed since it installed them, are in the way. Copy any file you want to keep out of them, then remove them or run notes skills install --force to replace them.\n`,
      stdout: '',
    });
  },
);

test.each(['gone', 'current', 'modified'])('obsolete skill notice for %s folder', async (state) => {
  const box = fixture();
  await box.run(['install', '--agent', 'claude']);
  const application = new Application('notes', { plugins: [format(), skills({ skills: [] })] });
  if (state === 'gone') {
    rmSync(box.folder, { recursive: true });
  }
  if (state === 'modified') {
    writeFileSync(join(box.folder, 'references/commands/notes-list.md'), 'edit');
  }
  const notices: Record<string, string> = {
    current: `ℹ notes skills install recorded ${box.folder}, a skill this version no longer declares. Run notes skills update to remove it, once no skill reads modified or unmanaged.\n`,
    gone: '',
    modified: `ℹ notes skills install recorded ${box.folder}, a skill this version no longer declares, and command references in it changed, so notes skills update will leave it in place. Copy what you want to keep, then remove the folder.\n`,
  };
  const result = await box.run(['status', '--agent', 'claude', '--format', 'json'], application);
  expect(result).toEqual({ status: 0, stderr: notices[state], stdout: '[]\n' });
  const expectedUpdate: Record<string, string> = {
    current: `ℹ Removed ${box.folder}.\n`,
    gone: '',
    modified: `⚠ ${box.folder} was left in place, because command references in it changed since notes skills install wrote them. Copy what you want to keep, then remove the folder.\n`,
  };
  await expect(box.run(['update'], application)).resolves.toEqual({
    status: 0,
    stderr: expectedUpdate[state],
    stdout: '',
  });
  expect(existsSync(box.folder)).toBe(state === 'modified');
});

test('status directory requires project', async () => {
  const box = fixture();
  await expect(box.run(['status', '--directory', box.repo])).resolves.toEqual({
    status: 2,
    stderr:
      'notes: Option "--directory" needs --project. Add --project, or leave out --directory.\n',
    stdout: '',
  });
});

test('status project refuses the global folder with its own sentence', async () => {
  const box = fixture();
  const alias = join(box.repo, '.claude');
  mkdirSync(join(box.home, '.claude'), { recursive: true });
  symlinkSync(join(box.home, '.claude'), alias);
  await expect(box.run(['status', '--project', '--agent', 'claude'])).resolves.toEqual({
    status: 1,
    stderr: `notes skills status --project would read ${box.folder}, the folder notes skills install keeps for your home folder. Run it inside a repository, name one with --directory, or leave out --project.\n`,
    stdout: '',
  });
});

test('status command and option descriptions are the public contract', () => {
  const group = app()
    .inspect()
    .root.children.find(({ name }) => name === 'skills');
  const status = group?.children.find(({ name }) => name === 'status');
  expect(status?.description).toBe('Report whether each skill is installed and up to date.');
  // The format plugin adds its own options to a Command with a result; this pins the plugin's own.
  const own = new Set(['agent', 'project', 'directory']);
  expect(
    status?.options
      .filter(({ name }) => own.has(name))
      .map(({ name, description }) => ({ description, name })),
  ).toEqual([
    {
      description: 'The agents to report on: claude or agents. Both when left out.',
      name: 'agent',
    },
    {
      description: "Report on the current repository's skills instead of your home folder's.",
      name: 'project',
    },
    {
      description: 'Find the repository from this directory instead of the current one.',
      name: 'directory',
    },
  ]);
});
