import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vite-plus/test';

import {
  homeEnvironment,
  openSession,
  runInHome,
  shellSuite,
  shells,
} from '../../../scripts/test-shell.js';
import type { Shell } from '../../../scripts/test-shell.js';
import { counts, main } from './documents.js';

/** The visible root children `jsonkit <Tab>` lists. */
const commands = ['completion', 'doctor', 'get', 'keys', 'manpage', 'mcp', 'select', 'stats'];

/** The comment every startup line `completion install` adds ends with. */
const marker = '# added by jsonkit completion install';

/** The lines of a `.zshrc` that starts the completion system the way Zsh's manual shows. */
const compinit = ['autoload -Uz compinit', 'compinit'];

/** A case's temporary home, which its shells start from, and its working directory. */
interface Sandbox {
  home: string;
  cwd: string;
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'loom-install-'));
  roots.push(root);
  const box = { cwd: join(root, 'work'), home: join(root, 'home') };
  mkdirSync(box.cwd);
  mkdirSync(box.home);
  return box;
}

/** Runs `jsonkit completion install <shell>` in the home, and fails the case when it fails. */
function install(box: Sandbox, shell: Shell, umask?: string): void {
  const args = ['completion', 'install', shell];
  const result = runInHome({ ...box, args, main, ...(umask === undefined ? {} : { umask }) });
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
}

/** What a shell started from the home did: the words `jsonkit <Tab>` listed, and its start's output. */
interface Started {
  listed: string[];
  startup: string;
}

/** Starts the shell from the home, as an operator opens a terminal, and presses Tab after `jsonkit `. */
async function tabFromHome(box: Sandbox, shell: Shell): Promise<Started> {
  const session = await openSession({ ...box, main, name: 'jsonkit', shell });
  try {
    const { listed } = await session.complete('jsonkit ');
    return { listed, startup: session.startup };
  } finally {
    await session.close();
  }
}

/** The lines of a `.zshrc` before and after the startup line, and the umask `install` runs under. */
interface Layout {
  before: readonly string[];
  after: readonly string[];
  umask?: string;
}

/** Writes the `.zshrc` lines before the startup line, installs, and appends the lines after it. */
function zshrcAround(box: Sandbox, { after, before, umask }: Layout): void {
  const zshrc = join(box.home, '.zshrc');
  if (before.length > 0) {
    writeFileSync(zshrc, `${before.join('\n')}\n`);
  }
  install(box, 'zsh', umask);
  appendFileSync(zshrc, after.map((line) => `${line}\n`).join(''));
  const lines = readFileSync(zshrc, 'utf8').split('\n');
  expect(lines.slice(0, before.length)).toEqual(before);
  expect(lines[before.length]).toMatch(new RegExp(`${marker}$`, 'u'));
  expect(lines.slice(before.length + 1)).toEqual([...after, '']);
}

describe.each(shells.map((shell) => shellSuite(shell)))('$title', ({ installed, shell }) => {
  describe.skipIf(!installed)('after jsonkit completion install alone', () => {
    it(`a ${shell} started from the home completes jsonkit <Tab> through its own startup files`, async () => {
      const box = sandbox();
      install(box, shell);
      const { listed } = await tabFromHome(box, shell);
      expect(counts(listed)).toEqual(counts(commands));
    });
  });

  describe.runIf(installed && shell === 'zsh')('a .zshrc around the startup line', () => {
    const layouts: (Layout & { title: string })[] = [
      { after: [], before: [], title: 'that never runs compinit' },
      { after: [], before: compinit, title: 'that runs compinit before the line' },
      {
        after: compinit,
        before: compinit,
        title: 'that runs compinit before the line and again after it',
      },
    ];

    it.each(layouts)('$title completes jsonkit <Tab> and asks nothing', async (layout) => {
      const box = sandbox();
      zshrcAround(box, layout);
      const { listed, startup } = await tabFromHome(box, 'zsh');
      expect(startup).not.toContain('?');
      expect(counts(listed)).toEqual(counts(commands));
    });

    it('whose only compinit runs after the line completes jsonkit <Tab> on a second start, asking nothing', async () => {
      const box = sandbox();
      zshrcAround(box, { after: compinit, before: [] });
      const first = await tabFromHome(box, 'zsh');
      expect(first.startup).not.toContain('?');
      expect(counts(first.listed)).toEqual(counts(commands));
      expect(existsSync(join(box.home, '.zcompdump'))).toBe(true);
      const second = await tabFromHome(box, 'zsh');
      expect(second.startup).not.toContain('?');
      expect(counts(second.listed)).toEqual(counts(commands));
    }, 60_000);

    it('with an insecure folder on fpath completes jsonkit <Tab> and asks nothing', async () => {
      const box = sandbox();
      const insecure = join(box.home, 'site-functions');
      mkdirSync(insecure);
      // World-writable, because compaudit excuses a group-writable folder whose group is the user's own, as on Ubuntu.
      chmodSync(insecure, 0o777);
      // Zsh's own audit names the folder, so the case proves the line with one it judges insecure.
      const audit = spawnSync(
        'zsh',
        ['-f', '-c', 'fpath=("$1" $fpath); autoload -Uz compaudit; compaudit', 'zsh', insecure],
        { encoding: 'utf8', env: homeEnvironment(box.home) },
      );
      expect(audit.stdout).toContain(insecure);
      zshrcAround(box, { after: [], before: [`fpath=('${insecure}' $fpath)`] });
      const { listed, startup } = await tabFromHome(box, 'zsh');
      expect(startup).not.toContain('?');
      expect(counts(listed)).toEqual(counts(commands));
    });

    it('installed under umask 002, with a plain compinit after the line, completes jsonkit <Tab> and asks nothing', async () => {
      const box = sandbox();
      zshrcAround(box, { after: compinit, before: [], umask: '002' });
      const { listed, startup } = await tabFromHome(box, 'zsh');
      expect(startup).not.toContain('?');
      expect(counts(listed)).toEqual(counts(commands));
    });
  });
});
