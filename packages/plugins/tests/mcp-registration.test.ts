/*
 * Acceptance plan for registering the MCP server with an agent
 * (docs/plugins/mcp.md#registering-with-an-agent).
 *
 * Every case runs `jsonkit mcp <child>` in process on a mock process whose `programs` script
 * `claude` and `codex`, with the installation record under a temporary `XDG_STATE_HOME`. A script
 * that throws stands for a CLI that cannot start. The cases assert the argv each agent receives,
 * the record's JSON, and the sentences of each lane.
 *
 * - Argv. Install runs `--version`, codex's `mcp get <name> --json`, and `add` with the argv the
 *   contract's table states, the name having each `.` written as `_` and the command line being
 *   `host.program` then `mcp`. Uninstall runs `--version` and `remove`.
 * - Recorded and forced installs. A recorded claude runs `remove` and then `add`, and a failing
 *   `remove` falls through; codex runs `add`. An unrecorded name codex holds refuses with nothing
 *   written to any agent, `--force` replaces it, and any other `get` exit fails with nothing written.
 * - A failed add. The agent's output reaches `out.warn`, the record is written back to what is
 *   known, the child exits 1 with the agent's correction, earlier agents stay registered, and later
 *   ones are not attempted.
 * - Discovery. With no `--agent`, every agent that starts is registered and the others are skipped;
 *   none starting fails; an `--agent` that cannot start fails.
 * - Uninstall. Only recorded agents, a pending file included, are removed; the file goes whatever
 *   `remove` answers; a recorded agent that cannot start keeps its file and fails the child at the
 *   end; nothing recorded says so and exits 0.
 * - Refusals. A damaged record refuses before any program starts, as do Windows and a control
 *   character in the command line.
 * - Notes and config. A development or source build prints its note, a distributed build none.
 *   `config` writes the contract's exact bytes, on win32 too, and starts no program.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { Application } from '@loomcli/core';
import { mcp } from '@loomcli/plugins/mcp';
import { mockProcess } from '@loomcli/testing';
import type { ProgramAnswer, ProgramCall } from '@loomcli/testing';
import { afterEach, describe, expect, it } from 'vite-plus/test';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const program = '/home/me/.local/bin/jsonkit';

/** What an agent's script answers for the joined words of a call: an answer, or a throw. */
type Replies = Readonly<Record<string, ProgramAnswer | 'unstarted'>>;

interface Options {
  readonly name?: string;
  readonly claude?: Replies | 'unstarted';
  readonly codex?: Replies | 'unstarted';
  readonly platform?: string;
  readonly build?: 'development' | 'distributed' | 'source';
  readonly programWords?: readonly string[];
}

/** A temporary state folder, the record's home, removed after the test. */
function stateFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'loom-mcp-registration-'));
  roots.push(root);
  return root;
}

/** One agent's script: it records each call and answers by the call's words, 0 and silence otherwise. */
function script(agent: string, replies: Replies | 'unstarted' | undefined, calls: string[]) {
  return (call: ProgramCall): ProgramAnswer => {
    const words = call.args.join(' ');
    calls.push(`${agent} ${words}`);
    if (replies === 'unstarted') {
      throw new Error(`${agent} cannot start`);
    }
    const reply = replies?.[words];
    if (reply === 'unstarted') {
      throw new Error(`${agent} cannot start`);
    }
    return reply ?? {};
  };
}

/** Runs `jsonkit mcp <argv>` and answers the exit code, both streams, the calls, and the record. */
async function run(argv: readonly string[], options: Options = {}, state = stateFolder()) {
  const calls: string[] = [];
  const name = options.name ?? 'jsonkit';
  const mock = mockProcess({
    argv: ['mcp', ...argv],
    env: { PATH: '/usr/bin', XDG_STATE_HOME: state },
    home: state,
    platform: options.platform ?? 'linux',
    program: options.programWords ?? [program],
    programs: {
      claude: script('claude', options.claude, calls),
      codex: script('codex', options.codex, calls),
    },
    release: { build: options.build ?? 'distributed' },
  });
  const code = await new Application(name, {
    description: 'Read JSON.',
    plugins: [mcp()],
  }).run({ process: mock });
  const record = (agent: string): unknown => {
    const path = join(state, name, 'installation', `mcp.${agent}.json`);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
  };
  return {
    calls,
    code,
    record,
    state,
    stderr: stripVTControlCharacters(mock.stderr.text),
    stdout: mock.stdout.text,
  };
}

