import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** Every plugin build rule answers in `inspect()` and in `run()` alike, and `run()` returns 1. */
function build(scenario: string, mode: 'inspect' | 'run') {
  return invoke(new URL('fixtures/plugins/build.mjs', import.meta.url), [scenario, mode]);
}

/** Every row of the plugin build errors, less the two the signals slot owns. */
const rejected = [
  [
    'not-a-plugin',
    'The Application holds a value that is not a plugin. Supply the value returned by plugin(identity, definition).',
  ],
  [
    'installed-twice',
    'The Application installs plugin "@loomcli/help" twice. Install each plugin once.',
  ],
  [
    'empty-identity',
    'A plugin declares an empty identity. Supply a nonempty string, such as the package name.',
  ],
  [
    'identity-not-string',
    'A plugin declares an identity that is not a string. Supply a nonempty string, such as the package name.',
  ],
  [
    'plugins-not-array',
    'The Application plugins must be an array. Supply a list of plugin values.',
  ],
  [
    'definition-not-object',
    'Plugin "@loomcli/help" declares a definition that is not an object. Supply { options, middleware, extensions, failures }.',
  ],
  [
    'options-not-object',
    'Plugin "@loomcli/log" declares options that are not an object. Supply a record of option declarations.',
  ],
  [
    'option-not-declaration',
    'Plugin "@loomcli/log" option "level" is not an option declaration. Supply { type, ... }.',
  ],
  [
    'failures-not-array',
    'Plugin "@loomcli/help" declares failures that are not an array. Supply a list of renderFailure values.',
  ],
  [
    'extensions-not-array',
    'Plugin "@loomcli/help" declares extensions that are not an array. Supply a list of extension descriptors.',
  ],
  [
    'option-validate',
    'Plugin "@loomcli/log" option "level" declares validate. Remove it; a plugin option carries no schema or presence rule, and the middleware interprets the value.',
  ],
  [
    'option-validate-omitted',
    'Plugin "@loomcli/log" option "level" declares validateOmitted. Remove it; a plugin option carries no schema or presence rule, and the middleware interprets the value.',
  ],
  [
    'option-required',
    'Plugin "@loomcli/log" option "level" declares required. Remove it; a plugin option carries no schema or presence rule, and the middleware interprets the value.',
  ],
  [
    'option-global-key',
    'Option "help" is declared by plugin "@loomcli/help" and as a global option. Rename one declaration.',
  ],
  [
    'local-key',
    'Option "help" is declared by plugin "@loomcli/help" and as a local option on Command "get". Rename the local option.',
  ],
  [
    'two-plugin-keys',
    'Option "verbose" is declared by plugin "@loomcli/log" and plugin "@acme/trace". Install one of them or rename the option.',
  ],
  [
    'option-spelling',
    'Option spelling "-h" is used by plugin "@loomcli/help" option "help" and the global option "host". Change one declaration.',
  ],
  [
    'middleware-not-object',
    'Plugin "@loomcli/help" declares middleware that is not an object. Supply { activate, load }.',
  ],
  [
    'no-activation',
    `Plugin "@loomcli/help" declares middleware with no activation. Supply activate: 'always' or a list of the plugin's own option names.`,
  ],
  [
    'empty-activation',
    `Plugin "@loomcli/help" declares middleware with an empty activation list. Name at least one of the plugin's options or use 'always'.`,
  ],
  [
    'activation-undeclared',
    `Plugin "@loomcli/help" activates middleware on option "hlep", which it does not declare. Name one of the plugin's own options.`,
  ],
  [
    'no-loader',
    `Plugin "@loomcli/help" declares middleware with no load function. Supply load: () => import('./middleware.js').`,
  ],
  [
    'option-boolean-default',
    'Plugin "@loomcli/log" option "level" is Boolean. Remove validate, default, required, and validateOmitted; use polarity to control its absent value.',
  ],
  [
    'option-raw-default',
    'Plugin "@loomcli/log" option "level" default must be a string without a schema. Supply a string default.',
  ],
  [
    'not-an-extension',
    'Command "get" holds a value that is not an extension value. Supply the value returned by calling an extension.',
  ],
  [
    'root-extensions',
    'The root Command holds a value that is not an extension value. Supply the value returned by calling an extension.',
  ],
  [
    'not-a-descriptor',
    'Plugin "@loomcli/help" holds a value that is not an extension. Supply the value returned by extension(identity, config).',
  ],
  [
    'no-schema',
    'The root Command holds extension "@fixture/bare", which declares no schema. Supply a Standard Schema v1 object that answers synchronously.',
  ],
  [
    'wrong-target',
    'Command "get" holds extension "@fixture/facts/option", which applies to options. Supply an extension that applies to Commands.',
  ],
  [
    'twice-on-one',
    'Command "get" holds extension "@fixture/facts/command" twice. Supply one value.',
  ],
  [
    'twin-descriptors',
    'Extension "@fixture/facts/command" is defined twice. Install one copy of the package that defines it.',
  ],
  [
    'invalid-value',
    'Command "get" holds an invalid "@fixture/facts/command" value: Invalid input: expected string, received number. Correct the value.',
  ],
  [
    'async-schema',
    'Extension "@fixture/async" validates asynchronously. Supply a schema that answers synchronously.',
  ],
  [
    'exotic-output',
    'Extension "@fixture/exotic" produced a value that is not plain data on Command "get". Return strings, numbers, booleans, null, arrays, and plain objects.',
  ],
  [
    'schema-throws',
    'The root Command holds an invalid "@fixture/schema/throws" value: the schema threw. Correct the value.',
  ],
  [
    'schema-silent',
    'The root Command holds an invalid "@fixture/schema/silent" value: The schema rejected this value without an explanation. Correct the value.',
  ],
  [
    'schema-thenable',
    'Extension "@fixture/schema/thenable" validates asynchronously. Supply a schema that answers synchronously.',
  ],
  [
    'output-symbol',
    'Extension "@fixture/output/symbol" produced a value that is not plain data on the root Command. Return strings, numbers, booleans, null, arrays, and plain objects.',
  ],
  [
    'output-accessor',
    'Extension "@fixture/output/accessor" produced a value that is not plain data on the root Command. Return strings, numbers, booleans, null, arrays, and plain objects.',
  ],
  [
    'output-hidden',
    'Extension "@fixture/output/hidden" produced a value that is not plain data on the root Command. Return strings, numbers, booleans, null, arrays, and plain objects.',
  ],
  [
    'output-nan',
    'Extension "@fixture/output/nan" produced a value that is not plain data on the root Command. Return strings, numbers, booleans, null, arrays, and plain objects.',
  ],
  [
    'output-infinite',
    'Extension "@fixture/output/infinite" produced a value that is not plain data on the root Command. Return strings, numbers, booleans, null, arrays, and plain objects.',
  ],
  [
    'output-sparse',
    'Extension "@fixture/output/sparse" produced a value that is not plain data on the root Command. Return strings, numbers, booleans, null, arrays, and plain objects.',
  ],
  [
    'output-cycle',
    'Extension "@fixture/output/cycle" produced a value that is not plain data on the root Command. Return strings, numbers, booleans, null, arrays, and plain objects.',
  ],
  [
    'plugin-renderers',
    'Plugin "@loomcli/help" registers two failure renderers for "InputError". Remove one registration.',
  ],
] satisfies [string, string][];

