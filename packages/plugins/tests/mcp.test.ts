/*
 * Acceptance plan for the MCP plugin (docs/plugins/mcp.md).
 *
 * The plugin is proven when fixture applications install `mcp()` and opt Commands in, some with
 * `annotations: { openWorld: false, readOnly: true }`, and public APIs alone produce these results
 * under Node and Bun:
 *
 * - A real session. A process test launches a fixture application's `mcp` Command and drives a
 *   session over stdio: `server/discover` names the application, its version, and its description;
 *   `tools/list` lists the opted-in Commands in graph order, the root first, with each Command's
 *   schema, and no property for a hidden or control-marked option (the first-party control marks
 *   are proven in control-marks.test.ts); and a call of each tool answers as below. Closing stdin
 *   ends the process with exit 0.
 * - Results. A call answers the output as text with no `structuredContent`; an
 *   `application/json` view answers its text and as `structuredContent`; a Command that warns
 *   answers the output and then the warning as a second text item; and a failure answers
 *   `isError: true` with the failure's report as text and `structuredContent` `{ exitCode: 65,
 *   failure: { code: 'missing', exitCode: 65, message: 'Nothing is at "x". Read another path.',
 *   hints: [] } }`.
 * - Errors. An unknown tool and non-object arguments answer `-32602`. A key outside the schema
 *   answers the plugin's tool execution error. A value of the wrong shape and a missing required
 *   argument answer `isError: true` with the by-name sentence, no help hint, and a form whose code
 *   is `invalid-input`. A fixture tool whose action throws a `TypeError` answers the form
 *   `internal` with `Something went wrong.` from a bundle.
 * - Cancellation and concurrency. A fixture tool that waits on its signal is cancelled by
 *   `notifications/cancelled` and answers nothing while a second call answers. Two overlapping
 *   calls answer by their own ids. A run cancelled through a caller signal aborts both calls in
 *   flight.
 * - Progress. A fixture tool with a progress line of total 3 that updates to 1, 2, and 3 and ends,
 *   called with a progress token, sends five `notifications/progress` with `progress` 1, 2, 3, 4,
 *   and 5, none with a `total`, and the messages `Fetching records 0/3 (started)`, `Fetching
 *   records 1/3 (updated)`, `Fetching records 2/3 (updated)`, `Fetching records 3/3 (updated)`, and
 *   `Fetching records 3/3 (ended)`, before its result, whose text holds the start and end lines. A
 *   spinner line that starts, changes its label once, and ends sends `progress` 1, 2, and 3. A
 *   spinner line `Fetching records` that ends with the message `Fetched 3 records.` sends `Fetching
 *   records (started)` and `Fetched 3 records. (ended)`. Two lines that each start and end in one
 *   call share the token and one counter, so their four notifications read `progress` 1 to 4 in the
 *   order their events were delivered, and none is left out. The same call without a token sends no
 *   notification, and a call the client cancels sends none after its cancellation. A hand-drawn
 *   region that reports `{ completed: 1 }` with no label sends the message `1 (started)`, and one
 *   that reports `{}` sends `(started)`.
 * - Fixtures. Fixture applications prove a hidden Command that opts in listed, a deprecated one
 *   listed with its message opening the description, an alias never listed, a description and a
 *   property description override, annotations projected and omitted, the three build faults with
 *   their diagnostics in both builds, a property derived for each kind of input with a `null`
 *   schema, an array property for a multiple option, a mapped `json` view under another key chosen
 *   for `structuredContent`, a view under `application/json` whose text does not parse answering
 *   text alone, and the install refused on a root that declares arguments.
 * - Packed consumers. `check:packed` installs the packed pack, imports `@loomcli/plugins/mcp` and
 *   `@loomcli/plugins/mcp/extension`, compiles against their declarations, finds no `@loom/mcp`
 *   among the tarball's dependencies or in any of its built files, and serves an MCP session from a
 *   fixture application under Node and Bun.
 */

import { describe, expect, it } from 'vite-plus/test';

