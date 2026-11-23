import { expect, test } from 'vite-plus/test';
/*
 * Acceptance plan for the validation lifecycle
 * (docs/core/invocation.md).
 *
 * The validation lifecycle is proven when public process fixtures establish these cases under Node
 * and Bun, alongside the existing plugin example coverage:
 *
 * - A supplied value passes its validator, which produces an observable effect. Middleware then
 *   takes over. The observed order is validation followed by takeover, and the action never runs.
 * - A required argument is omitted, so core holds an input fault. Middleware throws before calling
 *   `next()`. Only the middleware's failure determines the diagnostic and exit code, and the held
 *   input fault stays unraised.
 * - Plugin lifecycle, which the formatter plugin's hook also exercises. A fixture hook declares an
 *   option the action reads at run time and `request` carries, and the hook receives the root.
 *   `result` and `hasAction` read from a hook. Two plugins' hooks run in order, with the later
 *   replacing a view. Each hook build error.
 * - The request. `request` holds values on a valid invocation and `null` under a held fault and on
 *   a group. `view` starts at the default and is `null` on a no-result Command. The last
 *   assignment before the boundary wins across two middleware, and an assignment after the boundary
 *   changes nothing. Each `view` fault is raised at the boundary and unobserved under a takeover.
 * - Takeovers and wrappers. A takeover under a held fault and under a throwing validator exits 0
 *   with no diagnostic. An always-on wrapper ahead of help reaches help's takeover. The held fault
 *   is raised at the boundary with its code and rank, ahead of a bad `view`.
 * - Cancellation. A run cancelled inside a validator and one cancelled mid-chain resolve the
 *   signal's code.
 * - Own options. A fixture middleware reads its own global and hook-declared options from
 *   `ownOptions` under a held fault on another input, a validation problem, a validator that
 *   throws, an unknown option, and a configuration source that fails alike. It finds an option
 *   absent when its validator rejected the option's own value or when the option's own occurrence
 *   faulted.
 */

import { invoke as invokeFixture } from './run-fixture.ts';

const fixture = new URL('fixtures/plugins/request.mjs', import.meta.url);

/** One invocation of the fixture application under the plugins one scenario installs. */
async function run(scenario: string, argv: string[], env: Record<string, string> = {}) {
  return await invokeFixture(fixture, [scenario, ...argv], { env });
}

/** The diagnostic one held fault reports, under the prefix its class carries. */
function input(sentence: string) {
  return `app: ${sentence}\n`;
}

/** What a distributed build writes for a bad view assignment, which is a defect. */
const generic = 'app: Something went wrong.\n';

/** The sentence a development build's Developer Diagnostic states, between blank lines. */
function stated(sentence: string) {
  return `\n\n${sentence}\n`;
}

