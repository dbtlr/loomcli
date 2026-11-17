/*
 * The -vv lines and the change events of MCP registration, under "At -v and in the log" in
 * docs/plugins/mcp.md and ADR-0165. Each case runs `jsonkit mcp <child>` with the verbose and MCP
 * plugins and an `onLog` observer on mockProcess, whose `claude` and `codex` scripts answer by
 * their words, with the installation record under a fresh state folder below the temporary
 * directory, which it removes after.
 *
 * - The default verbosity gains no line, and -v gains the change events alone. At -vv `install`
 *   and `uninstall` name each selected agent's record file they read, in table order, whether or
 *   not it exists.
 * - Each record file write and its deletion records `File written.` or `File removed.`, and each
 *   `mcp add` or `mcp remove` that exits 0 records `Program run.` with its words. A `claude mcp
 *   remove` before an `add` that exits otherwise records nothing, and a read, the `--version` call
 *   and `codex mcp get`, records nothing.
 * - No event carries a value of the environment.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, plugin } from '@loomcli/core';
import type { LogEvent } from '@loomcli/core';
import { mcp } from '@loomcli/plugins/mcp';
import { verbose } from '@loomcli/plugins/verbose';
import type { ProgramAnswer } from '@loomcli/testing';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { runOnMock } from './fixtures/in-process.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const program = '/home/me/.local/bin/jsonkit';
const identity = '@loomcli/plugins/mcp';

/** A value the environment holds that no event may carry. */
const secret = 'sk-live-0123456789';

const claudeAdd = ['mcp', 'add', '-s', 'user', 'jsonkit', '--', program, 'mcp'];
const claudeRemove = ['mcp', 'remove', '-s', 'user', 'jsonkit'];
const codexAdd = ['mcp', 'add', 'jsonkit', '--', program, 'mcp'];
const codexRemove = ['mcp', 'remove', 'jsonkit'];

/** Codex holds no server of the name, so install needs no `--force`. */
const codexFree: Readonly<Record<string, ProgramAnswer>> = {
  'mcp get jsonkit --json': { code: 1 },
};

/** A fresh state folder, and the record directory under it. */
function stateFolder(): { state: string; record: string } {
  const state = mkdtempSync(join(tmpdir(), 'loom-mcp-lines-'));
  roots.push(state);
  return { record: join(state, 'jsonkit', 'installation'), state };
}

interface Scenario {
  readonly claude?: Readonly<Record<string, ProgramAnswer>>;
  readonly codex?: Readonly<Record<string, ProgramAnswer>>;
}

/** An agent's script, answering by its joined words, and 0 with no output otherwise. */
function answer(replies: Readonly<Record<string, ProgramAnswer>> | undefined) {
  return ({ args }: { readonly args: readonly string[] }): ProgramAnswer =>
    replies?.[args.join(' ')] ?? {};
}

/** Runs `jsonkit ...argv` and answers its status, stderr, and the events it raised. */
async function run(state: string, argv: readonly string[], scenario: Scenario = {}) {
  const events: LogEvent[] = [];
  const observer = plugin('fixture/observer', {
    onLog: (event) => {
      events.push(event);
      return undefined;
    },
  });
  const app = new Application('jsonkit', {
    description: 'Read JSON.',
    plugins: [observer, verbose(), mcp()],
  });
  const result = await runOnMock(app, {
    argv,
    env: { API_TOKEN: secret, PATH: '/usr/bin', XDG_STATE_HOME: state },
    home: state,
    program: [program],
    programs: { claude: answer(scenario.claude), codex: answer(scenario.codex ?? codexFree) },
    release: { build: 'distributed' },
  });
  return {
    // The change events, which are info; the -vv lines are trace events of their own.
    events: events
      .filter(({ level }) => level === 'info')
      .map(({ fields, level, message, plugin: from }) => ({
        fields,
        level,
        message,
        plugin: from,
      })),
    raw: events,
    status: result.status,
    stderr: result.stderr,
  };
}

/** The lines a change event shows at -v, which open with a debug gutter and a change message. */
const changeLine = /^› (?:File written\.|File removed\.|Program run\.) /u;

/** The lines a run wrote that are not change events. */
function withoutChanges(stderr: string): string[] {
  return stderr.split('\n').filter((line) => !changeLine.test(line));
}

/** The trace log lines, their gutter removed. */
function traced(stderr: string): string[] {
  return stderr
    .split('\n')
    .filter((line) => line.startsWith('  ┆ '))
    .map((line) => line.slice('  ┆ '.length));
}

function fileEvent(message: 'File written.' | 'File removed.', path: string) {
  return { fields: { path }, level: 'info', message, plugin: identity };
}

