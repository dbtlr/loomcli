/*
 * The -v and -vv lines and the change event of the completion, man page, and skills refreshes,
 * under "At -v and in the log" in each plugin's reference and ADR-0165. Each case runs the refresh
 * application on mockProcess, its installation record under a fresh directory below the temporary
 * directory, which it removes after; the refreshed binary is a script the mock answers.
 *
 * - A child that exits 0 writes the `-v` line and records `Program run.` with the words it ran.
 * - With the graph's name and nothing installed, the refresh starts no child and writes its `-vv`
 *   line; any one of the plugin's record files runs the child, an unreadable one included.
 * - Without a name, or a record directory that does not resolve, the child runs as before.
 * - A child that fails writes no `-v` line, and a context without `out` writes no line.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Program } from '@loomcli/testing';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { runOnMock } from './fixtures/in-process.ts';
import { refreshApplication } from './fixtures/refresh-app.ts';
import type { Handed, Observed } from './fixtures/refresh-app.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const binary = '/loom-test/bin/notes';

/** Each refresh: its words, its lines, and one record file of the plugin's. */
const kinds = [
  {
    kind: 'completion',
    record: 'completion.fish.json',
    refreshed: 'Refreshed completion after the update.',
    skipped: 'Skipped the completion refresh: nothing is installed.',
    words: ['completion', 'update'],
  },
  {
    kind: 'manpage',
    record: 'manpage.json',
    refreshed: 'Refreshed the man pages after the update.',
    skipped: 'Skipped the man page refresh: nothing is installed.',
    words: ['manpage', 'update'],
  },
  {
    kind: 'skills',
    record: 'skills.agents.json',
    refreshed: 'Refreshed the skills after the update.',
    skipped: 'Skipped the skills refresh: nothing is installed.',
    words: ['skills', 'update'],
  },
] as const;

type Kind = (typeof kinds)[number]['kind'];

/** A fresh state home, and the application's installation record directory under it. */
function stateHome(): { state: string; record: string } {
  const state = mkdtempSync(join(tmpdir(), 'loom-refresh-lines-'));
  roots.push(state);
  const record = join(state, 'notes', 'installation');
  mkdirSync(record, { recursive: true });
  return { record, state };
}

/** Runs the refresh with `argv`, the child answering `child`, and answers what it wrote and saw. */
async function refresh(
  kind: Kind,
  argv: readonly string[],
  options: { state?: string; child?: Program; handed?: Handed } = {},
) {
  const events: Observed[] = [];
  const started: string[][] = [];
  const child: Program = options.child ?? (() => ({}));
  const app = refreshApplication(
    kind,
    binary,
    { observe: (event) => events.push(event), resolved: () => {} },
    options.handed ?? { name: true, out: true },
  );
  const result = await runOnMock(app, {
    argv: [...argv, 'refresh'],
    // With no state home, a relative home leaves the record directory unresolved.
    env: options.state === undefined ? { HOME: 'relative' } : { XDG_STATE_HOME: options.state },
    home: options.state === undefined ? 'relative' : '/loom-test/home',
    programs: {
      [binary]: (call) => {
        started.push([...call.args]);
        return child(call);
      },
    },
  });
  return { events, started, status: result.status, stderr: result.stderr };
}

describe.each(kinds)('$kind', ({ kind, record, refreshed, skipped, words }) => {
  it('a child that exits 0 writes the -v line and records Program run.', async () => {
    const { record: directory, state } = stateHome();
    writeFileSync(join(directory, record), '{}\n');
    const quiet = await refresh(kind, [], { state });
    expect(quiet.stderr).toBe('');
    const result = await refresh(kind, ['-v'], { state });
    expect(result.started).toEqual([words]);
    expect(result.stderr).toBe(`› ${refreshed}\n`);
    expect(result.events).toEqual([
      {
        fields: { arguments: words, code: 0, program: binary },
        level: 'info',
        message: 'Program run.',
      },
    ]);
  });

  it('with nothing installed it starts no child and says why at -vv', async () => {
    const { state } = stateHome();
    const verbose = await refresh(kind, ['-v'], { state });
    expect(verbose).toMatchObject({ events: [], started: [], status: 0, stderr: '' });
    const traced = await refresh(kind, ['-vv'], { state });
    expect(traced).toMatchObject({ started: [], stderr: `  ┆ ${skipped}\n` });
  });

  it('without a name, or with a record directory that does not resolve, the child runs', async () => {
    const { state } = stateHome();
    const unnamed = await refresh(kind, ['-v'], { handed: { out: true }, state });
    expect(unnamed).toMatchObject({ started: [words], stderr: `› ${refreshed}\n` });
    const unresolved = await refresh(kind, ['-v']);
    expect(unresolved).toMatchObject({ started: [words], stderr: `› ${refreshed}\n` });
  });

  it('a failing child writes no -v line, and no out writes no line', async () => {
    const { record: directory, state } = stateHome();
    writeFileSync(join(directory, record), 'not json');
    const failed = await refresh(kind, ['-v'], { child: () => ({ code: 1 }), state });
    expect(failed.stderr).toBe('');
    expect(failed.events.map(({ level }) => level)).toEqual(['warn']);
    const silent = await refresh(kind, ['-vv'], {
      handed: { name: true },
      state: stateHome().state,
    });
    expect(silent).toMatchObject({ started: [], stderr: '' });
  });
});
