import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';

import plugin from '../src/index.js';

const ruleNames = [
  'discarded-declaration',
  'host-bypass',
  'name-shape',
  'strict-configuration-schema',
  'undescribed',
  'unrooted-configuration',
];

/** Every rule at `error`, except the one that is advice, at `warn`. */
const severities = Object.fromEntries(
  ruleNames.map((name) => [
    `@loomcli/${name}`,
    name === 'unrooted-configuration' ? 'warn' : 'error',
  ]),
);

test('the plugin ships exactly the six rules', () => {
  expect(Object.keys(plugin.rules).toSorted()).toEqual(ruleNames);
});

test('every rule documents itself with a description and a link into the reference page', () => {
  for (const [name, rule] of Object.entries(plugin.rules)) {
    expect(rule.meta?.docs?.description).toBeTruthy();
    expect(rule.meta?.docs?.url).toBe(
      `https://github.com/dbtlr/loomcli/blob/main/docs/libs/eslint-plugin.md#${name}`,
    );
    expect(Object.keys(rule.meta?.messages ?? {})).not.toEqual([]);
  }
});

test('the plugin names itself and carries the version of its manifest', () => {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  expect(manifest).toMatchObject({ name: '@loomcli/eslint-plugin' });
  expect(plugin.meta).toEqual({ name: '@loomcli/eslint-plugin', version: expect.any(String) });
  expect(manifest).toMatchObject({ version: plugin.meta.version });
});

test('the recommended config registers the plugin under @loomcli and turns five rules on at error and unrooted-configuration at warn', () => {
  const { recommended } = plugin.configs;
  expect(Object.keys(recommended.plugins)).toEqual(['@loomcli']);
  expect(recommended.plugins['@loomcli'].rules).toBe(plugin.rules);
  expect(recommended.rules).toEqual(severities);
});

test('the oxlint config loads the plugin by its package name and turns five rules on at error and unrooted-configuration at warn', () => {
  const { oxlint } = plugin.configs;
  expect(oxlint.jsPlugins).toEqual(['@loomcli/eslint-plugin']);
  expect(oxlint.rules).toEqual(severities);
});

test('the oxlint config is the JSON an .oxlintrc.json holds as it is', () => {
  expect(JSON.stringify(plugin.configs.oxlint, null, 2)).toBe(
    [
      '{',
      '  "jsPlugins": [',
      '    "@loomcli/eslint-plugin"',
      '  ],',
      '  "rules": {',
      '    "@loomcli/discarded-declaration": "error",',
      '    "@loomcli/host-bypass": "error",',
      '    "@loomcli/name-shape": "error",',
      '    "@loomcli/strict-configuration-schema": "error",',
      '    "@loomcli/undescribed": "error",',
      '    "@loomcli/unrooted-configuration": "warn"',
      '  }',
      '}',
    ].join('\n'),
  );
});