/** Writes an agent's plugin's file by hand, as an earlier run or a killed one left it. */
function writeRecord(state: string, agent: string, text: string, name = 'jsonkit'): void {
  mkdirSync(join(state, name, 'installation'), { recursive: true });
  writeFileSync(join(state, name, 'installation', `mcp.${agent}.json`), text);
}

const committed = (command: string[] = [program, 'mcp'], name = 'jsonkit') =>
  `${JSON.stringify({ directories: [], files: [], format: 1, registrations: [{ command, name }], state: 'committed' })}\n`;

const pending = (prior: string[] | null, intended: string[] | null) =>
  `${JSON.stringify({ directories: [], files: [], format: 1, registrations: [{ intended, name: 'jsonkit', prior }], state: 'pending' })}\n`;

const claudeAdd = `mcp add -s user jsonkit -- ${program} mcp`;
const codexAdd = `mcp add jsonkit -- ${program} mcp`;
const codexGet = 'mcp get jsonkit --json';

describe('install argv', () => {
  it('runs the version, the codex name check, and each add with the contract argv', async () => {
    const result = await run(['install'], { codex: { [codexGet]: { code: 1 } } });
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([
      'claude --version',
      'codex --version',
      `codex ${codexGet}`,
      `claude ${claudeAdd}`,
      `codex ${codexAdd}`,
    ]);
    expect(result.stderr).toContain(`Registered jsonkit with claude to run ${program} mcp.`);
    expect(result.stderr).toContain(`Registered jsonkit with codex to run ${program} mcp.`);
    expect(result.stdout).toBe('');
    expect(result.record('claude')).toEqual({
      directories: [],
      files: [],
      format: 1,
      registrations: [{ command: [program, 'mcp'], name: 'jsonkit' }],
      state: 'committed',
    });
  });

  it('writes each dot of the application name as an underscore and keeps every runtime word', async () => {
    const words = ['/usr/bin/node', '/srv/my.app/main.js'];
    const result = await run(['install', '--agent', 'claude'], {
      name: 'my.app',
      programWords: words,
    });
    expect(result.calls).toEqual([
      'claude --version',
      'claude mcp add -s user my_app -- /usr/bin/node /srv/my.app/main.js mcp',
    ]);
    expect(result.stderr).toContain(
      'Registered my_app with claude to run /usr/bin/node /srv/my.app/main.js mcp.',
    );
  });

  it('a recorded claude removes and then adds, and a failing remove falls through to add', async () => {
    const state = stateFolder();
    writeRecord(state, 'claude', committed(['/old/jsonkit', 'mcp']));
    const result = await run(
      ['install', '--agent', 'claude'],
      { claude: { 'mcp remove -s user jsonkit': { code: 1, stderr: 'no such server\n' } } },
      state,
    );
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([
      'claude --version',
      'claude mcp remove -s user jsonkit',
      `claude ${claudeAdd}`,
    ]);
    expect(result.stderr).not.toContain('Replaced');
    expect(result.record('claude')).toMatchObject({
      registrations: [{ command: [program, 'mcp'] }],
    });
  });

  it('a recorded codex runs add alone', async () => {
    const state = stateFolder();
    writeRecord(state, 'codex', committed());
    const result = await run(['install', '--agent', 'codex'], {}, state);
    expect(result.calls).toEqual(['codex --version', `codex ${codexAdd}`]);
  });
});

