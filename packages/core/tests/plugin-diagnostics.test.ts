import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { declaredRules, coreRuleParts } from './rule-parts.js';
import type { RuleParts } from './rule-parts.js';

const fixture = new URL('fixtures/plugin-diagnostics.mjs', import.meta.url);

/** The diagnostic one scenario's faulty declaration throws, as its message holds it. */
function thrown(scenario: string): string {
  const result = invoke(fixture, [scenario]);
  expect(result.stderr).toBe('');
  return result.stdout;
}

/** Each scenario's fault by the parts its rule's test pins; the layout goldens pin the rest. */
const cases: Record<string, RuleParts> = {
  'encoder-taken': {
    correction: 'Register one.',
    rule: 'failure-encoder-taken',
    sentence: 'Plugin "@acme/json" registers two failure encoders for "application/json".',
  },
  'encoder-taken-across': {
    correction: 'Install one of them.',
    rule: 'failure-encoder-taken',
    sentence:
      'Plugin "@acme/wire" registers a failure encoder for "application/json", which plugin "@acme/json" already registers.',
  },
  // A failure encoding another installed copy of core built misses this copy's registry as this value does.
  'encoding-entry': {
    correction:
      'Install one copy of @loomcli/core, so the Application and every plugin package share it.',
    rule: 'foreign-value',
    sentence:
      'Plugin "@acme/json" holds a failure encoding another installed copy of @loomcli/core built.',
  },
  'extension-async': {
    correction: 'Supply a schema that answers synchronously.',
    rule: 'invalid-extension-value',
    sentence:
      'Command "get" holds a "@acme/slow/command" value its schema did not answer synchronously.',
  },
  'extension-defined-twice': {
    correction: 'Install one copy of the package that defines it.',
    rule: 'two-package-copies',
    sentence: 'Extension "@acme/notes/command" is defined twice.',
  },
  // An extension value another installed copy of core built misses this copy's registry as this value does.
  'extension-entry': {
    correction:
      'Install one copy of @loomcli/core, so the Application and every plugin package share it.',
    rule: 'foreign-value',
    sentence:
      'Command "count" holds an extension value another installed copy of @loomcli/core built.',
  },
  'extension-foreign-read': {
    correction: 'Install one copy of the package that defines it.',
    rule: 'two-package-copies',
    sentence:
      'Extension "@acme/notes/command" was read through a descriptor that did not define the stored value.',
  },
  'extension-invalid': {
    correction: 'Correct the value.',
    rule: 'invalid-extension-value',
    sentence: 'Command "get" holds an invalid "@acme/limit/command" value: Expected a number.',
  },
  'extension-output': {
    correction: 'Return strings, numbers, booleans, null, arrays, and plain objects.',
    rule: 'extension-output',
    sentence:
      'Extension "@acme/date/option" produced a value that is not plain data on Command "get" option "raw".',
  },
  'extension-throws': {
    correction: 'Correct the value.',
    rule: 'invalid-extension-value',
    sentence: String.raw`Global option "file" holds an invalid "@acme/strict/option" value: Bad\u000avalue.`,
  },
  'failure-code': {
    correction:
      'Declare a kebab-case code of lowercase letters and digits, such as "registry-down".',
    rule: 'failure-code',
    sentence: 'Failure class "RegistryDownError" declares failure code "Registry_Down".',
  },

  'hook-alias-spelling': {
    correction: 'Change one of the two spellings or omit the plugin.',
    rule: 'spelling-taken',
    sentence:
      'Plugin "@acme/format" declares option "shape" with spelling "--file" on Command "count", which "--file" already uses.',
  },
  'hook-collision': {
    correction: "Rename the Command's option or omit the plugin.",
    rule: 'option-declared-twice',
    sentence:
      'Plugin "@acme/format" declares option "format" on Command "count", which is already declared as a local option.',
  },
  'hook-spelling': {
    correction: 'Change one of the two spellings or omit the plugin.',
    rule: 'spelling-taken',
    sentence:
      'Plugin "@acme/format" declares option "shape" with spelling "-f" on Command "count", which "--file" already uses.',
  },
  // A plugin another installed copy of core built misses this copy's registry as this value does.
  'plugin-entry': {
    correction:
      'Install one copy of @loomcli/core, so the Application and every plugin package share it.',
    rule: 'foreign-value',
    sentence: 'The Application holds a plugin another installed copy of @loomcli/core built.',
  },
  'plugin-twice': {
    correction: 'Install each plugin once.',
    rule: 'plugin-installed-twice',
    sentence: 'The Application installs plugin "@acme/log" twice.',
  },
  'rule-identity': {
    correction:
      'Name it <package>[/<subpath>...]/<kebab-case-rule>, such as "@acme/retry/retry-limit".',
    rule: 'rule-identity',
    sentence:
      'Diagnostic rule "Retry Limit" has no package part, or a subpath or rule name that is not kebab-case.',
  },
  'signals-slot': {
    correction: 'Install one owner.',
    rule: 'slot-taken',
    sentence:
      'Plugin "@acme/trace" claims the signals slot, which plugin "@acme/signals" already holds.',
  },
  'theme-slot': {
    correction: 'Install one owner.',
    rule: 'slot-taken',
    sentence:
      'Plugin "@acme/slate" claims the theme slot, which plugin "@acme/copper" already holds.',
  },
  // A translation another installed copy of core built misses this copy's registry as this value does.
  'translation-entry': {
    correction:
      'Install one copy of @loomcli/core, so the Application and every plugin package share it.',
    rule: 'foreign-value',
    sentence:
      'Plugin "@acme/http" holds a translation another installed copy of @loomcli/core built.',
  },
  'view-copies': {
    correction: 'Install one copy of the package that declares it.',
    rule: 'two-package-copies',
    sentence: 'View "@acme/page" is declared by two distinct objects.',
  },
  // A declared view another installed copy of core built misses this copy's registry as this value does.
  'view-entry': {
    correction:
      'Install one copy of @loomcli/core, so the Application and every plugin package share it.',
    rule: 'foreign-value',
    sentence:
      'Plugin "@acme/brand" holds a view or override another installed copy of @loomcli/core built.',
  },
};

test.each(Object.entries(cases))('the %s fault throws its rule’s diagnostic', (scenario, parts) => {
  expect(coreRuleParts(thrown(scenario))).toEqual(parts);
});

/** The rules core declares beside its defects that this family raises. */
const fromCore = ['failure-code', 'rule-identity'];

/** The rules of the input family this family raises too, which a hook's declarations collide on. */
const fromInputs = ['option-declared-twice', 'spelling-taken'];

test('every rule of the family has a pinned diagnostic', () => {
  const pinned = new Set(Object.values(cases).map((parts) => parts.rule));
  expect(declaredRules('rules.ts')).toEqual(expect.arrayContaining(fromCore));
  expect([...declaredRules('plugin-rules.ts'), ...fromCore, ...fromInputs].toSorted()).toEqual(
    [...pinned].toSorted(),
  );
});
