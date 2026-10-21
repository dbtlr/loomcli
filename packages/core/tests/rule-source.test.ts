import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from 'vite-plus/test';

import { readDeclaredRules, rulesInSource } from '../../../scripts/rule-source.mjs';
import { coreRules } from './rule-parts.js';

/** The repository root. */
const root = fileURLToPath(new URL('../../../', import.meta.url));

/** The temporary package trees this file built, removed after each test. */
const trees: string[] = [];

afterEach(() => {
  for (const directory of trees.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/** A temporary repository holding the given files, by path from its root. */
function repository(files: Record<string, string>): string {
  const tree = mkdtempSync(join(tmpdir(), 'loom-rule-source-'));
  trees.push(tree);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(join(tree, path), text);
  }
  return tree;
}

/** A rule declaration with the given identity argument and a valid definition. */
function declaration(call: string, identity: string): string {
  return `const rule = ${call}(${identity}, {\n  explanation: 'Why.',\n  headline: 'What',\n});\n`;
}

test('the rules the generator reads include every rule core declares, with the same prose', () => {
  const declared = new Map(readDeclaredRules(root).map((rule) => [rule.identity, rule]));
  for (const { explanation, headline, name } of coreRules()) {
    const rule = declared.get(`@loomcli/core/${name}`);
    expect({ explanation: rule?.explanation, headline: rule?.headline }).toEqual({
      explanation,
      headline,
    });
  }
});

test('every package that declares rules is read, under its own name', () => {
  const packages = new Set(
    readDeclaredRules(root).map((rule) => rule.identity.split('/').slice(0, 2).join('/')),
  );
  expect([...packages].toSorted()).toEqual([
    '@loomcli/core',
    '@loomcli/loom',
    '@loomcli/plugins',
    '@loomcli/prompts',
    '@loomcli/validators',
  ]);
});

test('each declaring shape gives an identity', () => {
  // The fixture is source text, and its template substitution is the one an identity may hold.
  // oxlint-disable-next-line eslint/no-template-curly-in-string
  const templated = '`${packageName}/plugin/templated`';
  const source = [
    declaration('registerRule', "'@loomcli/core/literal'"),
    declaration('diagnosticRule', templated),
    declaration('catalogRule', "'wrapped'"),
  ].join('');
  const { problems, rules } = rulesInSource(source, 'a.ts', '@acme/pack');
  expect({ identities: rules.map((rule) => rule.identity), problems }).toEqual({
    identities: ['@loomcli/core/literal', '@acme/pack/plugin/templated', '@acme/pack/wrapped'],
    problems: [],
  });
});

test('a helper definition, a comment, and a forwarding call declare nothing', () => {
  const source = [
    '/** Declares one rule through `diagnosticRule()`. */',
    '// registerRule(identity, { headline: 1 })',
    'function catalogRule(name: string, definition: Definition) {',
    // oxlint-disable-next-line eslint/no-template-curly-in-string
    '  return diagnosticRule(`@acme/pack/${name}`, definition);',
    '}',
    'export function diagnosticRule(identity: string, definition: Definition) {',
    '  return registerRule(identity, definition);',
    '}',
  ].join('\n');
  expect(rulesInSource(source, 'a.ts', '@acme/pack')).toEqual({ problems: [], rules: [] });
});

test('a declaring call the reader cannot parse is a problem naming its file and line', () => {
  const source = [
    declaration('registerRule', "'@loomcli/core/fine'"),
    declaration('registerRule', 'computedIdentity'),
    "const joined = registerRule('@loomcli/core/joined', {",
    "  explanation: 'Why.',",
    "  headline: 'Part ' + 'two',",
    '});',
    "const bare = registerRule('@loomcli/core/bare', { explanation: 'Why.' });",
  ].join('');
  const { problems } = rulesInSource(source, 'rules.ts', '@loomcli/core');
  expect(problems).toHaveLength(3);
  expect(problems.map((problem) => problem.replace(/:.*$/u, ''))).toEqual([
    'rules.ts',
    'rules.ts',
    'rules.ts',
  ]);
});

test('the reader fails, naming file and line, when a source declares a rule it cannot parse', () => {
  const tree = repository({
    'packages/acme/package.json': '{"name":"@acme/pack"}',
    'packages/acme/src/rules.ts': `${declaration('registerRule', "'@acme/pack/fine'")}\n${declaration('registerRule', 'computed')}`,
  });
  expect(() => readDeclaredRules(tree)).toThrow(/packages\/acme\/src\/rules\.ts:6: /u);
});

test('a test file and a declaration outside src are not read', () => {
  const tree = repository({
    'packages/acme/package.json': '{"name":"@acme/pack"}',
    'packages/acme/src/rules.test.ts': declaration('registerRule', 'computed'),
    'packages/acme/tests/rules.ts': declaration('registerRule', 'computed'),
  });
  expect(readDeclaredRules(tree)).toEqual([]);
});
