import { describe, expect, it } from 'vite-plus/test';

import { childEnvironment, invoke } from '../../../scripts/test-process.js';
import { launch, meta, request } from '../../mcp/tests/session.js';
import type { Message } from '../../mcp/tests/session.js';

const fixture = new URL('fixtures/mcp.mjs', import.meta.url);

/** One fixture application serving MCP over the process's stdio. */
function serve(scenario: string) {
  return launch(fixture, [scenario, 'mcp'], { env: childEnvironment({}) });
}

/** The tools one fixture application lists, in the order it lists them. */
async function toolsOf(scenario: string): Promise<unknown> {
  const session = serve(scenario);
  session.send(request(1, 'tools/list'));
  const answer = await session.next();
  await session.close();
  return Object(answer.result).tools;
}

/** A tool listed by name, from a listing. */
function toolNamed(tools: unknown, name: string): unknown {
  return [tools].flat().find((tool) => Object(tool).name === name);
}

const kitInfo = {
  'io.modelcontextprotocol/serverInfo': {
    description: 'A fixture kit.',
    name: 'kit',
    version: '1.2.3',
  },
};

describe('discovery', () => {
  it('server/discover names the application as the server and offers tools alone', async () => {
    const session = serve('listing');
    session.send(request(1, 'server/discover'));
    const answer: Message = await session.next();
    const ending = await session.close();
    expect(answer).toEqual({
      id: 1,
      jsonrpc: '2.0',
      result: {
        _meta: kitInfo,
        cacheScope: 'private',
        capabilities: { tools: {} },
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
        ttlMs: 0,
      },
    });
    expect(ending).toMatchObject({ status: 0, stderr: '' });
  });

  it('an application with no description leaves it out of the identity', async () => {
    const session = serve('calls');
    session.send(request(1, 'tools/list'));
    const answer = await session.next();
    await session.close();
    expect(answer.result).toHaveProperty(['_meta'], {
      'io.modelcontextprotocol/serverInfo': { name: 'calls', version: '2.0.0' },
    });
  });
});

