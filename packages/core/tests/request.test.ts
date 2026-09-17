import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/plugins/request.mjs', import.meta.url);

/** One invocation of the fixture application under the plugins one scenario installs. */
function run(scenario: string, argv: string[], env: Record<string, string> = {}) {
  return invoke(fixture, [scenario, ...argv], { env });
}

/** The diagnostic one held fault reports, under the prefix its class carries. */
function input(sentence: string) {
  return `Invalid input: ${sentence}\n`;
}

/** The diagnostic one bad view assignment reports, under the prefix its class carries. */
function internal(sentence: string) {
  return `Internal error: ${sentence}\n`;
}

test('a middleware reads the parsed args, the local options, and the passthrough tokens', () => {
  // The global `file` value is not in the request; a plugin reads its own options instead.
  const result = run('reading', ['get', 'a.b', '--depth', '3', '-f', 'doc.json', '--', 'x', 'y']);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    [
      'request:{"args":{"path":"a.b"},"options":{"depth":3,"raw":false},"passthrough":["x","y"]}',
      'frozen:true',
      'view:null',
      'get:{"args":{"path":"a.b"},"options":{"file":"doc.json","depth":3,"raw":false},"passthrough":["x","y"]}',
      'resolved:0',
      '',
    ].join('\n'),
  );
});

test('a write into a list or a schema output the request carries never reaches the action', () => {
  const result = run('mutating', ['edit', '--tag', 'a', '--tag', 'b', '--meta', 'kept']);
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe(
    [
      'writes:{"assign":"threw","meta":"threw","tag":"threw"}',
      'edit:{"frozen":false,"options":{"tag":["a","b"],"meta":{"note":"kept"}}}',
      'resolved:0',
      '',
    ].join('\n'),
  );
});

