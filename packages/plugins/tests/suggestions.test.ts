/*
 * Acceptance plan for the suggestions plugin (docs/plugins/suggestions.md).
 *
 * An application that installs `suggestions()` can drop its own `unknownCommand` and
 * `inputProblems` overrides, because core's default text names the application under Failure
 * classes (docs/core/failures.md#failure-classes). Where help's hint and another plugin's hint
 * both apply, help's prints first, because `help()` is installed first.
 *
 * The acceptance tests cover, through public APIs with fixture applications and fixture plugins:
 *
 * - the distance of each edit kind, an insertion, a deletion, a substitution, and an adjacent
 *   transposition, and that a non-adjacent transposition costs 2;
 * - the budget at 4, 5, 8, and 9 code points, with a token one edit past its budget matching
 *   nothing;
 * - a token of one code point after the hyphens are removed matching nothing;
 * - NFC normalization and lowercasing, with a token that differs only in case matching at distance
 *   0;
 * - code points counted rather than code units, with a candidate that holds no astral character
 *   beside a token that does;
 * - leading hyphens left out for an option, with `---format` treated as `format`;
 * - ranking by distance then graph order, with two candidates at one distance printed in authoring
 *   order;
 * - the cap of three with four matches;
 * - a negative spelling suggested for its own typo and never for the positive spelling's, a
 *   positive spelling never suggested for the negative spelling's, and both suggested for a typo as
 *   near to each;
 * - a counted option and an implied-value option suggested by their long spelling alone, the
 *   implied-value option's typo bare and with an attached value;
 * - a plugin's option suggested;
 * - under `invoke()`, an unknown option suggested by its declared name, not by its spelling;
 * - a hidden child, a deprecated child, a hidden option, a deprecated option, and an alias never
 *   suggested, each with the typo one edit from the excluded name;
 * - the plugin's hook adding no hint line, so a second plugin's hint is the only line under the
 *   plugin's sentence;
 * - the view's bytes equal to core's default text, hints included, when nothing matches;
 * - the escaped token in the sentence for a token that holds a control character or a bidirectional
 *   control;
 * - hints printed under the plugin's sentence in installation order;
 * - an application override of `UnknownCommandError` winning over the plugin's, and an
 *   earlier-installed plugin's override winning too;
 * - a later-installed plugin's override losing;
 * - the plugin installed before `help()` changing neither the help takeover nor the hint order of
 *   the other plugins;
 * - help's hint on each `UsageError` class, an `InputError` an action throws included, with the
 *   command line of the root, of a group, and of a nested Command;
 * - help's hint absent on a `FatalError`, an `InternalError`, and a `DeclarationError` a run
 *   reports.
 *
 * Each case runs under Node and Bun. A consumer installs the packed pack, imports
 * `@loomcli/plugins/suggestions`, compiles against its declaration, and prints a suggestion.
 */

import { describe, expect, it } from 'vite-plus/test';

import { runShared } from './fixtures/suggestions-shared.ts';
import { invokeScenario, runScenario } from './fixtures/suggestions.ts';
import type { Scenario } from './fixtures/suggestions.ts';

/** One run of a fixture scenario. */
function run(scenario: Scenario, argv: string[]) {
  return runScenario(scenario, argv);
}

/** What one run writes to stderr. */
async function written(scenario: Scenario, argv: string[]) {
  const { stderr } = await run(scenario, argv);
  return stderr;
}

/** The diagnostic the fixture application writes with the suggestions plugin alone installed. */
async function suggested(argv: string[]) {
  return written('plain', argv);
}

/** A near-match sentence, the one line the plugin writes when no other plugin adds a hint. */
function command(token: string, fix: string) {
  return `kit: Unknown command "${token}". ${fix}\n`;
}

function option(spelling: string, fix: string) {
  return `kit: Unknown option "${spelling}". ${fix}\n`;
}