import { childEnvironment } from '../../../scripts/test-process.js';
import { ruleParts } from '../../../scripts/test-rules.js';
import { handshakeRequest, initialize, launch, meta, request } from '../../mcp/tests/session.js';
import type { Message } from '../../mcp/tests/session.js';
import { inspectScenario, run } from './fixtures/mcp-app.js';

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
        supportedVersions: ['2026-07-28', '2025-11-25', '2025-06-18'],
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
      'read',
      'kinds',
      'cache_clear_all',
      'secret',
      'old',
      'worded',
      'bare',
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
    expect(toolNamed(await toolsOf('listing'), 'read')).toEqual({
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
      name: 'read',
    });
  });

  it('the properties keep declaration order: arguments, local options, then globals', async () => {
    const read = Object(toolNamed(await toolsOf('listing'), 'read'));
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
    const kinds = Object(toolNamed(await toolsOf('listing'), 'kinds'));
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

  it('a tool name joins the path with underscores, each hyphen written as one, and no application name', async () => {
    expect(toolNamed(await toolsOf('listing'), 'cache_clear_all')).toMatchObject({
      annotations: { destructiveHint: true },
      description: 'Clear every entry.',
    });
  });

  it('a hidden Command that opts in is a tool, and an alias never is', async () => {
    const tools = await toolsOf('listing');
    expect(toolNamed(tools, 'secret')).toMatchObject({ description: 'A hidden tool.' });
    expect(toolNamed(tools, 'r')).toBeUndefined();
  });

  it("a deprecated tool's description opens with its migration message", async () => {
    expect(toolNamed(await toolsOf('listing'), 'old')).toMatchObject({
      description: 'Deprecated: Use read instead.\nRead one value the old way.',
    });
  });

  it('a line break in a core description or a deprecation message reads as one space', async () => {
    expect(toolNamed(await toolsOf('multiline'), 'fetch')).toMatchObject({
      description: 'Deprecated: Use get instead.\nRead one value at a path.',
      inputSchema: {
        properties: {
          depth: { description: 'Deprecated: Use --level.\nHow deep to walk.' },
          path: { description: 'The path.' },
        },
      },
    });
    const session = serve('multiline');
    session.send(request(1, 'server/discover'));
    const answer: Message = await session.next();
    await session.close();
    expect(JSON.stringify(answer.result)).toContain('"description":"A fixture kit."');
  });

  it("the extension's description replaces the core one, and a tool with neither carries none", async () => {
    const tools = await toolsOf('listing');
    expect(toolNamed(tools, 'worded')).toMatchObject({
      description: 'An agent description.\nIt keeps its line break.',
    });
    expect(toolNamed(tools, 'bare')).not.toHaveProperty('description');
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
      resultOf('calls', 'echo', { file: 'doc.json', loud: true, times: 3, word: 'hi' }),
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
    await expect(resultOf('calls', 'members')).resolves.toEqual({
      content: [{ text: '[\n  "a",\n  "b"\n]\n', type: 'text' }],
      isError: false,
      structuredContent: ['a', 'b'],
    });
  });

  it('a jsonl view stays text', async () => {
    await expect(resultOf('calls', 'lines')).resolves.toEqual({
      content: [{ text: '1\n2\n', type: 'text' }],
      isError: false,
    });
  });

  it('a view whose application/json text does not parse answers the text alone', async () => {
    await expect(resultOf('calls', 'lies')).resolves.toEqual({
      content: [{ text: 'not json\n', type: 'text' }],
      isError: false,
    });
  });

  it('answers the output, then the messages, as two text items', async () => {
    await expect(resultOf('calls', 'warned')).resolves.toEqual({
      content: [
        { text: 'the value\n', type: 'text' },
        { text: '⚠ a warning\n', type: 'text' },
      ],
      isError: false,
    });
  });

  it('reads no columns and leaves a lane unwrapped, with COLUMNS set', async () => {
    await expect(resultOf('columns', 'measure')).resolves.toEqual({
      content: [
        { text: 'undefined\n', type: 'text' },
        { text: '⚠ a warning long enough to wrap at twenty columns\n', type: 'text' },
      ],
      isError: false,
    });
  });

  it('answers a table and records byte for byte at their natural width, with COLUMNS set', async () => {
    const answer = await resultOf('fitted', 'grid');
    const text = Object(answer)
      .content.map((item: { text: string }) => item.text)
      .join('');
    expect(text).toBe(
      [
        `A${' '.repeat(12)}right`,
        'x y z  hello world',
        'second line',
        'q               zz',
        'second line',
        'key   one',
        'kind  first',
        'second words here',
        '',
        '1 record',
        '',
      ].join('\n'),
    );
  });

  it('a run that writes nothing answers one empty text item', async () => {
    await expect(resultOf('calls', 'quiet')).resolves.toEqual({
      content: [{ text: '', type: 'text' }],
      isError: false,
    });
  });
});

