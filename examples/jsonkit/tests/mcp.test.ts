import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';

import { launch, request } from '../../../packages/mcp/tests/session.js';
import type { Message } from '../../../packages/mcp/tests/session.js';
import { childEnvironment } from '../../../scripts/test-process.js';
import { main } from './documents.js';

/** The document every call reads, and a document that does not parse. */
const files = {
  'broken.json': '{"name":',
  'doc.json': '{"name":"loom","user":{"name":"Ada"},"tags":["a"]}',
};

let directory = '';

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'loom-jsonkit-mcp-'));
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(directory, name), contents);
  }
});

afterAll(() => {
  rmSync(directory, { force: true, recursive: true });
});

const serverInfo = {
  'io.modelcontextprotocol/serverInfo': {
    description: 'Read and reshape one JSON document.',
    name: 'jsonkit',
    version: '0.0.0',
  },
};

/** The properties every jsonkit tool lists last: the global options a call may supply. */
const globals = {
  file: { description: 'The document to read. Omit it to read piped text.', type: 'string' },
  verbose: { description: 'Name the document before reading it.', minimum: 0, type: 'integer' },
};

const annotations = { openWorldHint: false, readOnlyHint: true };

/** A tool result as the server writes it, stamped with jsonkit's identity. */
function result(body: Record<string, unknown>) {
  return { ...body, _meta: serverInfo, resultType: 'complete' };
}

/** A failed call's result: the failure's report as text and its form as structured content. */
function failed(code: string, exitCode: number, message: string, text = `${message}\n`) {
  return result({
    content: [{ text, type: 'text' }],
    isError: true,
    structuredContent: { exitCode, failure: { code, exitCode, hints: [], message } },
  });
}