/** How one run ended, as a test compares it. */
async function outcome(scenario: Scenario, argv: string[]) {
  const { status, stderr } = await run(scenario, argv);
  return { status, stderr };
}

/**
 * One invocation under the plugin and under a baseline without it, so a test reads that the plugin
 * wrote the baseline's bytes and code. A baseline that succeeds compares nothing, so it throws.
 */
async function unchanged(
  argv: string[],
  scenario: Scenario = 'plain',
  baseline: Scenario = 'core',
) {
  const core = await outcome(baseline, argv);
  if (core.status === 0) {
    throw new Error(`The baseline run of ${argv.join(' ')} succeeded.`);
  }
  return { core, plugin: await outcome(scenario, argv) };
}

describe('the matcher', () => {
  it('an insertion, a deletion, a substitution, and an adjacent transposition each cost 1', async () => {
    await expect(suggested(['edits', 'gt'])).resolves.toBe(command('gt', 'Did you mean "get"?'));
    await expect(suggested(['edits', 'gett'])).resolves.toBe(
      command('gett', 'Did you mean "get"?'),
    );
    await expect(suggested(['edits', 'gat'])).resolves.toBe(command('gat', 'Did you mean "get"?'));
    await expect(suggested(['edits', 'gte'])).resolves.toBe(command('gte', 'Did you mean "get"?'));
  });

  it('the failure exits with the usage code', async () => {
    const { status } = await run('plain', ['edits', 'gte']);
    expect(status).toBe(2);
  });

  it('a non-adjacent transposition costs 2, past the budget of a 4-code-point token', async () => {
    const { core, plugin } = await unchanged(['edits', 'nale']);
    expect(plugin).toEqual(core);
  });

  it('a token of up to 4 code points allows 1 edit', async () => {
    await expect(suggested(['budget', 'fuor'])).resolves.toBe(
      command('fuor', 'Did you mean "four"?'),
    );
    const { core, plugin } = await unchanged(['budget', 'fxxr']);
    expect(plugin).toEqual(core);
  });

  it('a token of 5 code points allows 2 edits', async () => {
    await expect(suggested(['budget', 'fivxx'])).resolves.toBe(
      command('fivxx', 'Did you mean "fives"?'),
    );
    const { core, plugin } = await unchanged(['budget', 'fxxxs']);
    expect(plugin).toEqual(core);
  });

  it('a token of 8 code points allows 2 edits', async () => {
    await expect(suggested(['budget', 'seasxxed'])).resolves.toBe(
      command('seasxxed', 'Did you mean "seasoned"?'),
    );
    const { core, plugin } = await unchanged(['budget', 'sxasxxed']);
    expect(plugin).toEqual(core);
  });

  it('a token longer than 8 code points allows 3 edits', async () => {
    await expect(suggested(['budget', 'ovxxxight'])).resolves.toBe(
      command('ovxxxight', 'Did you mean "overnight"?'),
    );
    const { core, plugin } = await unchanged(['budget', 'oxxxxight']);
    expect(plugin).toEqual(core);
  });

  it('a token of one code point matches nothing', async () => {
    const { core, plugin } = await unchanged(['opts', '--x']);
    expect(plugin).toEqual(core);
  });

  it('a token that differs only in case matches at distance 0, and a match prints as declared', async () => {
    await expect(suggested(['edits', 'GET'])).resolves.toBe(command('GET', 'Did you mean "get"?'));
    await expect(suggested(['edits', 'build'])).resolves.toBe(
      command('build', 'Did you mean "Build"?'),
    );
  });

  it('the token is normalized to NFC before the comparison', async () => {
    const decomposed = `--${`e\u0301`.repeat(3)}`;
    await expect(suggested(['opts', decomposed])).resolves.toBe(
      option(decomposed, 'Did you mean "--ééé"?'),
    );
  });

  it('lengths and distances count code points, not code units', async () => {
    await expect(suggested(['edits', 'ge😀'])).resolves.toBe(
      command('ge😀', 'Did you mean "get"?'),
    );
  });

  it('leading hyphens are left out of an option comparison', async () => {
    await expect(suggested(['opts', '--fields'])).resolves.toBe(
      option('--fields', 'Did you mean "--field"?'),
    );
    await expect(suggested(['opts', '---field'])).resolves.toBe(
      option('---field', 'Did you mean one of these: --field, --file?'),
    );
  });

  it('matches rank by distance, then graph order, and at most three print', async () => {
    await expect(suggested(['rank', 'tep'])).resolves.toBe(
      command('tep', 'Did you mean one of these: tap, tip, top?'),
    );
    await expect(suggested(['rank', 'TUP'])).resolves.toBe(
      command('TUP', 'Did you mean one of these: tup, tap, tip?'),
    );
  });

  it('a global option ranks ahead of the routed Command option at one distance', async () => {
    await expect(suggested(['opts', '--fiel'])).resolves.toBe(
      option('--fiel', 'Did you mean one of these: --file, --field?'),
    );
  });

  it('a negative spelling answers its own typo and never the positive spelling', async () => {
    await expect(suggested(['opts', '--no-colr'])).resolves.toBe(
      option('--no-colr', 'Did you mean "--no-color"?'),
    );
    await expect(suggested(['opts', '--colr'])).resolves.toBe(
      option('--colr', 'Did you mean "--color"?'),
    );
  });

  it('an option offers only the nearer of its two spellings', async () => {
    await expect(suggested(['opts', '--nocolor'])).resolves.toBe(
      option('--nocolor', 'Did you mean "--no-color"?'),
    );
    await expect(suggested(['opts', '--Verbosity-Level'])).resolves.toBe(
      option('--Verbosity-Level', 'Did you mean "--verbosity-level"?'),
    );
  });

  it('an option offers both spellings when the typo is as near to each', async () => {
    await expect(suggested(['opts', '--noclor'])).resolves.toBe(
      option('--noclor', 'Did you mean one of these: --color, --no-color?'),
    );
  });

  it('a counted option offers its long spelling alone', async () => {
    await expect(suggested(['tally', '--quietnes'])).resolves.toBe(
      option('--quietnes', 'Did you mean "--quietness"?'),
    );
    await expect(suggested(['tally', '--no-quietness'])).resolves.toBe(
      option('--no-quietness', 'Did you mean "--quietness"?'),
    );
  });

  it('an implied-value option offers its long spelling alone', async () => {
    await expect(suggested(['tally', '--bakup'])).resolves.toBe(
      option('--bakup', 'Did you mean "--backup"?'),
    );
    await expect(suggested(['tally', '--bakup=numbered'])).resolves.toBe(
      option('--bakup', 'Did you mean "--backup"?'),
    );
  });

  it('a plugin option is a candidate', async () => {
    await expect(written('helped', ['opts', '--hlep'])).resolves.toBe(
      [
        'kit: Unknown option "--hlep". Did you mean "--help"?',
        'Run "kit opts --help" to see the usage.',
        'Later hint.',
        '',
      ].join('\n'),
    );
  });
});