test('a middleware reads the parsed args, the local options, and the passthrough tokens', async () => {
  // The global `file` value is not in the request; a plugin reads its own options instead.
  const result = await run('reading', [
    'get',
    'a.b',
    '--depth',
    '3',
    '-f',
    'doc.json',
    '--',
    'x',
    'y',
  ]);
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

test('a write into a list or a schema output the request carries never reaches the action', async () => {
  const result = await run('mutating', ['edit', '--tag', 'a', '--tag', 'b', '--meta', 'kept']);
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

test('the request is null while core holds a schema fault, which the boundary raises', async () => {
  const result = await run('reading', ['get', 'a.b', '--depth', 'x']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('request:null\nfrozen:none\nview:null\nresolved:2\n');
  expect(result.stderr).toBe(input('Option "--depth": Use decimal digits.'));
});

test('the request is null while core holds a local structure fault', async () => {
  const result = await run('reading', ['get', 'a.b', '--nope']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('request:null\nfrozen:none\nview:null\nresolved:2\n');
  expect(result.stderr).toBe(
    input('Unknown option "--nope". Supply a declared option; prefix a hyphenated path with "./".'),
  );
});

test('the request is null on a group, whose missing subcommand is held too', async () => {
  const result = await run('reading', ['cache']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('request:null\nfrozen:none\nview:null\nresolved:2\n');
  expect(result.stderr).toBe(input('Command "cache" requires a subcommand. Use one of: clear.'));
});

test('a takeover under a held fault exits 0 with no diagnostic', async () => {
  await expect(run('takeover', ['get', '--help'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'help:null\nresolved:0\n',
  });
});

test('a successful validator effect precedes a takeover', async () => {
  await expect(run('effect-takeover', ['get', 'a.b', '--help'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'effects:validation,takeover\nhelp:request\nresolved:0\n',
  });
});

test('a takeover under a throwing validator exits 0 with no diagnostic', async () => {
  await expect(run('throwing-takeover', ['get', 'a.b', '--help'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'help:null\nresolved:0\n',
  });
});

test('a validator that throws with no takeover is the held fault the boundary raises', async () => {
  const result = await run('throwing-bare', ['get', 'a.b']);
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('app: Something went wrong.\n');
});

test('an always-on wrapper installed ahead of a takeover still reaches the takeover', async () => {
  await expect(run('wrapped-takeover', ['get', '--help'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'help:null\nwrapper:taken-over\nresolved:0\n',
  });
});

test('the held fault raised at the boundary keeps its exit code and its rank', async () => {
  await expect(run('bare', ['get'])).resolves.toEqual({
    status: 2,
    stderr: input('Argument "path" requires a value. Supply a value for "path".'),
    stdout: 'resolved:2\n',
  });
});

test("a group's missing subcommand is raised at the boundary when nothing takes over", async () => {
  await expect(run('bare', ['cache'])).resolves.toEqual({
    status: 2,
    stderr: input('Command "cache" requires a subcommand. Use one of: clear.'),
    stdout: 'resolved:2\n',
  });
});

test('a held fault ranks ahead of a bad view assignment', async () => {
  const result = await run('select', ['count', '--nope'], { LOOM_FIXTURE_VIEW_FIRST: 'yaml' });
  expect(result.status).toBe(2);
  expect(result.stderr).toBe(
    input('Unknown option "--nope". Supply a declared option; prefix a hyphenated path with "./".'),
  );
});

test('a run cancelled inside a validator resolves the signal code and raises no held fault', async () => {
  await expect(run('cancel-validator', ['get', 'a.b'])).resolves.toEqual({
    status: 130,
    stderr: '',
    stdout: 'resolved:130\n',
  });
});

test('a run cancelled mid-chain never reaches the boundary and raises no held fault', async () => {
  await expect(run('cancel-chain', ['get'])).resolves.toEqual({
    status: 130,
    stderr: '',
    stdout: 'resolved:130\n',
  });
});

test("view reads the declaration's default until a middleware assigns one", async () => {
  const result = await run('reading', ['count']);
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

test('view is null on a Command that declares no result', async () => {
  const result = await run('reading', ['get', 'a.b']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('view:null\n');
});

test('view reads null after an assignment on a Command that declares no result', async () => {
  const result = await run('select-read', ['get', 'a.b'], { LOOM_FIXTURE_VIEW_FIRST: 'json' });
  expect(result.stdout).toContain('view:null\n');
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(generic);
  await expect(
    run('select-read', ['get', 'a.b'], {
      FIXTURE_BUILD: 'development',
      LOOM_FIXTURE_VIEW_FIRST: 'json',
    }).then((fixtureResult) => fixtureResult.stderr),
  ).resolves.toContain(
    stated(
      'Plugin "@fixture/first" selected view "json" on Command "get", which declares no result.',
    ),
  );
});

test('the last assignment before the boundary wins across two middleware', async () => {
  const result = await run('two', ['count'], {
    LOOM_FIXTURE_VIEW_FIRST: 'wide',
    LOOM_FIXTURE_VIEW_SECOND: 'total',
  });
  expect(result).toEqual({ status: 0, stderr: '', stdout: '2 rows\nresolved:0\n' });
});

test('an assignment after the boundary changes nothing', async () => {
  const result = await run('late', ['count'], { LOOM_FIXTURE_VIEW_LATE: 'total' });
  expect(result).toEqual({
    status: 0,
    stderr: '',
    stdout: 'PATHS\n0: one.txt\n1: two words.txt\nEND\nresolved:0\n',
  });
});

test('a view name the record does not hold is a defect under the view selection rule naming the plugin', async () => {
  const result = await run('select', ['count'], { LOOM_FIXTURE_VIEW_FIRST: 'yaml' });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(generic);
  const { stderr } = await run('select', ['count'], {
    FIXTURE_BUILD: 'development',
    LOOM_FIXTURE_VIEW_FIRST: 'yaml',
  });
  expect(stderr).toMatch(/^-- INVALID VIEW SELECTION -+ @loomcli\/core\/view-selection\n/u);
  expect(stderr).toContain(
    stated('Plugin "@fixture/first" selected view "yaml", which Command "count" does not name.'),
  );
});

test('a selection on a Command that declares no result is an internal error naming the plugin', async () => {
  const result = await run('select', ['get', 'a.b'], { LOOM_FIXTURE_VIEW_FIRST: 'json' });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(generic);
  await expect(
    run('select', ['get', 'a.b'], {
      FIXTURE_BUILD: 'development',
      LOOM_FIXTURE_VIEW_FIRST: 'json',
    }).then((fixtureResult) => fixtureResult.stderr),
  ).resolves.toContain(
    stated(
      'Plugin "@fixture/first" selected view "json" on Command "get", which declares no result.',
    ),
  );
});

test('a bad view assignment stays unobserved under a takeover', async () => {
  await expect(
    run('select-takeover', ['get', '--help'], { LOOM_FIXTURE_VIEW_FIRST: 'json' }),
  ).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'help:null\nresolved:0\n',
  });
});

test('out.results renders the whole view a middleware selected', async () => {
  await expect(run('select', ['count'], { LOOM_FIXTURE_VIEW_FIRST: 'total' })).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '2 rows\nresolved:0\n',
  });
});

test('out.results renders the row view a middleware selected', async () => {
  await expect(run('select', ['count'], { LOOM_FIXTURE_VIEW_FIRST: 'wide' })).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '[one.txt]\n[two words.txt]\nresolved:0\n',
  });
});
