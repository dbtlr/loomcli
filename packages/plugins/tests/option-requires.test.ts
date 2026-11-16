/*
 * The projections of a one-way requirement (docs/core/options.md#a-one-way-requirement, ADR-0167):
 * help, the man page, the manifest, an MCP tool's schema and its build fault, and completion, which
 * does not change. Every case runs the application in process on a mock process.
 */
import { Application, Command, DeclarationError } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { help } from '@loomcli/plugins/help';
import { manifest } from '@loomcli/plugins/manifest';
import { mcp } from '@loomcli/plugins/mcp';
import { mcpCommand, mcpInput } from '@loomcli/plugins/mcp/extension';
import { expect, test } from 'vite-plus/test';

import { manPages } from '../src/manpage/page.js';
import { runOnMock } from './fixtures/in-process.js';

const excluding = [mcpInput({ exclude: true })];

/**
 * `login` holds a requirement of several options, one of a Boolean, one over a hidden option, one
 * of a multiple option, and one whose option is excluded from the MCP tool.
 */
const login = new Command('login', { description: 'Sign in.' })
  .option('user', { description: 'The account name.', type: 'string' })
  .option('password', { description: 'The password.', type: 'string' })
  .option('host', { description: 'The server.', type: 'string' })
  .option('pretty', { description: 'Pretty output.', polarity: 'both', type: 'boolean' })
  .option('format', { description: 'The format.', type: 'string' })
  .option('wide', { description: 'Wide output.', polarity: 'both', type: 'boolean' })
  .option('files', { description: 'The files.', multiple: true, type: 'string' })
  .option('secret', { description: 'A hidden setting.', hidden: true, type: 'string' })
  .option('trace', { description: 'Trace the run.', extensions: excluding, type: 'string' })
  .requires('password', 'user', 'host')
  .requires('pretty', 'format')
  .requires('format', 'wide')
  .requires('files', 'user')
  .requires('secret', 'user')
  .requires('trace', 'user')
  .extend(mcpCommand({}))
  .action(({ out }) => out.print('signed in'));

function application() {
  return new Application('app', {
    description: 'Sign in to servers.',
    plugins: [help(), manifest(), completion(), mcp()],
  }).command(login);
}

const sentences = [
  'Use --password only with --user and --host.',
  'Use --pretty only with --format.',
  'Use --format only with --wide.',
  'Use --files only with --user.',
  'Use --trace only with --user.',
];

test('help prints one sentence per visible requirement, in declaration order', async () => {
  const page = await runOnMock(application(), { argv: ['login', '--help'] });
  expect(page.status).toBe(0);
  expect(page.stdout.split('\n').filter((line) => / only with /u.test(line))).toEqual(
    sentences.map((sentence) => `  ${sentence}`),
  );
  expect(page.stdout).not.toContain('--secret');
});

test("the man page prints help's option-group sentences after the option entries", () => {
  const page = manPages(application().inspect()).find(({ file }) => file === 'app-login.1');
  const lines = page?.text.split('\n') ?? [];
  const first = lines.indexOf(String.raw`Use \-\-password only with \-\-user and \-\-host.`);
  expect(lines.slice(first - 1, first + 2 * sentences.length - 1)).toEqual(
    sentences.flatMap((sentence) => ['.PP', sentence.replaceAll('-', String.raw`\-`)]),
  );
  expect(lines.slice(0, first).findLast((line) => line.startsWith('.SH'))).toBe('.SH "OPTIONS"');
  expect(page?.text).not.toContain('secret');
});

test('the manifest publishes the entry inspection publishes, less a requirement with a hidden member', async () => {
  const graph = application().inspect();
  const node = graph.root.children.find((child) => child.name === 'login');
  expect(node?.optionGroups).toContainEqual({
    kind: 'requires',
    option: 'secret',
    requires: ['user'],
  });
  const document = await runOnMock(application(), { argv: ['login', '--manifest'] });
  expect(document.status).toBe(0);
  expect(JSON.parse(document.stdout).command.optionGroups).toEqual([
    { kind: 'requires', option: 'password', requires: ['user', 'host'] },
    { kind: 'requires', option: 'pretty', requires: ['format'] },
    { kind: 'requires', option: 'format', requires: ['wide'] },
    { kind: 'requires', option: 'files', requires: ['user'] },
    { kind: 'requires', option: 'trace', requires: ['user'] },
  ]);
});

/** The `_meta` every request of the pinned revision carries. */
const meta = {
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
};