describe('a name the record does not list', () => {
  const held = { [codexGet]: { code: 0, stdout: '{}' } };

  it('refuses when codex holds it, with nothing written to any agent', async () => {
    const result = await run(['install'], { codex: held });
    expect(result.code).toBe(1);
    expect(
      result.calls.filter((call) => call.includes(' mcp add') || call.includes(' mcp remove')),
    ).toEqual([]);
    expect(result.stderr).toContain(
      'codex already has an MCP server named jsonkit, which jsonkit mcp install did not register.',
    );
    expect(result.stderr).toContain(
      'jsonkit mcp install changed nothing, because a registration it did not make is in the way. Remove it with codex mcp remove jsonkit, or run jsonkit mcp install --force to replace it.',
    );
    expect(result.record('claude')).toBeUndefined();
    expect(result.record('codex')).toBeUndefined();
  });

  it('replaces it under --force and says so before codex registers', async () => {
    const result = await run(['install', '--force'], { codex: held });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain(
      'Replaced the jsonkit server codex had, which jsonkit mcp install did not register.',
    );
    expect(result.stderr.indexOf('Replaced')).toBeLessThan(
      result.stderr.indexOf('Registered jsonkit with codex'),
    );
    expect(result.calls).toContain(`codex ${codexAdd}`);
  });

  it('under --force claude removes first and reports a replacement when its remove exits 0', async () => {
    const result = await run(['install', '--agent', 'claude', '--force']);
    expect(result.calls).toEqual([
      'claude --version',
      'claude mcp remove -s user jsonkit',
      `claude ${claudeAdd}`,
    ]);
    expect(result.stderr).toContain(
      'Replaced the jsonkit server claude had, which jsonkit mcp install did not register.',
    );
  });

  it('under --force claude reports no replacement when its remove fails', async () => {
    const result = await run(['install', '--agent', 'claude', '--force'], {
      claude: { 'mcp remove -s user jsonkit': { code: 1 } },
    });
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain('Replaced');
  });

  it.each([2, 127])('fails with nothing written when codex get exits %i', async (code) => {
    const result = await run(['install'], { codex: { [codexGet]: { code, stderr: 'boom\n' } } });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('boom');
    expect(result.stderr).toContain(
      `jsonkit cannot tell whether codex already has a server named jsonkit, because codex mcp get exited with code ${code}. Fix what codex reported, then run jsonkit mcp install again.`,
    );
    expect(result.calls.filter((call) => call.includes(' mcp add'))).toEqual([]);
    expect(result.record('claude')).toBeUndefined();
  });

  it('fails with nothing written when codex get cannot start', async () => {
    const result = await run(['install'], { codex: { [codexGet]: 'unstarted' } });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('because codex mcp get could not start.');
    expect(result.calls.filter((call) => call.includes(' mcp add'))).toEqual([]);
  });
});