describe('an invocation by name', () => {
  it('an unknown option suggests the declared name, where argv suggests the spelling', async () => {
    await expect(suggested(['opts', '--kepe'])).resolves.toBe(
      option('--kepe', 'Did you mean "--keep"?'),
    );
    const invoked = await invokeScenario('plain', ['opts'], { options: { kepe: true } });
    expect(invoked).toMatchObject({
      messages: option('kepe', 'Did you mean "keep"?'),
      status: 'failed',
    });
  });
});

describe('excluded members', () => {
  it('a hidden child, a deprecated child, and an alias are never suggested', async () => {
    const runs = [
      await unchanged(['excluded', 'secrt']),
      await unchanged(['excluded', 'legcy']),
      await unchanged(['excluded', 'lss']),
    ];
    expect(runs.map(({ plugin }) => plugin)).toEqual(runs.map(({ core }) => core));
  });

  it('a hidden option and a deprecated option are never suggested', async () => {
    const runs = [await unchanged(['opts', '--secrt']), await unchanged(['opts', '--oldr'])];
    expect(runs.map(({ plugin }) => plugin)).toEqual(runs.map(({ core }) => core));
  });

  it('a short spelling is never a candidate', async () => {
    const { core, plugin } = await unchanged(['opts', '-z']);
    expect(plugin).toEqual(core);
  });
});

