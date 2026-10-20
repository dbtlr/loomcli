import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';
import { document, main, withDocuments } from './documents.js';

/** The application's own manifest, which is where its declared version comes from. */
const manifest = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')));

/** The two failures jsonkit declares, as the manifest's extension stores them. */
const invalidJson = {
  code: 'invalid-json',
  exitCode: 65,
  meaning: 'The document is not valid JSON.',
};
const pathNotFound = {
  code: 'path-not-found',
  exitCode: 65,
  meaning: 'The path names no value in the document.',
};

const command = [
  'jsonkit get',
  'Read one value at a path.',
  'A path is a dot-separated walk from the root of the document.',
  '  jsonkit get name -f doc.json',
  '  jsonkit get nested.deep.value -f doc.json',
  '',
].join('\n');

const application = [
  'jsonkit',
  'Read and reshape one JSON document.',
  'With no subcommand, jsonkit summarizes the document and its top-level keys.',
  '  jsonkit -f doc.json',
  '  jsonkit get user.name -f doc.json',
  '',
].join('\n');

/** What one invocation of the inspection fixture reports about the installed plugin. */
const inspected = z.object({
  globals: z.array(z.object({ name: z.string() })),
  root: z.object({
    children: z.array(
      z.object({ extensions: z.record(z.string(), z.unknown()), name: z.string() }),
    ),
    extensions: z.record(z.string(), z.unknown()),
  }),
  version: z.string(),
});

test('only document-reading Commands claim stdin through their local native file option', () => {
  const result = invoke(new URL('fixtures/inspect.mjs', import.meta.url));
  expect(result).toMatchObject({ status: 0, stderr: '' });
  const option = z.object({
    name: z.string(),
    required: z.boolean().optional(),
    schema: z.unknown(),
    stdin: z.boolean().optional(),
    type: z.string(),
  });
  const inspectedCommand = z.object({ name: z.string().nullable(), options: z.array(option) });
  const graph = z
    .object({
      globals: z.array(option),
      root: inspectedCommand.extend({ children: z.array(inspectedCommand) }),
    })
    .parse(JSON.parse(result.stdout));
  expect(graph.globals.map((input) => input.name)).not.toContain('file');
  const documentCommands = new Set([null, 'get', 'keys', 'select', 'fetch', 'paths', 'debug']);
  for (const node of [graph.root, ...graph.root.children]) {
    const file = node.options.filter((input) => input.name === 'file');
    expect(file).toEqual(
      documentCommands.has(node.name)
        ? [
            {
              name: 'file',
              required: true,
              schema: { minLength: 1, type: 'string' },
              stdin: true,
              type: 'content',
            },
          ]
        : [],
    );
  }
});

test.each(['--explain', '-e'])(
  'jsonkit get %s explains the routed Command and reads no document',
  (spelling) => {
    // The invocation names no document. Dispatch would fail on the required path instead of
    // Completing with the explanation, and the document remains unread.
    withDocuments({ 'doc.json': document }, (cwd) => {
      expect(invoke(main, ['get', spelling], { cwd })).toEqual({
        status: 0,
        stderr: '',
        stdout: command,
      });
    });
  },
);

test('jsonkit explains the root when no subcommand is routed', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['--explain'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: application,
    });
  });
});

test('jsonkit explains an otherwise invalid invocation instead of rejecting it', () => {
  /**
   * `get` needs its required path, and the named document does not exist. The middleware takes
   * over while preparation faults are held, so dispatch never raises them.
   */
  withDocuments({}, (cwd) => {
    expect(invoke(main, ['get', '--explain', '--file', 'missing.json'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: command,
    });
  });
});

test("the inspected graph carries the plugin's option, the extension value, and the version", () => {
  const result = invoke(new URL('fixtures/inspect.mjs', import.meta.url));
  expect(result.status).toBe(0);
  const graph = inspected.parse(JSON.parse(result.stdout));
  expect(graph.version).toBe(manifest.version);
  expect(graph.globals.map((option) => option.name)).toEqual([
    'help',
    'version',
    'manifest',
    'explain',
    'color',
    'verbose',
    'quiet',
  ]);
  // The two plugins define separate facts, so one declaration carries a value for each.
  // Help also supplies its value to the manifest's collecting extension, with no manifest installed.
  expect(graph.root.extensions).toEqual({
    '@loom/explain/command': {
      details: 'With no subcommand, jsonkit summarizes the document and its top-level keys.',
      examples: ['jsonkit -f doc.json', 'jsonkit get user.name -f doc.json'],
    },
    '@loomcli/plugins/help/command': {
      commandSections: [
        ['Document commands', 'Read'],
        ['Document commands', 'Reshape'],
        ['Commands'],
      ],
      details: 'With no subcommand, jsonkit summarizes the document and its top-level keys.',
      examples: [{ command: '-f doc.json' }, { command: 'get user.name -f doc.json' }],
    },
    '@loomcli/plugins/manifest/command': [
      { failures: [invalidJson] },
      {
        details: 'With no subcommand, jsonkit summarizes the document and its top-level keys.',
        examples: [{ command: '-f doc.json' }, { command: 'get user.name -f doc.json' }],
      },
    ],
    '@loomcli/plugins/mcp/command': { annotations: { openWorld: false, readOnly: true } },
  });
  const get = graph.root.children.find((child) => child.name === 'get');
  expect(get?.extensions).toEqual({
    '@loom/explain/command': {
      details: 'A path is a dot-separated walk from the root of the document.',
      examples: ['jsonkit get name -f doc.json', 'jsonkit get nested.deep.value -f doc.json'],
    },
    '@loomcli/plugins/help/command': {
      details:
        "A path is a dot-separated walk from the root of the document.\n\n- A **key** reads an object's member, such as `user.name`.\n- A **whole number** reads an array's item, such as `items.0`.\n\nThe document is *JSON*; see [the format](https://www.json.org/json-en.html).\n",
      examples: [
        { command: 'get name -f doc.json' },
        { command: 'get nested.deep.value -f doc.json' },
      ],
      section: ['Document commands', 'Read'],
    },
    // The author's agent-only value comes first, then the value help supplied at its hook.
    '@loomcli/plugins/manifest/command': [
      {
        details: 'Quote a path that holds a shell metacharacter.',
        failures: [pathNotFound, invalidJson],
      },
      {
        details:
          "A path is a dot-separated walk from the root of the document.\n\n- A **key** reads an object's member, such as `user.name`.\n- A **whole number** reads an array's item, such as `items.0`.\n\nThe document is *JSON*; see [the format](https://www.json.org/json-en.html).\n",
        examples: [
          { command: 'get name -f doc.json' },
          { command: 'get nested.deep.value -f doc.json' },
        ],
      },
    ],
    '@loomcli/plugins/mcp/command': { annotations: { openWorld: false, readOnly: true } },
  });
});

test('an unknown option gains the hint that names the explain spelling for the routed Command', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['get', '--bogus', '-f', 'doc.json'], { cwd })).toEqual({
      status: 2,
      stderr:
        'jsonkit: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".\nRun "jsonkit get --help" to see the usage.\nRun "jsonkit get --explain" to explain this command.\n',
      stdout: '',
    });
  });
});