describe('the listing', () => {
  it('tools/list lists every opted-in Command in graph order, the root first, in one page', async () => {
    const session = serve('listing');
    session.send(request(1, 'tools/list'));
    const answer = await session.next();
    await session.close();
    const result = Object(answer.result);
    expect(result).toMatchObject({ cacheScope: 'private', resultType: 'complete', ttlMs: 0 });
    expect(result).not.toHaveProperty('nextCursor');
    expect(result.tools.map((tool: unknown) => Object(tool).name)).toEqual([
      'kit',
      'kit_read',
      'kit_kinds',
      'kit_cache_clear_all',
      'kit_secret',
      'kit_old',
      'kit_worded',
      'kit_bare',
    ]);
  });

  it('the root tool lists the global options it can take, minus hidden and control options', async () => {
    expect(toolNamed(await toolsOf('listing'), 'kit')).toEqual({
      annotations: { destructiveHint: false, idempotentHint: true },
      description: 'A fixture kit.',
      inputSchema: {
        additionalProperties: false,
        properties: {
          file: { description: 'The document.', type: 'string' },
          verbose: { description: 'Say more.', minimum: 0, type: 'integer' },
        },
        type: 'object',
      },
      name: 'kit',
    });
  });

  it('a tool lists arguments, then local options, then globals, with each published schema', async () => {
    expect(toolNamed(await toolsOf('listing'), 'kit_read')).toEqual({
      annotations: { openWorldHint: false, readOnlyHint: true },
      description: 'Read one value.',
      inputSchema: {
        additionalProperties: false,
        properties: {
          depth: { default: '1', description: 'How deep to read.', minimum: 1, type: 'integer' },
          file: { description: 'The document.', type: 'string' },
          'old-depth': {
            description: 'Deprecated: Use depth instead.\nThe former depth.',
            type: 'string',
          },
          path: { description: 'A dot path from the document root.', type: 'string' },
          quiet: { description: 'Print the value alone.', type: 'boolean' },
          verbose: { description: 'Say more.', minimum: 0, type: 'integer' },
        },
        required: ['path'],
        type: 'object',
      },
      name: 'kit_read',
    });
  });

  it('the properties keep declaration order: arguments, local options, then globals', async () => {
    const read = Object(toolNamed(await toolsOf('listing'), 'kit_read'));
    expect(Object.keys(read.inputSchema.properties)).toEqual([
      'path',
      'depth',
      'quiet',
      'old-depth',
      'file',
      'verbose',
    ]);
  });

  it('an input with no published schema reads one derived from its kind', async () => {
    const kinds = Object(toolNamed(await toolsOf('listing'), 'kit_kinds'));
    expect(kinds.annotations).toBeUndefined();
    expect(kinds.inputSchema).toEqual({
      additionalProperties: false,
      properties: {
        file: { description: 'The document.', type: 'string' },
        first: { description: 'One open word.', type: 'string' },
        flag: { description: 'A flag.', type: 'boolean' },
        label: {
          default: ['a', 'b'],
          description: 'A label.',
          items: { type: 'string' },
          type: 'array',
        },
        level: { description: 'A count.', minimum: 0, type: 'integer' },
        name: { default: 'anon', description: 'An open string.', type: 'string' },
        rest: { description: 'More open words.', items: { type: 'string' }, type: 'array' },
        size: {
          description: 'A size.',
          items: { enum: ['s', 'm'], type: 'string' },
          type: 'array',
        },
        tag: { description: 'A tag.', items: { type: 'string' }, type: 'array' },
        unset: { description: 'No default to publish.', type: 'string' },
        verbose: { description: 'Say more.', minimum: 0, type: 'integer' },
      },
      required: ['first', 'tag'],
      type: 'object',
    });
  });

  it('a tool name joins the application name and the path with underscores, each hyphen written as one', async () => {
    expect(toolNamed(await toolsOf('listing'), 'kit_cache_clear_all')).toMatchObject({
      annotations: { destructiveHint: true },
      description: 'Clear every entry.',
    });
  });

  it('a hidden Command that opts in is a tool, and an alias never is', async () => {
    const tools = await toolsOf('listing');
    expect(toolNamed(tools, 'kit_secret')).toMatchObject({ description: 'A hidden tool.' });
    expect(toolNamed(tools, 'kit_r')).toBeUndefined();
  });

  it("a deprecated tool's description opens with its migration message", async () => {
    expect(toolNamed(await toolsOf('listing'), 'kit_old')).toMatchObject({
      description: 'Deprecated: Use read instead.\nRead one value the old way.',
    });
  });

  it("the extension's description replaces the core one, and a tool with neither carries none", async () => {
    const tools = await toolsOf('listing');
    expect(toolNamed(tools, 'kit_worded')).toMatchObject({
      description: 'An agent description.\nIt keeps its line break.',
    });
    expect(toolNamed(tools, 'kit_bare')).not.toHaveProperty('description');
  });
});

/** One tool call's answer, from a fresh session of the scenario's application. */
async function called(scenario: string, name: string, args?: unknown): Promise<Message> {
  const session = serve(scenario);
  session.send(
    request(1, 'tools/call', { name, ...(args === undefined ? {} : { arguments: args }) }),
  );
  const answer = await session.next();
  const ending = await session.close();
  expect(ending).toMatchObject({ status: 0, stderr: '' });
  return answer;
}

/** The result of one tool call, without the identity every result carries. */
async function resultOf(scenario: string, name: string, args?: unknown): Promise<unknown> {
  const answer = await called(scenario, name, args);
  const { _meta: _identity, resultType, ...result } = Object(answer.result);
  expect(resultType).toBe('complete');
  return result;
}