describe('the sentence', () => {
  it('a token holding a control character or a bidirectional control is escaped', async () => {
    const bell = '\u0007';
    const override = '\u202E';
    await expect(suggested(['edits', `ge${bell}t`])).resolves.toBe(
      command(String.raw`ge\u0007t`, 'Did you mean "get"?'),
    );
    await expect(suggested(['edits', `g${override}et`])).resolves.toBe(
      command(String.raw`g\u202eet`, 'Did you mean "get"?'),
    );
  });

  it('with no match the view writes core text, an escaped token included', async () => {
    const runs = [
      await unchanged(['edits', 'zzzz']),
      await unchanged(['edits', `zz\u0007zz`]),
      await unchanged(['opts', '--zzzz']),
    ];
    expect(runs.map(({ plugin }) => plugin)).toEqual(runs.map(({ core }) => core));
  });

  it('with no match the view writes core text with its hints', async () => {
    const { core, plugin } = await unchanged(['edits', 'zzzz'], 'hinted', 'hint-core');
    expect(plugin).toEqual(core);
  });

  it('the hook adds no hint, and every hint prints under the sentence in installation order', async () => {
    await expect(written('hinted', ['edits', 'gte'])).resolves.toBe(
      ['kit: Unknown command "gte". Did you mean "get"?', 'First hint.', 'Second hint.', ''].join(
        '\n',
      ),
    );
  });

  it('a failure whose token is not a string keeps core text', async () => {
    const { core, plugin } = await unchanged(['work', 'x', '--end', 'mutated']);
    expect(plugin).toEqual(core);
  });

  it('a failure instance thrown again where nothing is near keeps core text', async () => {
    await expect(runShared(['near', 'far'])).resolves.toBe(
      [
        'kit: Unknown option "--fiel". Did you mean "--field"?',
        'kit: Unknown option "--fiel". Supply a declared option; prefix a hyphenated path with "./".',
        '',
      ].join('\n'),
    );
  });

  it('a hook that throws on a failure instance thrown again leaves no earlier suggestion', async () => {
    await expect(runShared(['near', 'break', 'far'])).resolves.toBe(
      [
        'kit: Unknown option "--fiel". Did you mean "--field"?',
        'kit: Unknown option "--fiel". Supply a declared option; prefix a hyphenated path with "./".',
        'kit: Something went wrong.',
        '',
      ].join('\n'),
    );
  });

  it('a group with no subcommand keeps core text', async () => {
    const { core, plugin } = await unchanged(['rank']);
    expect(plugin).toEqual(core);
  });

  it('a misplaced option keeps core text, which already names the Command that declares it', async () => {
    const { core, plugin } = await unchanged(['--color', 'opts']);
    expect(core.stderr).toBe(
      'kit: Option "--color" belongs to command "opts". Supply it after "opts".\n',
    );
    expect(plugin).toEqual(core);
  });
});

