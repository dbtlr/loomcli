import { expect, test } from 'vite-plus/test';

import { invoke, childEnvironment } from '../../../scripts/test-process.js';
import { launch, request } from '../../mcp/tests/session.js';

const fixture = new URL('fixtures/option-groups.mjs', import.meta.url);

test('help states visible groups and the manifest publishes the same graph facts', () => {
  const help = invoke(fixture, ['--help']);
  expect(help.status).toBe(0);
  expect(help.stdout).toContain('Use at most one of --json and --yaml.');
  expect(help.stdout).toContain('Supply at least one of --json and --yaml.');
  expect(help.stdout).toContain('Use --user and --password together.');
  expect(help.stdout).not.toContain('--secret');
  const manifest = invoke(fixture, ['--manifest']);
  expect(manifest.status).toBe(0);
  expect(JSON.parse(manifest.stdout).command.optionGroups).toEqual([
    { kind: 'exclusive', options: ['json', 'yaml'] },
    { kind: 'oneRequired', options: ['json', 'yaml'] },
    { kind: 'requiredTogether', options: ['user', 'password'] },
  ]);
});

test('completion suppresses exclusive siblings after a claiming spelling, an alias included', () => {
  for (const supplied of ['--json', '--js']) {
    const result = invoke(fixture, ['completion', '__complete', '--', supplied, '--']);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('--yaml');
    expect(result.stdout).toContain('--user');
  }
});

test('completion still offers exclusive siblings after a false Boolean spelling', () => {
  const result = invoke(fixture, ['completion', '__complete', '--', '--no-json', '--']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('--yaml');
});

test('a false Boolean spelling claims no exclusive group, and group diagnostics retain the reported spelling', () => {
  const negative = invoke(fixture, ['--no-json', '--yaml']);
  expect(negative.status).toBe(0);
  expect(negative.stdout).toBe('action\n');
  const alias = invoke(fixture, ['--js', '--yaml']);
  expect(alias.status).toBe(2);
  expect(alias.stderr).toContain(
    'groups: Options "--json" and "--yaml" cannot be used together. Supply only one of them.\n',
  );
});

test('MCP lists sound group schemas and rejects group failures through invoke', async () => {
  const session = launch(fixture, ['mcp'], { env: childEnvironment({}) });
  session.send(request(1, 'tools/list'));
  const answer = await session.next();
  const tools = Object(answer.result).tools;
  expect(tools[0].inputSchema.allOf).toEqual(
    expect.arrayContaining([
      {
        not: {
          allOf: [
            { properties: { json: { const: true } }, required: ['json'] },
            { properties: { yaml: { const: true } }, required: ['yaml'] },
          ],
        },
      },
      { anyOf: [{ required: ['json'] }, { required: ['yaml'] }] },
    ]),
  );
  session.send(request(2, 'tools/call', { arguments: { json: true, yaml: true }, name: 'groups' }));
  const failed = await session.next();
  expect(Object(failed.result).isError).toBe(true);
  expect(JSON.stringify(failed.result)).toContain('cannot be used together');
  session.send(
    request(3, 'tools/call', { arguments: { json: true, yaml: false }, name: 'groups' }),
  );
  const agreed = await session.next();
  expect(Object(agreed.result).isError).not.toBe(true);
  const ending = await session.close();
  expect(ending).toMatchObject({ status: 0, stderr: '' });
});

test('MCP schemas describe named false, zero, and empty-list absence and omit uncertain requirements', async () => {
  const session = launch(fixture, ['mcp'], { env: childEnvironment({}) });
  session.send(request(1, 'tools/list'));
  const listed = await session.next();
  const tools = Object(listed.result).tools;
  const schemas = Object.fromEntries(
    tools.map((tool: unknown) => [Object(tool).name, Object(tool).inputSchema]),
  );
  expect(schemas.choice.allOf).toEqual([
    {
      not: {
        allOf: [
          { properties: { flag: { const: true } }, required: ['flag'] },
          { properties: { count: { minimum: 1 } }, required: ['count'] },
        ],
      },
    },
    {
      not: {
        allOf: [
          { properties: { flag: { const: true } }, required: ['flag'] },
          { properties: { items: { minItems: 1 } }, required: ['items'] },
        ],
      },
    },
    {
      not: {
        allOf: [
          { properties: { count: { minimum: 1 } }, required: ['count'] },
          { properties: { items: { minItems: 1 } }, required: ['items'] },
        ],
      },
    },
  ]);
  // A negative Boolean member gives false in every call, so it never claims its exclusive group.
  expect(schemas.negated.allOf).toEqual([
    {
      not: {
        allOf: [
          { properties: { json: { const: true } }, required: ['json'] },
          { properties: { yaml: { const: true } }, required: ['yaml'] },
        ],
      },
    },
  ]);
  expect(schemas.need.allOf).toHaveLength(1);
  expect(schemas.together.allOf).toHaveLength(1);
  expect(schemas.bound).not.toHaveProperty('allOf');
  // The plugin's own extension binds nothing, and another plugin's might.
  expect(schemas.described.allOf).toHaveLength(1);
  expect(schemas.extended).not.toHaveProperty('allOf');
  // An excluded member is never supplied in a call, so each group constrains the members listed.
  expect(schemas.partial.allOf).toEqual([
    { anyOf: [{ required: ['message'] }] },
    { not: { allOf: [{ required: ['left'] }, { required: ['right'] }] } },
  ]);
  session.send(
    request(2, 'tools/call', { arguments: { count: 0, flag: false, items: [] }, name: 'choice' }),
  );
  const choiceOutcome = await session.next();
  expect(Object(choiceOutcome.result).isError).not.toBe(true);
  session.send(
    request(3, 'tools/call', { arguments: { count: 0, flag: false, items: [] }, name: 'need' }),
  );
  const needOutcome = await session.next();
  expect(Object(needOutcome.result).isError).toBe(true);
  session.send(
    request(4, 'tools/call', {
      arguments: { count: 1, flag: true, items: ['item'] },
      name: 'together',
    }),
  );
  const togetherOutcome = await session.next();
  expect(Object(togetherOutcome.result).isError).not.toBe(true);
  await expect(session.close()).resolves.toMatchObject({ status: 0, stderr: '' });
});