describe('a completed call', () => {
  it('runs the Command by name with arguments and options split, and answers its output as text', async () => {
    await expect(
      resultOf('calls', 'calls_echo', { file: 'doc.json', loud: true, times: 3, word: 'hi' }),
    ).resolves.toEqual({
      content: [
        {
          text: '{"args":{"word":"hi"},"file":"doc.json","loud":true,"times":"3"}\n',
          type: 'text',
        },
      ],
      isError: false,
    });
  });

  it('answers the first application/json view as text and as structured content', async () => {
    await expect(resultOf('calls', 'calls_members')).resolves.toEqual({
      content: [{ text: '[\n  "a",\n  "b"\n]\n', type: 'text' }],
      isError: false,
      structuredContent: ['a', 'b'],
    });
  });

  it('a jsonl view stays text', async () => {
    await expect(resultOf('calls', 'calls_lines')).resolves.toEqual({
      content: [{ text: '1\n2\n', type: 'text' }],
      isError: false,
    });
  });

  it('a view whose application/json text does not parse answers the text alone', async () => {
    await expect(resultOf('calls', 'calls_lies')).resolves.toEqual({
      content: [{ text: 'not json\n', type: 'text' }],
      isError: false,
    });
  });

  it('answers the output, then the messages, as two text items', async () => {
    await expect(resultOf('calls', 'calls_warned')).resolves.toEqual({
      content: [
        { text: 'the value\n', type: 'text' },
        { text: '⚠ a warning\n', type: 'text' },
      ],
      isError: false,
    });
  });

  it('a run that writes nothing answers one empty text item', async () => {
    await expect(resultOf('calls', 'calls_quiet')).resolves.toEqual({
      content: [{ text: '', type: 'text' }],
      isError: false,
    });
  });
});

describe('a failed call', () => {
  it("answers the failure's report as text and its form as structured content", async () => {
    await expect(resultOf('calls', 'calls_missing')).resolves.toEqual({
      content: [{ text: 'Nothing is at "x". Read another path.\n', type: 'text' }],
      isError: true,
      structuredContent: {
        exitCode: 65,
        failure: {
          code: 'missing',
          exitCode: 65,
          hints: [],
          message: 'Nothing is at "x". Read another path.',
        },
      },
    });
  });

  it('answers the messages, then any partial output', async () => {
    expect(Object(await resultOf('calls', 'calls_partial')).content).toEqual([
      { text: 'The rest is missing.\n', type: 'text' },
      { text: 'half\n', type: 'text' },
    ]);
  });

  it('a defect reads the generic defect message from a distributed build', async () => {
    await expect(resultOf('calls', 'calls_crash')).resolves.toEqual({
      content: [{ text: 'calls: Something went wrong.\n', type: 'text' }],
      isError: true,
      structuredContent: {
        exitCode: 1,
        failure: { code: 'internal', exitCode: 1, hints: [], message: 'Something went wrong.' },
      },
    });
  });

  it('a failure whose view renders nothing answers one empty text item', async () => {
    await expect(resultOf('calls', 'calls_silent')).resolves.toEqual({
      content: [{ text: '', type: 'text' }],
      isError: true,
      structuredContent: {
        exitCode: 1,
        failure: { code: 'silent', exitCode: 1, hints: [], message: 'Nothing to say.' },
      },
    });
  });

  it('a missing required argument reports by name, with an invalid-input form', async () => {
    await expect(resultOf('calls', 'calls_echo', {})).resolves.toEqual({
      content: [
        {
          text: 'calls: Argument "word" requires a value. Supply a value for "word".\n',
          type: 'text',
        },
      ],
      isError: true,
      structuredContent: {
        exitCode: 2,
        failure: {
          code: 'invalid-input',
          exitCode: 2,
          hints: [],
          message: 'Argument "word" requires a value. Supply a value for "word".',
        },
      },
    });
  });

  it('a value of the wrong shape reaches invoke, which reports it by name', async () => {
    await expect(
      resultOf('calls', 'calls_echo', { word: { nested: true } }),
    ).resolves.toMatchObject({
      content: [{ text: 'calls: Argument "word": Use a string or a number.\n', type: 'text' }],
      isError: true,
      structuredContent: { exitCode: 2, failure: { code: 'invalid-input' } },
    });
  });

  it('a key outside the input schema is a tool execution error, and no run starts', async () => {
    await expect(resultOf('calls', 'calls_echo', { extra: 1, word: 'hi' })).resolves.toEqual({
      content: [
        {
          text: 'Tool "calls_echo" takes no argument "extra". Use a property its input schema lists.',
          type: 'text',
        },
      ],
      isError: true,
    });
  });

  it("a hidden or control option's name is outside the input schema", async () => {
    for (const key of ['internal', 'style', 'trace', 'mode']) {
      await expect(resultOf('listing', 'kit_read', { [key]: true, path: 'a' })).resolves.toEqual({
        content: [
          {
            text: `Tool "kit_read" takes no argument "${key}". Use a property its input schema lists.`,
            type: 'text',
          },
        ],
        isError: true,
      });
    }
  });
});