function programRun(name: string, words: readonly string[]) {
  return {
    fields: { arguments: words, code: 0, program: name },
    level: 'info',
    message: 'Program run.',
    plugin: identity,
  };
}

describe('lines', () => {
  it('install names each record file at -vv in table order, and only its changes at -v', async () => {
    const { record, state } = stateFolder();
    const plain = await run(state, ['mcp', 'install']);
    expect(plain.status).toBe(0);
    const other = stateFolder().state;
    const verbosely = await run(other, ['-v', 'mcp', 'install']);
    expect(withoutChanges(verbosely.stderr)).toEqual(plain.stderr.split('\n'));
    const again = await run(state, ['-vv', 'mcp', 'install']);
    expect(traced(again.stderr)).toEqual([
      `Checked ${join(record, 'mcp.claude.json')}.`,
      `Checked ${join(record, 'mcp.codex.json')}.`,
    ]);
    expect(withoutChanges(again.stderr).join('\n')).not.toContain('› ');
  });

  it('a file that is not there is checked too, and --agent checks its agent alone', async () => {
    const { record, state } = stateFolder();
    const fresh = await run(state, ['-vv', 'mcp', 'uninstall']);
    expect(fresh.status).toBe(0);
    expect(traced(fresh.stderr)).toEqual([
      `Checked ${join(record, 'mcp.claude.json')}.`,
      `Checked ${join(record, 'mcp.codex.json')}.`,
    ]);
    const named = await run(state, ['-vv', 'mcp', 'install', '--agent', 'codex']);
    expect(traced(named.stderr)).toEqual([`Checked ${join(record, 'mcp.codex.json')}.`]);
  });
});

describe('events', () => {
  it('install records each record file write and each add', async () => {
    const { record, state } = stateFolder();
    const claude = join(record, 'mcp.claude.json');
    const codex = join(record, 'mcp.codex.json');
    const installed = await run(state, ['mcp', 'install']);
    expect(installed.events).toEqual([
      fileEvent('File written.', claude),
      programRun('claude', claudeAdd),
      fileEvent('File written.', claude),
      fileEvent('File written.', codex),
      programRun('codex', codexAdd),
      fileEvent('File written.', codex),
    ]);
  });

  it("claude's remove before an add records Program run. only when it exits 0", async () => {
    const { record, state } = stateFolder();
    const claude = join(record, 'mcp.claude.json');
    await run(state, ['mcp', 'install', '--agent', 'claude']);
    const replaced = await run(state, ['mcp', 'install', '--agent', 'claude']);
    expect(replaced.events).toEqual([
      fileEvent('File written.', claude),
      programRun('claude', claudeRemove),
      programRun('claude', claudeAdd),
      fileEvent('File written.', claude),
    ]);
    const fellThrough = await run(state, ['mcp', 'install', '--agent', 'claude'], {
      claude: { [claudeRemove.join(' ')]: { code: 1 } },
    });
    expect(fellThrough.events).toEqual([
      fileEvent('File written.', claude),
      programRun('claude', claudeAdd),
      fileEvent('File written.', claude),
    ]);
  });

  it('uninstall records the pending write, each remove that exits 0, and the deletion', async () => {
    const { record, state } = stateFolder();
    const claude = join(record, 'mcp.claude.json');
    const codex = join(record, 'mcp.codex.json');
    await run(state, ['mcp', 'install']);
    const removed = await run(state, ['mcp', 'uninstall'], {
      codex: { [codexRemove.join(' ')]: { code: 1 } },
    });
    expect(removed.status).toBe(0);
    expect(removed.events).toEqual([
      fileEvent('File written.', claude),
      programRun('claude', claudeRemove),
      fileEvent('File removed.', claude),
      fileEvent('File written.', codex),
      fileEvent('File removed.', codex),
    ]);
  });

  it('a leftover staging file beside a record file records File removed.', async () => {
    const { record, state } = stateFolder();
    mkdirSync(record, { recursive: true });
    const staging = join(record, '.mcp.claude.json.0123456789abcdef.loom-staging');
    writeFileSync(staging, 'partial');
    const installed = await run(state, ['mcp', 'install', '--agent', 'claude']);
    expect(installed.events[0]).toEqual(fileEvent('File removed.', staging));
  });

  it('no event carries a value of the environment', async () => {
    const { state } = stateFolder();
    const installed = await run(state, ['mcp', 'install']);
    const removed = await run(state, ['mcp', 'uninstall']);
    const recorded = JSON.stringify([...installed.raw, ...removed.raw]);
    expect(recorded).toContain('Program run.');
    expect(recorded).not.toContain(secret);
  });
});
