/*
 * A plugin's sentence escapes every value it repeats (docs/core/failures.md#failure-message-voice,
 * rule 5). The configuration plugin's lines name an option by its declared spelling, which the
 * declared-name rule lets hold a control character, and the MCP server's error text repeats the
 * tool name and the argument key a client sent. A control character or a bidirectional control in
 * one prints as its `\uXXXX` escape, so it cannot reorder or break the line.
 *
 * Every case runs an Application in process on a mock process.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { Application, Command, plugin } from '@loomcli/core';
import type { ProcessHandle } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { mcp } from '@loomcli/plugins/mcp';
import { mcpCommand } from '@loomcli/plugins/mcp/extension';
import { mockProcess } from '@loomcli/testing';
import { expect, test, vi } from 'vite-plus/test';
import { z } from 'zod';

import { request } from '../../mcp/tests/session.js';

/** A verbose mark, spelled -L, so a run can show its `-v` lines. */
const loud = plugin('fixture/loud', {
  options: {
    loud: {
      control: true,
      description: 'Show more detail.',
      short: 'L',
      type: 'count',
      verbose: true,
    },
  },
});

/** Runs an application whose option `fla<U+202E>g` reads `flag` from `.app.json`, in a sandbox. */
async function configRun(argv: readonly string[], strict: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'loom-escaped-'));
  try {
    writeFileSync(join(root, '.app.json'), JSON.stringify({ flag: 'yes' }));
    const mock = mockProcess({ argv: [...argv], ceiling: root, cwd: root, env: { HOME: root } });
    await new Application('app', {
      plugins: [
        loud,
        configuration({ schema: z.object({ flag: z.unknown().optional() }), strict }).plugin,
      ],
    })
      .option('fla\u202eg', { extensions: [configInput({ path: 'flag' })], type: 'boolean' })
      .action(() => undefined)
      .run({ process: mock });
    return { status: mock.exitCode, stderr: mock.stderr.text };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

test("the configuration plugin's lines escape the spelling of the option a file value fills", async () => {
  await expect(configRun(['-L'], false)).resolves.toEqual({
    status: 0,
    stderr: '› Ignored option "--fla\\u202eg" from flag in .app.json: Use true or false.\n',
  });
  await expect(configRun([], true)).resolves.toEqual({
    status: 2,
    stderr: 'app: Option "--fla\\u202eg" (from flag in .app.json): Use true or false.\n',
  });
});

/**
 * The answers an MCP server writes to the given requests, one parsed message per line. Stdin stays
 * open until every request is answered, because closing it aborts a call still in flight.
 */
async function served(requests: readonly unknown[]): Promise<unknown[]> {
  const echo = new Command('echo', { extensions: [mcpCommand({})] })
    .argument('word', { required: true })
    .action(({ args, out }) => out.print(args.word));
  const mock = mockProcess({ argv: ['mcp'] });
  const input = new PassThrough();
  const handle: ProcessHandle = {
    ...mock,
    get exitCode() {
      return mock.exitCode;
    },
    set exitCode(value) {
      mock.exitCode = value;
    },
    stdin: input,
  };
  const running = new Application('app', { plugins: [mcp()] })
    .command(echo)
    .run({ process: handle });
  for (const each of requests) {
    input.write(`${JSON.stringify(each)}\n`);
  }
  const answers = () => mock.stdout.text.split('\n').filter((line) => line !== '');
  await vi.waitFor(() => {
    expect(answers()).toHaveLength(requests.length);
  });
  input.end();
  await running;
  return answers().map((line): unknown => JSON.parse(line));
}

test("the MCP server's error text escapes the tool name and the argument key a client sent", async () => {
  const answers = await served([
    request(1, 'tools/call', { name: 'ec\u202eho' }),
    request(2, 'tools/call', { arguments: { 'ex\u202etra': 1, word: 'hi' }, name: 'echo' }),
  ]);
  expect(answers).toMatchObject([
    {
      error: {
        message: String.raw`Unknown tool "ec\u202eho". Call tools/list for the tool names.`,
      },
      id: 1,
    },
    {
      id: 2,
      result: {
        content: [
          {
            text: String.raw`Tool "echo" takes no argument "ex\u202etra". Use a property its input schema lists.`,
            type: 'text',
          },
        ],
        isError: true,
      },
    },
  ]);
});