describe('protocol errors', () => {
  it('an unknown tool is invalid params', async () => {
    const answer = await called('calls', 'calls_ehco');
    expect(answer.error).toEqual({
      code: -32_602,
      message: 'Unknown tool "calls_ehco". Call tools/list for the tool names.',
    });
  });

  it.each([[['hi']], ['hi'], [null]])('arguments of %j are invalid params', async (args) => {
    const answer = await called('calls', 'calls_echo', args);
    expect(answer.error).toEqual({
      code: -32_602,
      message:
        'Tool "calls_echo" arguments must be an object. Supply a JSON object of named inputs.',
    });
  });

  it('a cursor is invalid params', async () => {
    const session = serve('calls');
    session.send(request(1, 'tools/list', { cursor: 'next' }));
    const answer = await session.next();
    await session.close();
    expect(answer.error).toEqual({
      code: -32_602,
      message: 'The cursor is not one this server issued. Call tools/list without a cursor.',
    });
  });
});

describe('cancellation and concurrency', () => {
  it('notifications/cancelled aborts a call, which answers nothing, while a second call answers', async () => {
    const session = serve('calls');
    session.send(request(1, 'tools/call', { arguments: { label: 'one' }, name: 'calls_wait' }));
    await session.observed('started one');
    session.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { _meta: meta, requestId: 1 },
    });
    await session.observed('aborted one');
    session.send(request(2, 'tools/call', { arguments: { word: 'two' }, name: 'calls_echo' }));
    await expect(session.next()).resolves.toMatchObject({ id: 2 });
    const ending = await session.close();
    expect(ending.messages.map((message) => message.id)).toEqual([2]);
    expect(ending).toMatchObject({ status: 0, stderr: 'started one\naborted one\n' });
  });

  it('two overlapping calls answer by their own ids', async () => {
    const session = serve('calls');
    session.send(request('a', 'tools/call', { arguments: { word: 'one' }, name: 'calls_echo' }));
    session.send(request('b', 'tools/call', { arguments: { word: 'two' }, name: 'calls_echo' }));
    const answers = [await session.next(), await session.next()];
    await session.close();
    const byId = new Map(answers.map((answer) => [answer.id, Object(answer.result).content]));
    expect(byId.get('a')).toEqual([
      { text: '{"args":{"word":"one"},"loud":false}\n', type: 'text' },
    ]);
    expect(byId.get('b')).toEqual([
      { text: '{"args":{"word":"two"},"loud":false}\n', type: 'text' },
    ]);
  });

  it('closing stdin aborts every call in flight, answers none of them, and exits 0', async () => {
    const session = serve('calls');
    session.send(request(1, 'tools/call', { arguments: { label: 'one' }, name: 'calls_wait' }));
    await session.observed('started one');
    const ending = await session.close();
    expect(ending).toEqual({
      lines: [],
      messages: [],
      status: 0,
      stderr: 'started one\naborted one\n',
    });
  });

  it("a run cancelled through its caller's signal aborts every call in flight and resolves 130", async () => {
    const session = launch(fixture, ['calls', 'mcp'], {
      env: childEnvironment({ FIXTURE_CALLER_SIGNAL: '1' }),
    });
    session.send(request(1, 'tools/call', { arguments: { label: 'one' }, name: 'calls_wait' }));
    session.send(request(2, 'tools/call', { arguments: { label: 'two' }, name: 'calls_wait' }));
    await session.observed('started one');
    await session.observed('started two');
    session.kill('SIGUSR2');
    const ending = await session.finish();
    expect(ending.messages).toEqual([]);
    expect(ending.status).toBe(130);
    expect(ending.stderr.split('\n').toSorted()).toEqual([
      '',
      'aborted one',
      'aborted two',
      'started one',
      'started two',
    ]);
  });

  it('a client that stops reading leaves the server to exit 0 with nothing on stderr', async () => {
    const session = serve('calls');
    session.send(request(1, 'tools/list'));
    const ending = await session.hangUp();
    expect(ending).toMatchObject({ status: 0, stderr: '' });
  });
});