test('the request is null while core holds a schema fault, which the boundary raises', () => {
  const result = run('reading', ['get', 'a.b', '--depth', 'x']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('request:null\nfrozen:none\nview:null\nresolved:2\n');
  expect(result.stderr).toBe(input('Option "--depth": Use decimal digits.'));
});

test('the request is null while core holds a local structure fault', () => {
  const result = run('reading', ['get', 'a.b', '--nope']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('request:null\nfrozen:none\nview:null\nresolved:2\n');
  expect(result.stderr).toBe(
    input('Unknown option "--nope". Supply a declared option; prefix a hyphenated path with "./".'),
  );
});

test('the request is null on a group, whose missing subcommand is held too', () => {
  const result = run('reading', ['cache']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('request:null\nfrozen:none\nview:null\nresolved:2\n');
  expect(result.stderr).toBe(input('Command "cache" requires a subcommand. Use one of: clear.'));
});

test('a takeover under a held fault exits 0 with no diagnostic', () => {
  expect(run('takeover', ['get', '--help'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'help:null\nresolved:0\n',
  });
});

test('a takeover under a throwing validator exits 0 with no diagnostic', () => {
  expect(run('throwing-takeover', ['get', 'a.b', '--help'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'help:null\nresolved:0\n',
  });
});

test('a validator that throws with no takeover is the held fault the boundary raises', () => {
  const result = run('throwing-bare', ['get', 'a.b']);
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    'Invalid declaration: Argument "path" validator failed unexpectedly: the validator broke Fix the validator.\n',
  );
});

test('an always-on wrapper installed ahead of a takeover still reaches the takeover', () => {
  expect(run('wrapped-takeover', ['get', '--help'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'help:null\nwrapper:taken-over\nresolved:0\n',
  });
});

test('the held fault raised at the boundary keeps its exit code and its rank', () => {
  expect(run('bare', ['get'])).toEqual({
    status: 2,
    stderr: input('Argument "path" requires a value. Supply a value for "path".'),
    stdout: 'resolved:2\n',
  });
});

test("a group's missing subcommand is raised at the boundary when nothing takes over", () => {
  expect(run('bare', ['cache'])).toEqual({
    status: 2,
    stderr: input('Command "cache" requires a subcommand. Use one of: clear.'),
    stdout: 'resolved:2\n',
  });
});

test('a held fault ranks ahead of a bad view assignment', () => {
  const result = run('select', ['count', '--nope'], { LOOM_FIXTURE_VIEW_FIRST: 'yaml' });
  expect(result.status).toBe(2);
  expect(result.stderr).toBe(
    input('Unknown option "--nope". Supply a declared option; prefix a hyphenated path with "./".'),
  );
});

test('a run cancelled inside a validator resolves the signal code and raises no held fault', () => {
  expect(run('cancel-validator', ['get', 'a.b'])).toEqual({
    status: 130,
    stderr: '',
    stdout: 'resolved:130\n',
  });
});

test('a run cancelled mid-chain never reaches the boundary and raises no held fault', () => {
  expect(run('cancel-chain', ['get'])).toEqual({
    status: 130,
    stderr: '',
    stdout: 'resolved:130\n',
  });
});

test("view reads the declaration's default until a middleware assigns one", () => {
  const result = run('reading', ['count']);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    [
      'request:{"args":{},"options":{},"passthrough":[]}',
      'frozen:true',
      'view:list',
      'PATHS',
      '0: one.txt',
      '1: two words.txt',
      'END',
      'resolved:0',
      '',
    ].join('\n'),
  );
});

test('view is null on a Command that declares no result', () => {
  const result = run('reading', ['get', 'a.b']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('view:null\n');
});

test('view reads null after an assignment on a Command that declares no result', () => {
  const result = run('select-read', ['get', 'a.b'], { LOOM_FIXTURE_VIEW_FIRST: 'json' });
  expect(result.stdout).toContain('view:null\n');
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    internal(
      'Plugin "@fixture/first" selected view "json" on Command "get", which declares no result.',
    ),
  );
});

test('the last assignment before the boundary wins across two middleware', () => {
  const result = run('two', ['count'], {
    LOOM_FIXTURE_VIEW_FIRST: 'wide',
    LOOM_FIXTURE_VIEW_SECOND: 'total',
  });
  expect(result).toEqual({ status: 0, stderr: '', stdout: '2 rows\nresolved:0\n' });
});

test('an assignment after the boundary changes nothing', () => {
  const result = run('late', ['count'], { LOOM_FIXTURE_VIEW_LATE: 'total' });
  expect(result).toEqual({
    status: 0,
    stderr: '',
    stdout: 'PATHS\n0: one.txt\n1: two words.txt\nEND\nresolved:0\n',
  });
});

test('a view name the record does not hold is an internal error naming the plugin', () => {
  const result = run('select', ['count'], { LOOM_FIXTURE_VIEW_FIRST: 'yaml' });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    internal('Plugin "@fixture/first" selected view "yaml", which Command "count" does not name.'),
  );
});

test('a selection that is not a string is an internal error naming the plugin', () => {
  const result = run('select', ['count'], { LOOM_FIXTURE_VIEW_FIRST: 'not-a-string' });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    internal('Plugin "@fixture/first" selected a view that is not a string on Command "count".'),
  );
});

test('a selection on a Command that declares no result is an internal error naming the plugin', () => {
  const result = run('select', ['get', 'a.b'], { LOOM_FIXTURE_VIEW_FIRST: 'json' });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    internal(
      'Plugin "@fixture/first" selected view "json" on Command "get", which declares no result.',
    ),
  );
});

test('the no-result sentence wins when the selection is not a string either', () => {
  const result = run('select', ['get', 'a.b'], { LOOM_FIXTURE_VIEW_FIRST: 'not-a-string' });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    internal(
      'Plugin "@fixture/first" selected view "7" on Command "get", which declares no result.',
    ),
  );
});

test('a bad view assignment stays unobserved under a takeover', () => {
  expect(run('select-takeover', ['get', '--help'], { LOOM_FIXTURE_VIEW_FIRST: 'json' })).toEqual({
    status: 0,
    stderr: '',
    stdout: 'help:null\nresolved:0\n',
  });
});

test('out.results renders the whole view a middleware selected', () => {
  expect(run('select', ['count'], { LOOM_FIXTURE_VIEW_FIRST: 'total' })).toEqual({
    status: 0,
    stderr: '',
    stdout: '2 rows\nresolved:0\n',
  });
});

test('out.results renders the row view a middleware selected', () => {
  expect(run('select', ['count'], { LOOM_FIXTURE_VIEW_FIRST: 'wide' })).toEqual({
    status: 0,
    stderr: '',
    stdout: '[one.txt]\n[two words.txt]\nresolved:0\n',
  });
});
