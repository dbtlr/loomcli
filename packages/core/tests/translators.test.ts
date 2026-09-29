import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function run(scenario: string, argv: string[] = []) {
  return invoke(new URL('fixtures/translators.mjs', import.meta.url), [scenario, ...argv]);
}

/** A run whose foreign throw one translator answered with the fixture's 69 failure. */
function translated(from: string, calls: readonly string[]) {
  return {
    status: 69,
    stderr: `Unavailable from ${from}.\n`,
    stdout: [...calls, 'resolved:69', ''].join('\n'),
  };
}

test('a foreign throw from an action exits with the translated class code and renders its view', () => {
  expect(run('action')).toEqual(translated('application', ['application:SyntaxError']));
});

test('a throw no translator answers stays an internal error with exit 1', () => {
  expect(run('untranslated')).toEqual({
    status: 1,
    stderr: 'Internal error: The value is not a function.\n',
    stdout: 'resolved:1\n',
  });
});

test('a foreign throw from a middleware before next() reaches the translator', () => {
  expect(run('middleware')).toEqual(translated('application', ['application:SyntaxError']));
});

test('a foreign throw from a configuration source reaches the translator', () => {
  expect(run('source')).toEqual(translated('application', ['application:SyntaxError']));
});

test('a translated source failure is held, so a takeover reports nothing', () => {
  expect(run('source-takeover')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'took over\napplication:SyntaxError\nresolved:0\n',
  });
});

test('a middleware that awaits next() catches the raw throw, not the translated failure', () => {
  expect(run('raw')).toEqual(
    translated('application', ['caught:SyntaxError', 'application:SyntaxError']),
  );
});

test('a throw a middleware caught is still translated once, where it leaves the chain', () => {
  expect(run('caught')).toEqual(
    translated('application', ['caught:SyntaxError', 'application:SyntaxError']),
  );
});

test.each([
  ['order-shared', 'application', ['application:SyntaxError']],
  ['order-base', 'application', ['application:SyntaxError']],
  ['order-plugins', 'first', ['first:SyntaxError']],
  ['order-derived', 'derived-two', ['derived-one:pass', 'derived-two:SyntaxError']],
  ['order-next', 'plugin', ['application:pass', 'plugin:SyntaxError']],
])('%s resolves to the translator of %s', (scenario, from, calls) => {
  expect(run(scenario)).toEqual(translated(from, calls));
});

test.each([
  ['cancelled', [], 130],
  ['cancelled-name', [], 130],
  ['closing-proxy', [], 1],
  ['cycle', [], 1],
  ['fatal', [], 1],
  ['hook', [], 1],
  ['loader', [], 1],
  ['long-chain', [], 1],
  ['null-prototype', [], 1],
  ['render', [], 1],
  ['answers', [], 1],
  ['string', [], 1],
  ['validator', ['--level', 'high'], 1],
  ['validator-output', ['--doc', '{nope'], 1],
  ['view', [], 1],
])('a throw from %s never reaches a translator', (scenario, argv, status) => {
  const result = run(scenario, argv);
  expect(result.status).toBe(status);
  expect(result.stdout).not.toContain('catch-all');
  expect(result.stderr).not.toContain('The translator');
  expect(result.stdout).toMatch(new RegExp(`resolved:${String(status)}\\n$`, 'u'));
  expect(result.stderr).not.toContain('Unavailable');
});

test('a cancelled run whose throw has an unreadable name still reports that throw', () => {
  expect(run('cancelled-name').stderr).not.toContain('The name getter failed.');
});

test('a middleware throw during unwinding stays the unwinding internal error', () => {
  expect(run('unwinding')).toEqual({
    status: 1,
    stderr: 'Internal error: The unwinding failed.\n',
    stdout: 'dispatched\nresolved:1\n',
  });
});