describe.each(['node', 'bun'])('jsonkit mcp, the bundle under %s', (runtime) => {
  /** A session with the built jsonkit, run in the documents' directory. */
  function serve() {
    return launch(main, ['mcp'], { cwd: directory, env: childEnvironment({}), runtime });
  }

  /** One tool call's answer from a fresh session, which then ends with exit 0. */
  async function call(name: string, args: Record<string, unknown>): Promise<Message> {
    const session = serve();
    session.send(request(1, 'tools/call', { arguments: args, name }));
    const answer = await session.next();
    await expect(session.close()).resolves.toMatchObject({ status: 0, stderr: '' });
    return answer;
  }

  /** One tool call's result from a fresh session. */
  async function resultOf(name: string, args: Record<string, unknown>): Promise<unknown> {
    const answer = await call(name, args);
    return answer.result;
  }

  it('server/discover names jsonkit, its version, and its description', async () => {
    const session = serve();
    session.send(request(1, 'server/discover'));
    await expect(session.next()).resolves.toEqual({
      id: 1,
      jsonrpc: '2.0',
      result: {
        _meta: serverInfo,
        cacheScope: 'private',
        capabilities: { tools: {} },
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
        ttlMs: 0,
      },
    });
    // Closing stdin ends the session, and the process exits 0.
    await expect(session.close()).resolves.toMatchObject({ status: 0, stderr: '' });
  });

  it('tools/list lists the root, get, keys, and select with their schemas, and no control option', async () => {
    const session = serve();
    session.send(request(1, 'tools/list'));
    const answer = await session.next();
    await session.close();
    expect(answer.result).toEqual({
      _meta: serverInfo,
      cacheScope: 'private',
      resultType: 'complete',
      tools: [
        {
          annotations,
          description: 'Read and reshape one JSON document.',
          inputSchema: { additionalProperties: false, properties: globals, type: 'object' },
          name: 'jsonkit',
        },
        {
          annotations,
          description: 'Read one value at a path.',
          inputSchema: {
            additionalProperties: false,
            properties: { path: { description: 'Dot path to read.', type: 'string' }, ...globals },
            required: ['path'],
            type: 'object',
          },
          name: 'get',
        },
        {
          annotations,
          description: 'List the keys at a path.',
          inputSchema: {
            additionalProperties: false,
            properties: {
              path: { description: 'Dot path to list. Omit it for the root.', type: 'string' },
              ...globals,
            },
            type: 'object',
          },
          name: 'keys',
        },
        {
          annotations,
          description: 'Keep the named fields of the document.',
          inputSchema: {
            additionalProperties: false,
            properties: {
              field: {
                description: 'A field to keep. Repeat it for several.',
                items: { minLength: 1, type: 'string' },
                type: 'array',
              },
              ...globals,
            },
            required: ['field'],
            type: 'object',
          },
          name: 'select',
        },
      ],
      ttlMs: 0,
    });
  });

  it('get answers the value as text with no structured content', async () => {
    await expect(call('get', { file: 'doc.json', path: 'user.name' })).resolves.toEqual({
      id: 1,
      jsonrpc: '2.0',
      result: result({ content: [{ text: '"Ada"\n', type: 'text' }], isError: false }),
    });
  });

  it("jsonkit answers the root's members as text and as the array its json view prints", async () => {
    const members = [
      { key: 'name', kind: 'string' },
      { key: 'user', kind: 'object with 1 key' },
      { key: 'tags', kind: 'array with 1 item' },
    ];
    await expect(resultOf('jsonkit', { file: 'doc.json' })).resolves.toEqual(
      result({
        content: [
          { text: `${JSON.stringify(members, undefined, 2)}\n`, type: 'text' },
          { text: 'ℹ object with 3 keys\n', type: 'text' },
        ],
        isError: false,
        structuredContent: members,
      }),
    );
  });

  it('keys answers the keys as text', async () => {
    await expect(resultOf('keys', { file: 'doc.json' })).resolves.toEqual(
      result({ content: [{ text: 'name\nuser\ntags\n', type: 'text' }], isError: false }),
    );
  });

  it('select with an absent field answers the fields, then the warning', async () => {
    await expect(
      resultOf('select', { field: ['name', 'absent'], file: 'doc.json' }),
    ).resolves.toEqual(
      result({
        content: [
          { text: '{\n  "name": "loom"\n}\n', type: 'text' },
          {
            text: '⚠ Field not found: "absent". Run jsonkit keys to list the fields.\n',
            type: 'text',
          },
        ],
        isError: false,
      }),
    );
  });

  it('a missing path answers the failure with its form', async () => {
    await expect(resultOf('get', { file: 'doc.json', path: 'missing' })).resolves.toEqual(
      failed(
        'path-not-found',
        65,
        'Path not found: "missing". Run jsonkit keys to list the keys at the root.',
      ),
    );
  });

  it('a malformed document answers 65 with the code invalid-json', async () => {
    await expect(resultOf('get', { file: 'broken.json', path: 'name' })).resolves.toEqual(
      failed(
        'invalid-json',
        65,
        'The document is not valid JSON. Correct its syntax, or supply another document.',
      ),
    );
  });

  it('a missing required argument and a value of the wrong shape report by name, with no help hint', async () => {
    const missing = 'Argument "path" requires a value. Supply a value for "path".';
    await expect(resultOf('get', { file: 'doc.json' })).resolves.toEqual(
      failed('invalid-input', 2, missing, `jsonkit: ${missing}\n`),
    );
    const shape = 'Argument "path": Use a string or a number.';
    await expect(resultOf('get', { file: 'doc.json', path: true })).resolves.toEqual(
      failed('invalid-input', 2, shape, `jsonkit: ${shape}\n`),
    );
  });

  it('a key outside the schema, a control option included, answers the tool execution error', async () => {
    await expect(resultOf('get', { format: 'json', path: 'name' })).resolves.toEqual(
      result({
        content: [
          {
            text: 'Tool "get" takes no argument "format". Use a property its input schema lists.',
            type: 'text',
          },
        ],
        isError: true,
      }),
    );
  });

  it('an unknown tool and arguments that are not an object answer -32602', async () => {
    const unknown = await call('gte', {});
    expect(unknown.error).toEqual({
      code: -32_602,
      message: 'Unknown tool "gte". Call tools/list for the tool names.',
    });
    const session = serve();
    session.send(request(1, 'tools/call', { arguments: ['name'], name: 'get' }));
    const refused = await session.next();
    expect(refused.error).toEqual({
      code: -32_602,
      message: 'Tool "get" arguments must be an object. Supply a JSON object of named inputs.',
    });
    await expect(session.close()).resolves.toMatchObject({ status: 0, stderr: '' });
  });
});
