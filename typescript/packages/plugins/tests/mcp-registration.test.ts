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
  readonly env?: Readonly<Record<string, string>>;
  readonly home?: string;
  readonly build?: 'development' | 'distributed' | 'source';
  readonly programWords?: readonly string[];
  /** What happens inside a call, by `<agent> <words>`, before its script answers. */
  readonly during?: Readonly<Record<string, (mock: MockProcess) => void>>;
}

type MockProcess = ReturnType<typeof mockProcess>;

/** A temporary state folder, the record's home, removed after the test. */
function stateFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'loom-mcp-registration-'));
  roots.push(root);
  return root;
}

/** One agent's script: it records each call and answers by the call's words, 0 and silence otherwise. */
function script(
  agent: string,
  replies: Replies | 'unstarted' | undefined,
  calls: string[],
  during: (call: string) => void,
) {
  return (call: ProgramCall): ProgramAnswer => {
    const words = call.args.join(' ');
    calls.push(`${agent} ${words}`);
    during(`${agent} ${words}`);
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
  const during = (call: string): void => options.during?.[call]?.(mock);
  const mock = mockProcess({
    argv: ['mcp', ...argv],
    env: options.env ?? { PATH: '/usr/bin', XDG_STATE_HOME: state },
    home: options.home ?? state,
    platform: options.platform ?? 'linux',
    program: options.programWords ?? [program],
    programs: {
      claude: script('claude', options.claude, calls, during),
      codex: script('codex', options.codex, calls, during),
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
    // The glyph of the lane that wrote the sentence, '' when no line ends with it.
    lane: (sentence: string): string | undefined =>
      stripVTControlCharacters(mock.stderr.text)
        .split('\n')
        .find((line) => line.endsWith(sentence))
        ?.replace(sentence, ''),
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

/** An agent's plugin's file as it is on disk now, read from inside a call. */
function recordNow(state: string, agent: string): unknown {
  return JSON.parse(
    readFileSync(join(state, 'jsonkit', 'installation', `mcp.${agent}.json`), 'utf8'),
  );
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

/** What a pending file holds while a call runs. */
const pendingFile = (prior: string[] | null, intended: string[] | null) => ({
  directories: [],
  files: [],
  format: 1,
  registrations: [{ intended, name: 'jsonkit', prior }],
  state: 'pending',
});

const oldCommand = ['/old/jsonkit', 'mcp'];
const claudeRemove = 'mcp remove -s user jsonkit';

describe('the file while a call runs', () => {
  it('install writes the file pending with the prior and intended lines during add', async () => {
    const state = stateFolder();
    writeRecord(state, 'codex', committed(oldCommand));
    const seen: unknown[] = [];
    await run(
      ['install', '--agent', 'codex'],
      {
        during: { [`codex ${codexAdd}`]: () => seen.push(recordNow(state, 'codex')) },
      },
      state,
    );
    expect(seen).toEqual([pendingFile(oldCommand, [program, 'mcp'])]);
  });

  it('install of an unrecorded name writes prior null during claude add', async () => {
    const state = stateFolder();
    const seen: unknown[] = [];
    await run(
      ['install', '--agent', 'claude'],
      {
        during: { [`claude ${claudeAdd}`]: () => seen.push(recordNow(state, 'claude')) },
      },
      state,
    );
    expect(seen).toEqual([pendingFile(null, [program, 'mcp'])]);
  });

  it('install keeps the file pending through claude remove', async () => {
    const state = stateFolder();
    writeRecord(state, 'claude', committed(oldCommand));
    const seen: unknown[] = [];
    await run(
      ['install', '--agent', 'claude'],
      {
        during: { [`claude ${claudeRemove}`]: () => seen.push(recordNow(state, 'claude')) },
      },
      state,
    );
    expect(seen).toEqual([pendingFile(oldCommand, [program, 'mcp'])]);
  });

  it('uninstall writes the file pending with intended null during remove', async () => {
    const state = stateFolder();
    writeRecord(state, 'claude', committed(oldCommand));
    const seen: unknown[] = [];
    await run(
      ['uninstall'],
      {
        during: { [`claude ${claudeRemove}`]: () => seen.push(recordNow(state, 'claude')) },
      },
      state,
    );
    expect(seen).toEqual([pendingFile(oldCommand, null)]);
  });

  it('install over a pending file treats it as recorded', async () => {
    const state = stateFolder();
    writeRecord(state, 'claude', pending(oldCommand, null));
    writeRecord(state, 'codex', pending(oldCommand, null));
    const result = await run(['install'], {}, state);
    expect(result.code).toBe(0);
    expect(result.calls).toEqual([
      'claude --version',
      'codex --version',
      `claude ${claudeRemove}`,
      `claude ${claudeAdd}`,
      `codex ${codexAdd}`,
    ]);
  });
});

const both = (state: string) => {
  writeRecord(state, 'claude', committed(oldCommand));
  writeRecord(state, 'codex', committed(oldCommand));
};
const raising = (signal: 'SIGINT' | 'SIGTERM') => (mock: MockProcess) => mock.signals.raise(signal);

describe('the run signal', () => {
  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)('%s during install --version starts no later call', async (signal, code) => {
    const state = stateFolder();
    both(state);
    const result = await run(
      ['install'],
      { during: { 'claude --version': raising(signal) } },
      state,
    );
    expect(result.code).toBe(code);
    expect(result.calls).toEqual(['claude --version']);
    expect(result.record('claude')).toEqual(JSON.parse(committed(oldCommand)));
    expect(result.record('codex')).toEqual(JSON.parse(committed(oldCommand)));
  });

  it('SIGTERM during uninstall --version starts no later call and keeps both files', async () => {
    const state = stateFolder();
    both(state);
    const result = await run(
      ['uninstall'],
      { during: { 'claude --version': raising('SIGTERM') } },
      state,
    );
    expect(result.code).toBe(143);
    expect(result.calls).toEqual(['claude --version']);
    expect(result.record('claude')).toEqual(JSON.parse(committed(oldCommand)));
    expect(result.record('codex')).toEqual(JSON.parse(committed(oldCommand)));
  });

  it('SIGTERM during uninstall remove leaves that file pending and the other untouched', async () => {
    const state = stateFolder();
    both(state);
    const result = await run(
      ['uninstall'],
      { during: { [`claude ${claudeRemove}`]: raising('SIGTERM') } },
      state,
    );
    expect(result.code).toBe(143);
    expect(result.calls).toEqual(['claude --version', `claude ${claudeRemove}`]);
    expect(result.record('claude')).toEqual(pendingFile(oldCommand, null));
    expect(result.record('codex')).toEqual(JSON.parse(committed(oldCommand)));
    expect(result.stderr).not.toContain('Removed');
  });

  it('SIGINT during install add leaves that file pending and attempts no later agent', async () => {
    const state = stateFolder();
    const result = await run(
      ['install'],
      {
        codex: { [codexGet]: { code: 1 } },
        during: { [`claude ${claudeAdd}`]: raising('SIGINT') },
      },
      state,
    );
    expect(result.code).toBe(130);
    expect(result.calls).toEqual([
      'claude --version',
      'codex --version',
      `codex ${codexGet}`,
      `claude ${claudeAdd}`,
    ]);
    expect(result.record('claude')).toEqual(pendingFile(null, [program, 'mcp']));
    expect(result.record('codex')).toBeUndefined();
  });

  it('SIGTERM during install claude remove leaves the file pending and runs no add', async () => {
    const state = stateFolder();
    writeRecord(state, 'claude', committed(oldCommand));
    const result = await run(
      ['install', '--agent', 'claude'],
      {
        during: { [`claude ${claudeRemove}`]: raising('SIGTERM') },
      },
      state,
    );
    expect(result.code).toBe(143);
    expect(result.calls).toEqual(['claude --version', `claude ${claudeRemove}`]);
    expect(result.record('claude')).toEqual(pendingFile(oldCommand, [program, 'mcp']));
  });

  it('SIGTERM during the codex name check writes nothing and starts no add', async () => {
    const result = await run(['install'], {
      during: { [`codex ${codexGet}`]: raising('SIGTERM') },
    });
    expect(result.code).toBe(143);
    expect(result.calls.some((call) => call.includes(' mcp add'))).toBe(false);
    expect(result.record('claude')).toBeUndefined();
    expect(result.record('codex')).toBeUndefined();
  });
});

describe('leftover staging files', () => {
  const leftover = '.mcp.claude.json.0123456789abcdef.loom-staging';

  it.each(['install', 'uninstall'])('%s removes them', async (child) => {
    const state = stateFolder();
    writeRecord(state, 'claude', committed());
    const path = join(state, 'jsonkit', 'installation', leftover);
    writeFileSync(path, 'half');
    await run([child, '--agent', 'claude'], {}, state);
    expect(existsSync(path)).toBe(false);
  });

  it('install removes them where no file was written', async () => {
    const state = stateFolder();
    mkdirSync(join(state, 'jsonkit', 'installation'), { recursive: true });
    const path = join(state, 'jsonkit', 'installation', leftover);
    writeFileSync(path, 'half');
    await run(['install', '--agent', 'claude'], {}, state);
    expect(existsSync(path)).toBe(false);
  });
});

describe('the lane of each sentence', () => {
  const success = '✔ ';
  const info = 'ℹ ';
  const warn = '⚠ ';
  const free = { [codexGet]: { code: 1 } };

  it('writes Registered as success and Skipped and build notes as info, in table order', async () => {
    const result = await run(['install'], { build: 'source', claude: 'unstarted', codex: free });
    expect(result.lane('Skipped claude, because claude could not start.')).toBe(info);
    expect(result.lane(`Registered jsonkit with codex to run ${program} mcp.`)).toBe(success);
    expect(
      result.lane(
        'jsonkit is a source build, so the registration runs it from this checkout. Run mcp install from an installed jsonkit to register that one instead.',
      ),
    ).toBe(info);
    expect(
      result.lane(
        'The registration keeps no runtime flags, so a loader such as --import tsx is not passed on.',
      ),
    ).toBe(info);
  });

  it('skips claude before it registers codex, and registers claude before it skips codex', async () => {
    const before = await run(['install'], { claude: 'unstarted', codex: free });
    expect(before.stderr.indexOf('Skipped claude')).toBeLessThan(
      before.stderr.indexOf('Registered'),
    );
    const after = await run(['install'], { codex: 'unstarted' });
    expect(after.stderr.indexOf('Registered jsonkit with claude')).toBeLessThan(
      after.stderr.indexOf('Skipped codex'),
    );
  });

  it('writes the held-name sentence as a warning and Replaced as info', async () => {
    const held = { [codexGet]: { code: 0 } };
    const refused = await run(['install'], { codex: held });
    expect(
      refused.lane(
        'codex already has an MCP server named jsonkit, which jsonkit mcp install did not register.',
      ),
    ).toBe(warn);
    const forced = await run(['install', '--force'], { codex: held });
    expect(
      forced.lane(
        'Replaced the jsonkit server codex had, which jsonkit mcp install did not register.',
      ),
    ).toBe(info);
  });

  it('writes the agent output as a warning on a failed add', async () => {
    const result = await run(['install', '--agent', 'claude'], {
      claude: { [claudeAdd]: { code: 1, stderr: 'oops\n' } },
    });
    expect(result.lane('oops')).toBe(warn);
  });

  it('writes an agent output ESC byte escaped', async () => {
    const result = await run(['install', '--agent', 'claude'], {
      claude: { [claudeAdd]: { code: 1, stderr: 'a\u001b[31mred\n' } },
    });
    expect(result.stderr).toContain(String.raw`a\u001b[31mred`);
  });

  it('writes Removed as success, and no-longer-recorded as info after the output as a warning', async () => {
    const state = stateFolder();
    writeRecord(state, 'claude', committed());
    writeRecord(state, 'codex', committed());
    const result = await run(
      ['uninstall'],
      { claude: { [claudeRemove]: { code: 1, stderr: 'oops\n' } } },
      state,
    );
    expect(result.lane('oops')).toBe(warn);
    expect(result.lane('jsonkit is no longer recorded as registered with claude.')).toBe(info);
    expect(result.lane('Removed jsonkit from codex.')).toBe(success);
  });

  it('writes nothing-to-remove as success and could-not-start as a warning', async () => {
    const none = await run(['uninstall']);
    expect(
      none.lane(
        'jsonkit is not registered with any agent by jsonkit mcp install, so there is nothing to remove.',
      ),
    ).toBe(success);
    const state = stateFolder();
    writeRecord(state, 'claude', committed());
    const result = await run(['uninstall'], { claude: 'unstarted' }, state);
    expect(result.lane('claude could not start, so jsonkit stays registered with it.')).toBe(warn);
  });
});

describe('the order of the checks', () => {
  const damaged = '{not json';
  const bell = { programWords: ['/srv/bin\u0007/jsonkit'] };
  const relative = { env: { PATH: '/usr/bin', XDG_STATE_HOME: 'relative' }, home: '' };

  it('refuses a record directory that is not absolute before any program starts', async () => {
    const result = await run(['install'], relative);
    expect(result.code).toBe(1);
    expect(result.calls).toEqual([]);
    expect(result.stderr).toContain(
      'jsonkit cannot find its installation record because HOME is not an absolute path.',
    );
  });

  it('checks Windows before a control character', async () => {
    const result = await run(['install'], { ...bell, platform: 'win32' });
    expect(result.stderr).toContain('registers with claude and codex on Linux and macOS');
    expect(result.stderr).not.toContain('control character');
  });

  it('checks a control character before the record directory', async () => {
    const result = await run(['install'], { ...bell, ...relative });
    expect(result.stderr).toContain('holds a control character');
    expect(result.stderr).not.toContain('installation record');
  });

  it('checks a control character before a damaged record', async () => {
    const state = stateFolder();
    writeRecord(state, 'claude', damaged);
    const result = await run(['install'], bell, state);
    expect(result.stderr).toContain('holds a control character');
    expect(result.stderr).not.toContain('cannot be read');
  });
});