describe('a failed add', () => {
  const claudeFails = {
    [claudeAdd]: { code: 1, stderr: 'already exists\n', stdout: 'see docs\n' },
  };

  it('warns the output, leaves no file, and gives the claude correction', async () => {
    const result = await run(['install'], {
      claude: claudeFails,
      codex: { [codexGet]: { code: 1 } },
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('already exists');
    expect(result.stderr.indexOf('already exists')).toBeLessThan(result.stderr.indexOf('see docs'));
    expect(result.stderr).toContain(
      'jsonkit could not register with claude, because claude mcp add exited with code 1. If claude already has a server named jsonkit, remove it with claude mcp remove jsonkit -s user, or run jsonkit mcp install --force to replace it.',
    );
    expect(result.record('claude')).toBeUndefined();
    expect(result.calls.some((call) => call.startsWith(`codex ${codexAdd}`))).toBe(false);
  });

  it('restores the recorded registration when the agent was not touched', async () => {
    const state = stateFolder();
    writeRecord(state, 'codex', committed(['/old/jsonkit', 'mcp']));
    const result = await run(
      ['install', '--agent', 'codex'],
      { codex: { [codexAdd]: { code: 3 } } },
      state,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'jsonkit could not register with codex, because codex mcp add exited with code 3. Fix what codex reported, then run jsonkit mcp install again.',
    );
    expect(result.record('codex')).toMatchObject({
      registrations: [{ command: ['/old/jsonkit', 'mcp'] }],
      state: 'committed',
    });
  });

  it('keeps no file for claude once its remove exited 0', async () => {
    const state = stateFolder();
    writeRecord(state, 'claude', committed(['/old/jsonkit', 'mcp']));
    const result = await run(['install', '--agent', 'claude'], { claude: claudeFails }, state);
    expect(result.code).toBe(1);
    expect(result.record('claude')).toBeUndefined();
  });

  it('keeps the earlier agent registered and attempts no later one', async () => {
    const result = await run(['install'], {
      claude: {},
      codex: { [codexAdd]: { code: 1 }, [codexGet]: { code: 1 } },
    });
    expect(result.code).toBe(1);
    expect(result.record('claude')).toMatchObject({
      registrations: [{ name: 'jsonkit' }],
      state: 'committed',
    });
    expect(result.record('codex')).toBeUndefined();
  });

  it('reports an add that cannot start', async () => {
    const result = await run(['install', '--agent', 'claude'], {
      claude: { [claudeAdd]: 'unstarted' },
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('because claude mcp add could not start.');
  });
});

describe('discovery', () => {
  it('registers with the agents that start and skips the others', async () => {
    const result = await run(['install'], { codex: 'unstarted' });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Skipped codex, because codex could not start.');
    expect(result.record('codex')).toBeUndefined();
    expect(result.record('claude')).toBeDefined();
  });

  it('fails when none starts', async () => {
    const result = await run(['install'], { claude: 'unstarted', codex: 'unstarted' });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'jsonkit mcp install found no agent to register with, because neither claude nor codex could start. Install one of them, then run jsonkit mcp install again.',
    );
  });

  it('fails when the named agent cannot start', async () => {
    const result = await run(['install', '--agent', 'codex'], { codex: 'unstarted' });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'jsonkit mcp install cannot register with codex, because codex could not start. Install codex, or leave out --agent.',
    );
    expect(result.calls).toEqual(['codex --version']);
  });

  it('rejects an agent outside the set with exit 2', async () => {
    const result = await run(['install', '--agent', 'gemini']);
    expect(result.code).toBe(2);
    expect(result.calls).toEqual([]);
  });
});

describe('uninstall', () => {
  it('removes only the recorded agents, counts a pending file, and deletes each file', async () => {
    const state = stateFolder();
    writeRecord(state, 'claude', pending(null, [program, 'mcp']));
    const result = await run(['uninstall'], {}, state);
    expect(result.code).toBe(0);
    expect(result.calls).toEqual(['claude --version', 'claude mcp remove -s user jsonkit']);
    expect(result.stderr).toContain('Removed jsonkit from claude.');
    expect(result.record('claude')).toBeUndefined();
  });

  it('removes codex with its own argv', async () => {
    const state = stateFolder();
    writeRecord(state, 'codex', committed());
    const result = await run(['uninstall', '--agent', 'codex'], {}, state);
    expect(result.calls).toEqual(['codex --version', 'codex mcp remove jsonkit']);
  });

  it('deletes the file and exits 0 whatever remove answers', async () => {
    const state = stateFolder();
    writeRecord(state, 'claude', committed());
    const result = await run(
      ['uninstall'],
      { claude: { 'mcp remove -s user jsonkit': { code: 1, stderr: 'not found\n' } } },
      state,
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('not found');
    expect(result.stderr).toContain('jsonkit is no longer recorded as registered with claude.');
    expect(result.record('claude')).toBeUndefined();
  });

  it('keeps the file of a recorded agent that cannot start, warns, and fails at the end', async () => {
    const state = stateFolder();
    writeRecord(state, 'claude', committed());
    writeRecord(state, 'codex', committed());
    const result = await run(['uninstall'], { claude: 'unstarted' }, state);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('claude could not start, so jsonkit stays registered with it.');
    expect(result.stderr).toContain(
      "jsonkit mcp uninstall could not remove every registration. Make claude available and run jsonkit mcp uninstall again, or remove jsonkit from claude's MCP configuration yourself.",
    );
    expect(result.record('claude')).toBeDefined();
    expect(result.record('codex')).toBeUndefined();
    expect(result.calls).toContain('codex mcp remove jsonkit');
  });

  it('says there is nothing to remove, with and without --agent, and starts no program', async () => {
    const all = await run(['uninstall']);
    expect(all.code).toBe(0);
    expect(all.stderr).toContain(
      'jsonkit is not registered with any agent by jsonkit mcp install, so there is nothing to remove.',
    );
    const one = await run(['uninstall', '--agent', 'codex']);
    expect(one.code).toBe(0);
    expect(one.stderr).toContain(
      'jsonkit is not registered with codex by jsonkit mcp install, so there is nothing to remove.',
    );
    expect(all.calls).toEqual([]);
    expect(one.calls).toEqual([]);
  });
});

describe('refusals', () => {
  it.each(['install', 'uninstall'])(
    'a damaged record refuses %s before any program starts',
    async (child) => {
      const state = stateFolder();
      writeRecord(state, 'codex', '{not json');
      const result = await run([child], {}, state);
      expect(result.code).toBe(1);
      expect(result.calls).toEqual([]);
      expect(result.stderr).toContain(
        `mcp.codex.json cannot be read, so jsonkit will not change the registration it lists. Remove it, then run jsonkit mcp ${child} again.`,
      );
    },
  );

  it('refuses a file of an unknown format', async () => {
    const state = stateFolder();
    writeRecord(state, 'claude', JSON.stringify({ format: 2 }));
    const result = await run(['install', '--agent', 'claude'], {}, state);
    expect(result.code).toBe(1);
    expect(result.calls).toEqual([]);
  });

  it('refuses a damaged file of an agent that could not start, and reads only the named agent', async () => {
    const state = stateFolder();
    writeRecord(state, 'codex', '[]');
    const result = await run(['install'], { codex: 'unstarted' }, state);
    expect(result.code).toBe(1);
    expect(result.calls).toEqual([]);
    const named = await run(['install', '--agent', 'claude'], {}, state);
    expect(named.code).toBe(0);
  });

  it.each(['install', 'uninstall'])(
    'refuses %s on Windows before any program starts',
    async (child) => {
      const result = await run([child], { platform: 'win32' });
      expect(result.code).toBe(1);
      expect(result.calls).toEqual([]);
      expect(result.stderr).toContain(
        `jsonkit mcp ${child} registers with claude and codex on Linux and macOS. Print a client configuration with jsonkit mcp config and add it to your agent yourself.`,
      );
    },
  );

  it('refuses a command line word that holds a control character', async () => {
    const result = await run(['install'], { programWords: ['/srv/bin\u0007/jsonkit'] });
    expect(result.code).toBe(1);
    expect(result.calls).toEqual([]);
    expect(result.stderr).toContain(
      'jsonkit cannot register its MCP server because its path holds a control character. Install jsonkit where its path has none.',
    );
  });
});

describe('build notes', () => {
  it('prints the development note', async () => {
    const result = await run(['install', '--agent', 'claude'], { build: 'development' });
    expect(result.stderr).toContain(
      'jsonkit is a development build, so the registration runs it from this checkout. Run mcp install from an installed jsonkit to register that one instead.',
    );
    expect(result.stderr).not.toContain('runtime flags');
  });

  it('prints the source note with the runtime-flags sentence', async () => {
    const result = await run(['install', '--agent', 'claude'], { build: 'source' });
    expect(result.stderr).toContain(
      'jsonkit is a source build, so the registration runs it from this checkout. Run mcp install from an installed jsonkit to register that one instead.',
    );
    expect(result.stderr).toContain(
      'The registration keeps no runtime flags, so a loader such as --import tsx is not passed on.',
    );
  });

  it('prints no note for a distributed build', async () => {
    const result = await run(['install', '--agent', 'claude']);
    expect(result.stderr).not.toContain('checkout');
  });
});

describe('config', () => {
  it('writes the exact bytes, starts no program, and reads no record', async () => {
    const state = stateFolder();
    writeRecord(state, 'claude', '{not json');
    const result = await run(['config'], { name: 'my.app' }, state);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      `{\n  "mcpServers": {\n    "my_app": {\n      "command": "${program}",\n      "args": [\n        "mcp"\n      ]\n    }\n  }\n}\n`,
    );
    expect(result.stdout.indexOf('"command"')).toBeLessThan(result.stdout.indexOf('"args"'));
    expect(result.calls).toEqual([]);
  });

  it('runs on win32 and splits the runtime words into command and args', async () => {
    const result = await run(['config'], {
      platform: 'win32',
      programWords: ['/usr/bin/node', '/srv/main.js'],
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      mcpServers: { jsonkit: { args: ['/srv/main.js', 'mcp'], command: '/usr/bin/node' } },
    });
  });
});