/** Each rule's headline as its banner prints it, and its explanation as an 80-column diagnostic wraps it. */
const rules = {
  'property-name-taken': {
    explanation: [
      'An MCP tool takes its arguments and options as one object keyed by declared',
      'name, so an argument and an option that share a name leave the client no way to',
      'supply each one.',
    ],
    headline: 'MCP PROPERTY NAME TAKEN',
  },
  'tool-name-taken': {
    explanation: [
      'An MCP client calls a tool by its name, which joins the Command path with',
      'underscores and writes each hyphen as one, so two Commands whose paths give one',
      'name leave the client no way to call either one.',
    ],
    headline: 'MCP TOOL NAME TAKEN',
  },
  'tool-without-action': {
    explanation: [
      "An MCP tool call runs the Command's action, so a Command with no action, such as",
      'a group, has nothing to run when a client calls it.',
    ],
    headline: 'MCP TOOL WITHOUT AN ACTION',
  },
};

type Rule = keyof typeof rules;

/** One build fault's Developer Diagnostic: its banner, sentence, explanation, and correction. */
function diagnostic(rule: Rule, sentence: string, correction: string): string {
  const left = `-- ${rules[rule].headline} `;
  const right = ` @loomcli/plugins/mcp/${rule}`;
  const banner = `${left}${'-'.repeat(80 - left.length - right.length)}${right}`;
  return `${[banner, sentence, rules[rule].explanation.join('\n'), correction].join('\n\n')}\n`;
}

describe('build faults', () => {
  it.each<[string, Rule, string, string]>([
    [
      'tool-name-taken',
      'tool-name-taken',
      'Commands "scratch create" and "scratch_create" both serve the MCP tool "app_scratch_create".',
      'Rename one Command, or remove mcpCommand from one of them.',
    ],
    [
      'tool-without-action',
      'tool-without-action',
      'Command "cache" carries mcpCommand and registers no action.',
      'Remove mcpCommand, or opt in the Commands under it.',
    ],
    [
      'tool-without-action-root',
      'tool-without-action',
      'The root Command carries mcpCommand and registers no action.',
      'Remove mcpCommand, or opt in the Commands under it.',
    ],
    [
      'property-name-taken',
      'property-name-taken',
      'Command "get" declares argument "path" and option "path", which one MCP tool lists under one name.',
      'Rename one of them, or remove mcpCommand.',
    ],
    [
      'property-name-taken-global',
      'property-name-taken',
      'Command "get" declares argument "path" and global option "path", which one MCP tool lists under one name.',
      'Rename one of them, or remove mcpCommand.',
    ],
  ])('%s fails every build under its rule', (scenario, rule, sentence, correction) => {
    expect(invoke(fixture, [scenario, 'inspect'])).toEqual({
      status: 0,
      stderr: '',
      stdout: `thrown:1:@loomcli/plugins/mcp/${rule}: ${sentence} ${correction}\n`,
    });
    // A run that never serves a tool fails as the run that serves them does.
    for (const argv of [['plain'], ['mcp']]) {
      expect(
        invoke(fixture, [scenario, ...argv], { env: { FIXTURE_BUILD: 'development' } }),
      ).toEqual({ status: 1, stderr: diagnostic(rule, sentence, correction), stdout: '' });
      expect(invoke(fixture, [scenario, ...argv])).toEqual({
        status: 1,
        stderr: 'app: Something went wrong.\n',
        stdout: '',
      });
    }
  });

  it('an application whose root declares arguments cannot install the plugin', () => {
    expect(invoke(fixture, ['root-arguments'])).toEqual({
      status: 0,
      stderr: '',
      stdout:
        'thrown:1:@loomcli/core/arguments-beside-children: The root Command declares argument "files" and attaches child "mcp". Move the argument into a child Command or remove the children.\n',
    });
  });
});