/** The input schema of each tool the application's MCP server lists, by tool name. */
async function toolSchemas(): Promise<Record<string, Record<string, unknown>>> {
  const listing = { id: 1, jsonrpc: '2.0', method: 'tools/list', params: { _meta: meta } };
  const served = await runOnMock(application(), {
    argv: ['mcp'],
    stdin: `${JSON.stringify(listing)}\n`,
  });
  const [answer] = served.stdout.split('\n');
  const tools: { inputSchema: Record<string, unknown>; name: string }[] = JSON.parse(answer ?? '{}')
    .result.tools;
  return Object.fromEntries(tools.map((tool) => [tool.name, tool.inputSchema]));
}

test('an MCP tool states each requirement it can state soundly', async () => {
  const schemas = await toolSchemas();
  expect(schemas.login?.allOf).toEqual([
    // Presence states each side: scalar string options.
    { dependentRequired: { password: ['user', 'host'] } },
    // A Boolean option at its absent value triggers nothing, so the trigger reads its claim.
    {
      anyOf: [
        { not: { properties: { pretty: { const: true } }, required: ['pretty'] } },
        { allOf: [{ required: ['format'] }] },
      ],
    },
    // A named false still supplies a Boolean option of both polarity.
    { dependentRequired: { format: ['wide'] } },
    // A named empty list lowers to absence, which triggers nothing.
    {
      anyOf: [
        { not: { properties: { files: { minItems: 1 } }, required: ['files'] } },
        { allOf: [{ required: ['user'] }] },
      ],
    },
  ]);
});

test('an MCP tool that excludes an option a requirement needs, and not its option, fails the build', () => {
  const broken = new Application('app', { plugins: [mcp()] }).command(
    new Command('login')
      .option('user', { extensions: excluding, type: 'string' })
      .option('host', { extensions: excluding, type: 'string' })
      .option('password', { type: 'string' })
      .requires('password', 'host', 'user')
      .extend(mcpCommand({}))
      .action(() => {}),
  );
  let fault: unknown = undefined;
  try {
    broken.inspect();
  } catch (error) {
    fault = error;
  }
  expect(fault).toBeInstanceOf(DeclarationError);
  const { message } = fault instanceof DeclarationError ? fault : { message: '' };
  expect(message).toContain('@loomcli/plugins/mcp/required-input-excluded');
  expect(message).toContain(
    'Command "login" makes option "password" require options "host" and "user" and excludes "host" from its MCP tool, so a call that supplies "password" always fails.',
  );
  expect(message).toContain(
    'Exclude "password" from the tool as well, or remove exclude from the mcpInput value of "host".',
  );
});

test('completion offers every option a requirement holds, triggered or not', async () => {
  const offered = await runOnMock(application(), {
    argv: ['completion', '__complete', '--', 'login', '--password', 'secret', '--'],
  });
  expect(offered.status).toBe(0);
  for (const spelling of ['--user', '--host', '--pretty', '--format', '--wide']) {
    expect(offered.stdout).toContain(`${spelling}\t`);
  }
});

/** An application that serves MCP and holds no Command yet. */
function mcpApplication() {
  return new Application('app', { plugins: [mcp()] });
}

/** The input schema of the one tool the application `attach` builds lists. */
async function schemaOf(
  attach: (app: ReturnType<typeof mcpApplication>) => Parameters<typeof runOnMock>[0],
): Promise<Record<string, unknown> | undefined> {
  const listing = { id: 1, jsonrpc: '2.0', method: 'tools/list', params: { _meta: meta } };
  const answer = await runOnMock(attach(mcpApplication()), {
    argv: ['mcp'],
    stdin: `${JSON.stringify(listing)}\n`,
  });
  const [line] = answer.stdout.split('\n');
  const tools: { inputSchema: Record<string, unknown> }[] = JSON.parse(line ?? '{}').result.tools;
  return tools[0]?.inputSchema;
}