test.each([
  ['broken-throws', 'threw: The translator failed.'],
  ['broken-string', 'returned a string instead of a failure. Return a failure or undefined.'],
  ['broken-promise', 'returned a promise instead of a failure. Return a failure or undefined.'],
])('%s is a defect, and no later translator is called', (scenario, clause) => {
  expect(run(scenario)).toEqual({
    status: 1,
    stderr: `Internal error: The translator the Application registered for "SyntaxError" ${clause}\n`,
    stdout: 'resolved:1\n',
  });
});

test('the key name and reason of a broken translator are escaped onto one line', () => {
  expect(run('broken-escaped')).toEqual({
    status: 1,
    stderr:
      'Internal error: The translator the Application registered for "Escaped\\u202eError" threw: The translator failed\\u000d\\u000aforged\\u202eline.\n',
    stdout: 'resolved:1\n',
  });
});

test('a broken translator a plugin registered is named by its identity', () => {
  expect(run('broken-plugin')).toEqual({
    status: 1,
    stderr:
      'Internal error: The translator plugin "@fixture/broken" registered for "SyntaxError" threw: The translator failed.\n',
    stdout: 'resolved:1\n',
  });
});

test('a translator that returns an unconstructed failure meets the unconstructed-failure rule', () => {
  expect(run('broken-unconstructed')).toEqual({
    status: 1,
    stderr:
      'Internal error: A thrown value inherits from a failure class but was never constructed as one.\n',
    stdout: 'resolved:1\n',
  });
});

test('a translated failure carries the foreign throw as its cause only when the translator passes it', () => {
  expect(run('cause')).toEqual(translated('cause', ['cause:SyntaxError:Unexpected token.']));
  expect(run('no-cause')).toEqual(
    translated('application', ['application:SyntaxError', 'cause:none']),
  );
});

test('a sequence source the action let propagate reports once, as the translated failure', () => {
  const result = run('sequence');
  expect(result.status).toBe(69);
  expect(result.stdout).toBe('one\napplication:SyntaxError\nresolved:69\n');
  expect(result.stderr).toContain('Unavailable from application.\n');
  expect(result.stderr).not.toContain('Internal error');
});

test.each([
  [
    'fault-key',
    'translate() received a key that is not a class. Supply an error class, such as SyntaxError.',
  ],
  [
    'fault-translator',
    'translate() received a translator that is not a function. Supply a function that returns a failure or undefined.',
  ],
  [
    'fault-application',
    'The Application holds a translator entry that is not a translation. Supply the value returned by translate(ErrorClass, translator).',
  ],
  [
    'fault-application-list',
    'The Application holds a translator entry that is not a translation. Supply the value returned by translate(ErrorClass, translator).',
  ],
  [
    'fault-application-hole',
    'The Application holds a translator entry that is not a translation. Supply the value returned by translate(ErrorClass, translator).',
  ],
  [
    'fault-plugin',
    'Plugin "@acme/http" holds a translator entry that is not a translation. Supply the value returned by translate(ErrorClass, translator).',
  ],
  [
    'fault-plugin-hole',
    'Plugin "@acme/http" holds a translator entry that is not a translation. Supply the value returned by translate(ErrorClass, translator).',
  ],
  [
    'fault-plugin-list',
    'Plugin "@acme/http" holds a translator entry that is not a translation. Supply the value returned by translate(ErrorClass, translator).',
  ],
])('%s throws its DeclarationError', (scenario, message) => {
  expect(run(scenario)).toEqual({
    status: 0,
    stderr: '',
    stdout: `thrown:DeclarationError: ${message}\n`,
  });
});

test('translate() accepts a class whose name cannot be read', () => {
  expect(run('key-name')).toEqual({ status: 0, stderr: '', stdout: 'constructed\n' });
});

test('the failure classes an author constructs accept the platform ErrorOptions', () => {
  expect(JSON.parse(run('error-options').stdout)).toEqual({
    DeclarationError: true,
    DocumentError: true,
    FatalError: true,
    InputError: true,
    uncaused: false,
  });
});