describe('a failed call', () => {
  it("answers the failure's report as text and its form as structured content", async () => {
    await expect(resultOf('calls', 'missing')).resolves.toEqual({
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
    expect(Object(await resultOf('calls', 'partial')).content).toEqual([
      { text: 'The rest is missing.\n', type: 'text' },
      { text: 'half\n', type: 'text' },
    ]);
  });

  it('a defect reads the generic defect message from a distributed build', async () => {
    await expect(resultOf('calls', 'crash')).resolves.toEqual({
      content: [{ text: 'calls: Something went wrong.\n', type: 'text' }],
      isError: true,
      structuredContent: {
        exitCode: 1,
        failure: { code: 'internal', exitCode: 1, hints: [], message: 'Something went wrong.' },
      },
    });
  });

  it('a failure whose view renders nothing answers one empty text item', async () => {
    await expect(resultOf('calls', 'silent')).resolves.toEqual({
      content: [{ text: '', type: 'text' }],
      isError: true,
      structuredContent: {
        exitCode: 1,
        failure: { code: 'silent', exitCode: 1, hints: [], message: 'Nothing to say.' },
      },
    });
  });

  it('a missing required argument reports by name, with an invalid-input form', async () => {
    await expect(resultOf('calls', 'echo', {})).resolves.toEqual({
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
    await expect(resultOf('calls', 'echo', { word: { nested: true } })).resolves.toMatchObject({
      content: [{ text: 'calls: Argument "word": Use a string or a number.\n', type: 'text' }],
      isError: true,
      structuredContent: { exitCode: 2, failure: { code: 'invalid-input' } },
    });
  });

  it('a key outside the input schema is a tool execution error, and no run starts', async () => {
    await expect(resultOf('calls', 'echo', { extra: 1, word: 'hi' })).resolves.toEqual({
      content: [
        {
          text: 'Tool "echo" takes no argument "extra". Use a property its input schema lists.',
          type: 'text',
        },
      ],
      isError: true,
    });
  });

  it("a hidden or control option's name is outside the input schema", async () => {
    for (const key of ['internal', 'style', 'trace', 'mode']) {
      await expect(resultOf('listing', 'read', { [key]: true, path: 'a' })).resolves.toEqual({
        content: [
          {
            text: `Tool "read" takes no argument "${key}". Use a property its input schema lists.`,
            type: 'text',
          },
        ],
        isError: true,
      });
    }
  });
});

describe('an initialize-era client', () => {
  it('opens with initialize, then lists and calls tools in the shape of 2025-06-18', async () => {
    const session = serve('calls');
    session.send(initialize(0, '2025-06-18'));
    await expect(session.next()).resolves.toEqual({
      id: 0,
      jsonrpc: '2.0',
      result: {
        capabilities: { tools: {} },
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'calls', version: '2.0.0' },
      },
    });
    session.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    session.send(handshakeRequest(1, 'tools/list'));
    const listing = await session.next();
    expect(Object.keys(Object(listing.result))).toEqual(['tools']);
    expect(toolNamed(Object(listing.result).tools, 'members')).toBeDefined();
    session.send(handshakeRequest(2, 'tools/call', { name: 'missing' }));
    await expect(session.next()).resolves.toMatchObject({
      result: { isError: true, structuredContent: { exitCode: 65 } },
    });
    await expect(session.close()).resolves.toMatchObject({ status: 0, stderr: '' });
  });

  it('answers a JSON view that prints an array as text alone', async () => {
    const session = serve('calls');
    session.send(initialize(0, '2025-11-25'));
    await session.next();
    session.send(handshakeRequest(1, 'tools/call', { name: 'members' }));
    await expect(session.next()).resolves.toEqual({
      id: 1,
      jsonrpc: '2.0',
      result: { content: [{ text: '[\n  "a",\n  "b"\n]\n', type: 'text' }], isError: false },
    });
    await session.close();
  });
});

describe('protocol errors', () => {
  it('an unknown tool is invalid params', async () => {
    const answer = await called('calls', 'ehco');
    expect(answer.error).toEqual({
      code: -32_602,
      message: 'Unknown tool "ehco". Call tools/list for the tool names.',
    });
  });

  it.each([[['hi']], ['hi'], [null]])('arguments of %j are invalid params', async (args) => {
    const answer = await called('calls', 'echo', args);
    expect(answer.error).toEqual({
      code: -32_602,
      message: 'Tool "echo" arguments must be an object. Supply a JSON object of named inputs.',
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
    session.send(request(1, 'tools/call', { arguments: { label: 'one' }, name: 'wait' }));
    await session.observed('started one');
    session.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { _meta: meta, requestId: 1 },
    });
    await session.observed('aborted one');
    session.send(request(2, 'tools/call', { arguments: { word: 'two' }, name: 'echo' }));
    await expect(session.next()).resolves.toMatchObject({ id: 2 });
    const ending = await session.close();
    expect(ending.messages.map((message) => message.id)).toEqual([2]);
    expect(ending).toMatchObject({ status: 0, stderr: 'started one\naborted one\n' });
  });

  it('two overlapping calls answer by their own ids', async () => {
    const session = serve('calls');
    session.send(request('a', 'tools/call', { arguments: { word: 'one' }, name: 'echo' }));
    session.send(request('b', 'tools/call', { arguments: { word: 'two' }, name: 'echo' }));
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
    session.send(request(1, 'tools/call', { arguments: { label: 'one' }, name: 'wait' }));
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
    session.send(request(1, 'tools/call', { arguments: { label: 'one' }, name: 'wait' }));
    session.send(request(2, 'tools/call', { arguments: { label: 'two' }, name: 'wait' }));
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

/** A tools/call request whose `_meta` carries a progress token. */
function tracked(id: number, token: number | string, name: string) {
  return {
    id,
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { _meta: { ...meta, progressToken: token }, arguments: {}, name },
  };
}

/** The messages a session wrote before the answer to `id`, and that answer. */
async function untilAnswer(session: ReturnType<typeof serve>, id: number) {
  const before: Message[] = [];
  for (;;) {
    const message = await session.next();
    if (message.id === id) {
      return { answer: message, before };
    }
    before.push(message);
  }
}

/** One progress notification on a token. */
function progressNote(progressToken: number | string, progress: number, message: string) {
  return {
    jsonrpc: '2.0',
    method: 'notifications/progress',
    params: { message, progress, progressToken },
  };
}

describe('progress', () => {
  it("sends one notifications/progress per event of a counted line, counting every event, before the call's result", async () => {
    const session = serve('progress');
    session.send(tracked(1, 'records', 'counted'));
    const { answer, before } = await untilAnswer(session, 1);
    await session.close();
    expect(before).toEqual([
      progressNote('records', 1, 'Fetching records 0/3 (started)'),
      progressNote('records', 2, 'Fetching records 1/3 (updated)'),
      progressNote('records', 3, 'Fetching records 2/3 (updated)'),
      progressNote('records', 4, 'Fetching records 3/3 (updated)'),
      progressNote('records', 5, 'Fetching records 3/3 (ended)'),
    ]);
    const [content] = Object(answer.result).content;
    expect(content.text.split('\n')).toEqual([
      expect.stringMatching(/ Fetching records$/u),
      expect.stringMatching(/ Fetching records$/u),
      '',
    ]);
  });

  it('a spinner line whose label changes once sends progress 1, 2, and 3', async () => {
    const session = serve('progress');
    session.send(tracked(1, 7, 'spinner'));
    const { before } = await untilAnswer(session, 1);
    await session.close();
    expect(before).toEqual([
      progressNote(7, 1, 'Building the index (started)'),
      progressNote(7, 2, 'Writing the index (updated)'),
      progressNote(7, 3, 'Writing the index (ended)'),
    ]);
  });

  it("a line that ends with a message sends that message as its end notification's label", async () => {
    const session = serve('progress');
    session.send(tracked(1, 'finished', 'finished'));
    const { before } = await untilAnswer(session, 1);
    await session.close();
    expect(before).toEqual([
      progressNote('finished', 1, 'Fetching records (started)'),
      progressNote('finished', 2, 'Fetched 3 records. (ended)'),
    ]);
  });

  it('two lines in one call share the token and one counter, in the order their events were delivered', async () => {
    const session = serve('progress');
    session.send(tracked(1, 'pair', 'pair'));
    const { before } = await untilAnswer(session, 1);
    await session.close();
    expect(before).toEqual([
      progressNote('pair', 1, 'First (started)'),
      progressNote('pair', 2, 'Second (started)'),
      progressNote('pair', 3, 'First (ended)'),
      progressNote('pair', 4, 'Second (ended)'),
    ]);
  });

  it('a region with no label sends its counts and state alone, and one with neither sends the state', async () => {
    const session = serve('progress');
    session.send(tracked(1, 'bare', 'bare'));
    const { before } = await untilAnswer(session, 1);
    await session.close();
    expect(before.slice(0, 2)).toEqual([
      progressNote('bare', 1, '1 (started)'),
      progressNote('bare', 2, '(started)'),
    ]);
  });

  it('a call without a token sends no notification', async () => {
    const session = serve('progress');
    session.send(request(1, 'tools/call', { arguments: {}, name: 'counted' }));
    const { before } = await untilAnswer(session, 1);
    await session.close();
    expect(before).toEqual([]);
  });

  it('a call the client cancels sends no notification after its cancellation', async () => {
    const session = serve('progress');
    session.send(tracked(1, 'waiting', 'waiting'));
    await session.observed('started waiting');
    session.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { _meta: meta, requestId: 1 },
    });
    await session.observed('aborted waiting');
    session.send(request(2, 'server/discover'));
    const { before } = await untilAnswer(session, 2);
    const ending = await session.close();
    expect(before).toEqual([progressNote('waiting', 1, 'Waiting (started)')]);
    expect(ending.messages).toHaveLength(2);
  });
});

type Rule =
  | 'property-name-taken'
  | 'required-input-excluded'
  | 'tool-name-taken'
  | 'tool-without-action';

describe('build faults', () => {
  it.each<[string, Rule, string, string]>([
    [
      'tool-name-taken',
      'tool-name-taken',
      'Commands "scratch create" and "scratch_create" both serve the MCP tool "scratch_create".',
      'Rename one Command, or remove mcpCommand from one of them.',
    ],
    [
      'tool-name-taken-root',
      'tool-name-taken',
      'The root Command and Command "app" both serve the MCP tool "app".',
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
    ...(['required-input-excluded', 'required-input-excluded-non-interactive'] as const).map(
      (scenario): [string, Rule, string, string] => [
        scenario,
        'required-input-excluded',
        'Command "get" requires option "file" and excludes it from its MCP tool, which leaves every call without a value.',
        'Make the option optional, or remove exclude from its mcpInput value.',
      ],
    ),
    [
      'required-input-excluded-content',
      'required-input-excluded',
      'Command "get" requires option "file" and excludes it from its MCP tool, which leaves every call without a value.',
      'Make the option optional, or remove exclude from its mcpInput value.',
    ],
    [
      'one-required-all-excluded',
      'required-input-excluded',
      'Command "get" requires one of options "message" and "file" and excludes every one from its MCP tool, which leaves every call without a value.',
      'Remove exclude from the mcpInput value of one of them.',
    ],
    [
      'together-some-excluded',
      'required-input-excluded',
      'Command "get" requires options "message" and "file" together and excludes "file" from its MCP tool, so a call that supplies the rest always fails.',
      'Exclude every option of the group from the tool, or none.',
    ],
  ])('%s fails every build under its rule', async (scenario, rule, sentence, correction) => {
    expect(inspectScenario(scenario)).toEqual({
      stdout: `thrown:1:@loomcli/plugins/mcp/${rule}: ${sentence} ${correction}\n`,
    });
    // A run that never serves a tool fails as the run that serves them does.
    for (const argv of [['plain'], ['mcp']]) {
      const developed = await run([scenario, ...argv], {
        env: { FIXTURE_BUILD: 'development' },
      });
      expect(developed).toMatchObject({ status: 1, stdout: '' });
      expect(ruleParts(developed.stderr)).toEqual({
        correction,
        identity: `@loomcli/plugins/mcp/${rule}`,
        sentence,
      });
      await expect(run([scenario, ...argv])).resolves.toEqual({
        status: 1,
        stderr: 'app: Something went wrong.\n',
        stdout: '',
      });
    }
  });

  it.each(['optional-input-excluded', 'one-required-some-excluded', 'together-all-excluded'])(
    '%s raises no fault, because a call can still satisfy every rule',
    async (scenario) => {
      expect(inspectScenario(scenario)).toEqual({
        stdout: 'inspected\n',
      });
    },
  );

  it('an application whose root declares arguments cannot install the plugin', async () => {
    expect(inspectScenario('root-arguments')).toEqual({
      stdout:
        'thrown:1:@loomcli/core/arguments-beside-children: The root Command declares argument "files" and attaches child "mcp". Move the argument into a child Command or remove the children.\n',
    });
  });
});

describe('excluded options', () => {
  const secrets = { FIXTURE_REGION: 'from-env', FIXTURE_SECRET: 'from-env' };

  /** One call of the excluded scenario's tool on a server whose environment binds both excluded options. */
  async function shown(args: unknown): Promise<Message> {
    const session = launch(fixture, ['excluded', 'mcp'], { env: childEnvironment(secrets) });
    session.send(request(1, 'tools/call', { arguments: args, name: 'show' }));
    const answer = await session.next();
    await session.close();
    return answer;
  }

  it('an excluded local option and an excluded global option leave properties and required', async () => {
    const tool = Object(toolNamed(await toolsOf('excluded'), 'show'));
    expect(Object.keys(tool.inputSchema.properties)).toEqual(['plain', 'left', 'right']);
    expect(tool.inputSchema).not.toHaveProperty('required');
  });

  it('an option that carries only an mcpInput description keeps its group constraints', async () => {
    const tool = Object(toolNamed(await toolsOf('excluded'), 'show'));
    expect(tool.inputSchema.allOf).toHaveLength(1);
    expect(JSON.stringify(tool.inputSchema.allOf)).toContain('"left"');
  });

  it('help and the manifest still show the excluded options', async () => {
    const help = await run(['excluded', 'show', '--help']);
    expect(help).toMatchObject({ status: 0, stderr: '' });
    expect(help.stdout).toContain('--secret');
    const manifest = await run(['excluded', '--manifest']);
    expect(manifest).toMatchObject({ status: 0, stderr: '' });
    expect(manifest.stdout).toContain('"secret"');
    expect(manifest.stdout).toContain('"region"');
  });

  it.each(['secret', 'region'])(
    'a call naming the excluded option %s is the takes-no-argument error',
    async (key) => {
      const answer = await shown({ [key]: 'x', left: 'a' });
      expect(Object(answer.result)).toMatchObject({
        content: [
          {
            text: `Tool "show" takes no argument "${key}". Use a property its input schema lists.`,
            type: 'text',
          },
        ],
        isError: true,
      });
    },
  );

  it('a call reads the declared default although the server environment binds the option', async () => {
    const answer = await shown({ left: 'a' });
    const [item] = Object(answer.result).content;
    expect(JSON.parse(item.text)).toMatchObject({
      left: 'a',
      region: 'default-region',
      secret: 'default-secret',
    });
  });

  it('an mcpInput value that holds a description and exclude is the invalid-extension-value fault', async () => {
    const invocation1 = inspectScenario('both-keys');
    expect(invocation1.stdout).toContain('thrown:1:@loomcli/core/invalid-extension-value:');
  });
});