test('a requirement whose needed option cannot state presence by key alone gets the anyOf form', async () => {
  const boolean = await schemaOf((app) =>
    app.command(
      new Command('boolean')
        .option('user', { type: 'string' })
        .option('flag', { type: 'boolean' })
        .requires('user', 'flag')
        .extend(mcpCommand({}))
        .action(() => {}),
    ),
  );
  // A Boolean option of one polarity is supplied only by its own value.
  expect(boolean?.allOf).toEqual([
    {
      anyOf: [
        { not: { required: ['user'] } },
        { allOf: [{ properties: { flag: { const: true } }, required: ['flag'] }] },
      ],
    },
  ]);
  const multiple = await schemaOf((app) =>
    app.command(
      new Command('multiple')
        .option('user', { type: 'string' })
        .option('files', { multiple: true, type: 'string' })
        .requires('user', 'files')
        .extend(mcpCommand({}))
        .action(() => {}),
    ),
  );
  // A named empty list lowers to absence.
  expect(multiple?.allOf).toEqual([
    {
      anyOf: [
        { not: { required: ['user'] } },
        { allOf: [{ properties: { files: { minItems: 1 } }, required: ['files'] }] },
      ],
    },
  ]);
  const counted = await schemaOf((app) =>
    app.command(
      new Command('counted')
        .option('user', { type: 'string' })
        .option('verbosity', { type: 'count' })
        .requires('user', 'verbosity')
        .extend(mcpCommand({}))
        .action(() => {}),
    ),
  );
  // A named zero count lowers to absence.
  expect(counted?.allOf).toEqual([
    {
      anyOf: [
        { not: { required: ['user'] } },
        { allOf: [{ properties: { verbosity: { minimum: 1 } }, required: ['verbosity'] }] },
      ],
    },
  ]);
});

test('an MCP tool states no requirement when its option or a needed option is bound to a variable', async () => {
  const boundOption = await schemaOf((app) =>
    app.command(
      new Command('envoption')
        .option('user', { type: 'string' })
        .option('password', { env: 'APP_PASSWORD', type: 'string' })
        .requires('password', 'user')
        .extend(mcpCommand({}))
        .action(() => {}),
    ),
  );
  expect(boundOption).toBeDefined();
  expect(boundOption).not.toHaveProperty('allOf');
  const boundNeeded = await schemaOf((app) =>
    app.command(
      new Command('envneeded')
        .option('user', { env: 'APP_USER', type: 'string' })
        .option('password', { type: 'string' })
        .requires('password', 'user')
        .extend(mcpCommand({}))
        .action(() => {}),
    ),
  );
  expect(boundNeeded).toBeDefined();
  expect(boundNeeded).not.toHaveProperty('allOf');
});

test('an MCP tool states no requirement when a needed option is hidden', async () => {
  const schema = await schemaOf((app) =>
    app.command(
      new Command('hiddenneeded')
        .option('user', { hidden: true, type: 'string' })
        .option('password', { type: 'string' })
        .requires('password', 'user')
        .extend(mcpCommand({}))
        .action(() => {}),
    ),
  );
  expect(schema).toBeDefined();
  expect(schema).not.toHaveProperty('allOf');
});

test('an MCP tool that excludes both a requirement option and the option it needs fails no build', () => {
  const both = new Application('app', { plugins: [mcp()] }).command(
    new Command('login')
      .option('user', { extensions: excluding, type: 'string' })
      .option('password', { extensions: excluding, type: 'string' })
      .requires('password', 'user')
      .extend(mcpCommand({}))
      .action(() => {}),
  );
  expect(() => both.inspect()).not.toThrow();
});

/** An application whose `login` holds a requirement over a hidden needed option and a visible one. */
function hiddenNeeded() {
  return new Application('app', {
    description: 'Sign in to servers.',
    plugins: [help(), manifest()],
  }).command(
    new Command('login', { description: 'Sign in.' })
      .option('user', { description: 'The account name.', type: 'string' })
      .option('password', { description: 'The password.', type: 'string' })
      .option('host', { description: 'The server.', type: 'string' })
      .option('secret', { description: 'A hidden setting.', hidden: true, type: 'string' })
      .requires('password', 'secret')
      .requires('host', 'user')
      .action(() => {}),
  );
}

test('help, the man page, and the manifest leave out a requirement whose needed option is hidden', async () => {
  const page = await runOnMock(hiddenNeeded(), { argv: ['login', '--help'] });
  expect(page.stdout.split('\n').filter((line) => / only with /u.test(line))).toEqual([
    '  Use --host only with --user.',
  ]);
  const man = manPages(hiddenNeeded().inspect()).find(({ file }) => file === 'app-login.1');
  expect(man?.text.split('\n').filter((line) => / only with /u.test(line))).toEqual([
    String.raw`Use \-\-host only with \-\-user.`,
  ]);
  const document = await runOnMock(hiddenNeeded(), { argv: ['login', '--manifest'] });
  expect(JSON.parse(document.stdout).command.optionGroups).toEqual([
    { kind: 'requires', option: 'host', requires: ['user'] },
  ]);
});