describe('precedence', () => {
  it("the application's override of the unknown-command view wins", async () => {
    await expect(written('app-command', ['edits', 'gte'])).resolves.toBe(
      'app: UnknownCommandError\n',
    );
  });

  it("the application's override of a class above both views wins", async () => {
    await expect(written('app-usage', ['edits', 'gte'])).resolves.toBe(
      'app: UnknownCommandError\n',
    );
    await expect(written('app-usage', ['opts', '--fields'])).resolves.toBe(
      'app: UnknownOptionError\n',
    );
  });

  it("an earlier-installed plugin's override wins, and a later-installed one loses", async () => {
    await expect(written('plugin-before', ['edits', 'gte'])).resolves.toBe(
      'before: UnknownCommandError\n',
    );
    await expect(written('plugin-after', ['edits', 'gte'])).resolves.toBe(
      command('gte', 'Did you mean "get"?'),
    );
  });

  it('installed before help, the plugin changes neither the help takeover nor the hint order', async () => {
    const early = await run('early', ['--help']);
    expect(early.status).toBe(0);
    const helped = await run('helped', ['--help']);
    expect(early.stdout).toBe(helped.stdout);
    await expect(written('early', ['edits', 'gte'])).resolves.toBe(
      [
        'kit: Unknown command "gte". Did you mean "get"?',
        'Run "kit edits --help" to see the usage.',
        'Later hint.',
        '',
      ].join('\n'),
    );
  });
});

/** Help adds its hint as the last line under core's text, and leaves the code alone. */
async function hinted(argv: string[], line: string) {
  const { core } = await unchanged(argv, 'help-core');
  return {
    expected: { status: core.status, stderr: `${core.stderr}${line}\n` },
    received: await outcome('help-core', argv),
  };
}

describe("help's failure hint", () => {
  it('an unknown Command names the page of the Command routing reached', async () => {
    const runs = [
      await hinted(['nope'], 'Run "kit --help" to see the usage.'),
      await hinted(['rank', 'nope'], 'Run "kit rank --help" to see the usage.'),
    ];
    expect(runs.map(({ received }) => received)).toEqual(runs.map(({ expected }) => expected));
  });

  it('a group with no subcommand names the group page', async () => {
    const { expected, received } = await hinted(
      ['rank'],
      'Run "kit rank --help" to see the usage.',
    );
    expect(received).toEqual(expected);
  });

  it('an option fault on a nested Command names its page', async () => {
    const runs = [
      await hinted(['edits', 'get', '--bogus'], 'Run "kit edits get --help" to see the usage.'),
      await hinted(['opts', '--xy=1'], 'Run "kit opts --help" to see the usage.'),
      await hinted(
        ['opts', '--field', 'a', '--field', 'b'],
        'Run "kit opts --help" to see the usage.',
      ),
    ];
    expect(runs.map(({ received }) => received)).toEqual(runs.map(({ expected }) => expected));
  });

  it('a missing global value before any Command name names the root page', async () => {
    const { expected, received } = await hinted(['--file'], 'Run "kit --help" to see the usage.');
    expect(received).toEqual(expected);
  });

  it('an extra argument names the page', async () => {
    const { expected, received } = await hinted(
      ['edits', 'get', 'extra'],
      'Run "kit edits get --help" to see the usage.',
    );
    expect(received).toEqual(expected);
  });

  it('a misplaced option names the page of the Command routing reached', async () => {
    const { expected, received } = await hinted(
      ['-k', 'opts'],
      'Run "kit --help" to see the usage.',
    );
    expect(received).toEqual(expected);
  });

  it('an omitted argument and an input error an action throws name the page', async () => {
    const runs = [
      await hinted(['work'], 'Run "kit work --help" to see the usage.'),
      await hinted(['work', 'x', '--end', 'input'], 'Run "kit work --help" to see the usage.'),
    ];
    expect(runs.map(({ received }) => received)).toEqual(runs.map(({ expected }) => expected));
  });

  it('a fatal error and an internal error gain no line', async () => {
    const runs = [
      await unchanged(['work', 'x', '--end', 'fatal'], 'help-core'),
      await unchanged(['work', 'x', '--end', 'internal'], 'help-core'),
    ];
    expect(runs.map(({ plugin }) => plugin)).toEqual(runs.map(({ core }) => core));
  });

  it('a declaration error a run reports gains no line', async () => {
    const { status, stderr } = await run('default-rejected', []);
    expect(status).toBe(1);
    expect(stderr).toBe('kit: Something went wrong.\n');
    expect(stderr).not.toContain('--help');
  });
});