test.each(rejected)('inspect() and run() reject the %s declaration alike', (scenario, message) => {
  expect(build(scenario, 'inspect')).toEqual({
    status: 0,
    stderr: '',
    stdout: `declaration:1: ${message}\n`,
  });
  expect(build(scenario, 'run')).toEqual({
    status: 1,
    stderr: `Invalid declaration: ${message}\n`,
    stdout: 'resolved:1\n',
  });
});

/** The same graph under the renderers one scenario's contributors registered. */
function rendered(scenario: string, argv: string[], env: Record<string, string> = {}) {
  return invoke(
    new URL('fixtures/plugins/invoke.mjs', import.meta.url),
    [scenario, 'run', ...argv],
    { env },
  );
}

test("a plugin's failure renderers answer the classes the application leaves to them", () => {
  expect(rendered('failures', ['get'])).toEqual({
    status: 2,
    stderr: 'plugin input: Argument "path" requires a value. Supply a value for "path".\n',
    stdout: 'resolved:2\n',
  });
  expect(rendered('failures', ['get', 'a.b'], { LOOM_FIXTURE_ACTION: 'fatal' })).toEqual({
    status: 1,
    stderr: 'plugin fatal: the action stopped the invocation\n',
    stdout: 'resolved:1\n',
  });
});

test('one class registered by the application and by a plugin resolves first-in-wins', () => {
  expect(rendered('failures-both', ['get'])).toEqual({
    status: 2,
    stderr: 'app input: Argument "path" requires a value. Supply a value for "path".\n',
    stdout: 'resolved:2\n',
  });
  // The plugin still answers the class the application left to it.
  expect(rendered('failures-both', ['get', 'a.b'], { LOOM_FIXTURE_ACTION: 'fatal' })).toEqual({
    status: 1,
    stderr: 'plugin fatal: the action stopped the invocation\n',
    stdout: 'resolved:1\n',
  });
});

test('a plugin that declares nothing installs and costs the invocation nothing', () => {
  expect(build('installed', 'inspect')).toEqual({ status: 0, stderr: '', stdout: 'inspected\n' });
  expect(build('installed', 'run')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'dispatched\nresolved:0\n',
  });
});
