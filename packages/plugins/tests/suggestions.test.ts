import { describe, expect, it } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/suggestions.mjs', import.meta.url);

function run(scenario: string, argv: string[]) {
  return invoke(fixture, [scenario, ...argv]);
}

/** The diagnostic the fixture application writes with the suggestions plugin alone installed. */
function suggested(argv: string[]) {
  return run('plain', argv).stderr;
}

/** A near-match sentence, the one line the plugin writes when no other plugin adds a hint. */
function command(token: string, fix: string) {
  return `kit: Unknown command "${token}". ${fix}\n`;
}

function option(spelling: string, fix: string) {
  return `kit: Unknown option "${spelling}". ${fix}\n`;
}

/** How one run ended, as a test compares it. */
function outcome(scenario: string, argv: string[]) {
  const { status, stderr } = run(scenario, argv);
  return { status, stderr };
}

/**
 * One invocation under the plugin and under a baseline without it, so a test reads that the plugin
 * wrote the baseline's bytes and code. A baseline that succeeds compares nothing, so it throws.
 */
function unchanged(argv: string[], scenario = 'plain', baseline = 'core') {
  const core = outcome(baseline, argv);
  if (core.status === 0) {
    throw new Error(`The baseline run of ${argv.join(' ')} succeeded.`);
  }
  return { core, plugin: outcome(scenario, argv) };
}

describe('the matcher', () => {
  it('an insertion, a deletion, a substitution, and an adjacent transposition each cost 1', () => {
    expect(suggested(['edits', 'gt'])).toBe(command('gt', 'Did you mean "get"?'));
    expect(suggested(['edits', 'gett'])).toBe(command('gett', 'Did you mean "get"?'));
    expect(suggested(['edits', 'gat'])).toBe(command('gat', 'Did you mean "get"?'));
    expect(suggested(['edits', 'gte'])).toBe(command('gte', 'Did you mean "get"?'));
  });

  it('the failure exits with the usage code', () => {
    expect(run('plain', ['edits', 'gte']).status).toBe(2);
  });

  it('a non-adjacent transposition costs 2, past the budget of a 4-code-point token', () => {
    const { core, plugin } = unchanged(['edits', 'nale']);
    expect(plugin).toEqual(core);
  });

  it('a token of up to 4 code points allows 1 edit', () => {
    expect(suggested(['budget', 'fuor'])).toBe(command('fuor', 'Did you mean "four"?'));
    const { core, plugin } = unchanged(['budget', 'fxxr']);
    expect(plugin).toEqual(core);
  });

  it('a token of 5 code points allows 2 edits', () => {
    expect(suggested(['budget', 'fivxx'])).toBe(command('fivxx', 'Did you mean "fives"?'));
    const { core, plugin } = unchanged(['budget', 'fxxxs']);
    expect(plugin).toEqual(core);
  });

  it('a token of 8 code points allows 2 edits', () => {
    expect(suggested(['budget', 'seasxxed'])).toBe(command('seasxxed', 'Did you mean "seasoned"?'));
    const { core, plugin } = unchanged(['budget', 'sxasxxed']);
    expect(plugin).toEqual(core);
  });

  it('a token longer than 8 code points allows 3 edits', () => {
    expect(suggested(['budget', 'ovxxxight'])).toBe(
      command('ovxxxight', 'Did you mean "overnight"?'),
    );
    const { core, plugin } = unchanged(['budget', 'oxxxxight']);
    expect(plugin).toEqual(core);
  });

  it('a token of one code point matches nothing', () => {
    const { core, plugin } = unchanged(['opts', '--x']);
    expect(plugin).toEqual(core);
  });

  it('a token that differs only in case matches at distance 0, and a match prints as declared', () => {
    expect(suggested(['edits', 'GET'])).toBe(command('GET', 'Did you mean "get"?'));
    expect(suggested(['edits', 'build'])).toBe(command('build', 'Did you mean "Build"?'));
  });

  it('the token is normalized to NFC before the comparison', () => {
    const decomposed = `--${`e\u0301`.repeat(3)}`;
    expect(suggested(['opts', decomposed])).toBe(option(decomposed, 'Did you mean "--ééé"?'));
  });

  it('lengths and distances count code points, not code units', () => {
    expect(suggested(['edits', 'ge😀'])).toBe(command('ge😀', 'Did you mean "get"?'));
  });

  it('leading hyphens are left out of an option comparison', () => {
    expect(suggested(['opts', '--fields'])).toBe(option('--fields', 'Did you mean "--field"?'));
    expect(suggested(['opts', '---field'])).toBe(
      option('---field', 'Did you mean one of these: --field, --file?'),
    );
  });

  it('matches rank by distance, then graph order, and at most three print', () => {
    expect(suggested(['rank', 'tep'])).toBe(
      command('tep', 'Did you mean one of these: tap, tip, top?'),
    );
    expect(suggested(['rank', 'TUP'])).toBe(
      command('TUP', 'Did you mean one of these: tup, tap, tip?'),
    );
  });

  it('a global option ranks ahead of the routed Command option at one distance', () => {
    expect(suggested(['opts', '--fiel'])).toBe(
      option('--fiel', 'Did you mean one of these: --file, --field?'),
    );
  });

  it('a negative spelling answers its own typo and never the positive spelling', () => {
    expect(suggested(['opts', '--no-colr'])).toBe(
      option('--no-colr', 'Did you mean "--no-color"?'),
    );
    expect(suggested(['opts', '--colr'])).toBe(option('--colr', 'Did you mean "--color"?'));
  });

  it('an option offers only the nearer of its two spellings', () => {
    expect(suggested(['opts', '--nocolor'])).toBe(
      option('--nocolor', 'Did you mean "--no-color"?'),
    );
    expect(suggested(['opts', '--Verbosity-Level'])).toBe(
      option('--Verbosity-Level', 'Did you mean "--verbosity-level"?'),
    );
  });

  it('an option offers both spellings when the typo is as near to each', () => {
    expect(suggested(['opts', '--noclor'])).toBe(
      option('--noclor', 'Did you mean one of these: --color, --no-color?'),
    );
  });

  it('a plugin option is a candidate', () => {
    expect(run('helped', ['opts', '--hlep']).stderr).toBe(
      [
        'kit: Unknown option "--hlep". Did you mean "--help"?',
        'Run "kit opts --help" to see the usage.',
        'Later hint.',
        '',
      ].join('\n'),
    );
  });
});

describe('excluded members', () => {
  it('a hidden child, a deprecated child, and an alias are never suggested', () => {
    const runs = [
      unchanged(['excluded', 'secrt']),
      unchanged(['excluded', 'legcy']),
      unchanged(['excluded', 'lss']),
    ];
    expect(runs.map(({ plugin }) => plugin)).toEqual(runs.map(({ core }) => core));
  });

  it('a hidden option and a deprecated option are never suggested', () => {
    const runs = [unchanged(['opts', '--secrt']), unchanged(['opts', '--oldr'])];
    expect(runs.map(({ plugin }) => plugin)).toEqual(runs.map(({ core }) => core));
  });

  it('a short spelling is never a candidate', () => {
    const { core, plugin } = unchanged(['opts', '-z']);
    expect(plugin).toEqual(core);
  });
});

describe('the sentence', () => {
  it('a token holding a control character or a bidirectional control is escaped', () => {
    const bell = '\u0007';
    const override = '\u202E';
    expect(suggested(['edits', `ge${bell}t`])).toBe(
      command(String.raw`ge\u0007t`, 'Did you mean "get"?'),
    );
    expect(suggested(['edits', `g${override}et`])).toBe(
      command(String.raw`g\u202eet`, 'Did you mean "get"?'),
    );
  });

  it('with no match the view writes core text, an escaped token included', () => {
    const runs = [
      unchanged(['edits', 'zzzz']),
      unchanged(['edits', `zz\u0007zz`]),
      unchanged(['opts', '--zzzz']),
    ];
    expect(runs.map(({ plugin }) => plugin)).toEqual(runs.map(({ core }) => core));
  });

  it('with no match the view writes core text with its hints', () => {
    const { core, plugin } = unchanged(['edits', 'zzzz'], 'hinted', 'hint-core');
    expect(plugin).toEqual(core);
  });

  it('the hook adds no hint, and every hint prints under the sentence in installation order', () => {
    expect(run('hinted', ['edits', 'gte']).stderr).toBe(
      ['kit: Unknown command "gte". Did you mean "get"?', 'First hint.', 'Second hint.', ''].join(
        '\n',
      ),
    );
  });

  it('a failure whose token is not a string keeps core text', () => {
    const { core, plugin } = unchanged(['work', 'x', '--end', 'mutated']);
    expect(plugin).toEqual(core);
  });

  it('a failure instance thrown again where nothing is near keeps core text', () => {
    const shared = new URL('fixtures/suggestions-shared.mjs', import.meta.url);
    expect(invoke(shared, ['near', 'far']).stderr).toBe(
      [
        'kit: Unknown option "--fiel". Did you mean "--field"?',
        'kit: Unknown option "--fiel". Supply a declared option; prefix a hyphenated path with "./".',
        '',
      ].join('\n'),
    );
  });

  it('a group with no subcommand keeps core text', () => {
    const { core, plugin } = unchanged(['rank']);
    expect(plugin).toEqual(core);
  });
});

describe('precedence', () => {
  it("the application's override of the unknown-command view wins", () => {
    expect(run('app-command', ['edits', 'gte']).stderr).toBe('app: UnknownCommandError\n');
  });

  it("the application's override of a class above both views wins", () => {
    expect(run('app-usage', ['edits', 'gte']).stderr).toBe('app: UnknownCommandError\n');
    expect(run('app-usage', ['opts', '--fields']).stderr).toBe('app: UnknownOptionError\n');
  });

  it("an earlier-installed plugin's override wins, and a later-installed one loses", () => {
    expect(run('plugin-before', ['edits', 'gte']).stderr).toBe('before: UnknownCommandError\n');
    expect(run('plugin-after', ['edits', 'gte']).stderr).toBe(
      command('gte', 'Did you mean "get"?'),
    );
  });

  it('installed before help, the plugin changes neither the help takeover nor the hint order', () => {
    const early = run('early', ['--help']);
    expect(early.status).toBe(0);
    expect(early.stdout).toBe(run('helped', ['--help']).stdout);
    expect(run('early', ['edits', 'gte']).stderr).toBe(
      [
        'kit: Unknown command "gte". Did you mean "get"?',
        'Run "kit edits --help" to see the usage.',
        'Later hint.',
        '',
      ].join('\n'),
    );
  });
});

describe("help's failure hint", () => {
  /** Help adds its hint as the last line under core's text, and leaves the code alone. */
  function hinted(argv: string[], line: string) {
    const { core } = unchanged(argv, 'help-core');
    return {
      expected: { status: core.status, stderr: `${core.stderr}${line}\n` },
      received: outcome('help-core', argv),
    };
  }

  it('an unknown Command names the page of the Command routing reached', () => {
    const runs = [
      hinted(['nope'], 'Run "kit --help" to see the usage.'),
      hinted(['rank', 'nope'], 'Run "kit rank --help" to see the usage.'),
    ];
    expect(runs.map(({ received }) => received)).toEqual(runs.map(({ expected }) => expected));
  });

  it('a group with no subcommand names the group page', () => {
    const { expected, received } = hinted(['rank'], 'Run "kit rank --help" to see the usage.');
    expect(received).toEqual(expected);
  });

  it('an option fault on a nested Command names its page', () => {
    const runs = [
      hinted(['edits', 'get', '--bogus'], 'Run "kit edits get --help" to see the usage.'),
      hinted(['opts', '--xy=1'], 'Run "kit opts --help" to see the usage.'),
      hinted(['opts', '--field', 'a', '--field', 'b'], 'Run "kit opts --help" to see the usage.'),
    ];
    expect(runs.map(({ received }) => received)).toEqual(runs.map(({ expected }) => expected));
  });

  it('a missing value in the pre-scan names the root page', () => {
    const { expected, received } = hinted(['--file'], 'Run "kit --help" to see the usage.');
    expect(received).toEqual(expected);
  });

  it('an extra argument names the page', () => {
    const { expected, received } = hinted(
      ['edits', 'get', 'extra'],
      'Run "kit edits get --help" to see the usage.',
    );
    expect(received).toEqual(expected);
  });

  it('a short group the pre-scan rejects names the root page', () => {
    expect(run('help-core', ['opts', '-hk']).stderr).toBe(
      [
        'kit: A short group mixes the global option "-h" with "-k", which is not a global option. Supply global options as separate tokens, and local options after their command name.',
        'Run "kit --help" to see the usage.',
        '',
      ].join('\n'),
    );
  });

  it('an omitted argument and an input error an action throws name the page', () => {
    const runs = [
      hinted(['work'], 'Run "kit work --help" to see the usage.'),
      hinted(['work', 'x', '--end', 'input'], 'Run "kit work --help" to see the usage.'),
    ];
    expect(runs.map(({ received }) => received)).toEqual(runs.map(({ expected }) => expected));
  });

  it('a fatal error and an internal error gain no line', () => {
    const runs = [
      unchanged(['work', 'x', '--end', 'fatal'], 'help-core'),
      unchanged(['work', 'x', '--end', 'internal'], 'help-core'),
    ];
    expect(runs.map(({ plugin }) => plugin)).toEqual(runs.map(({ core }) => core));
  });

  it('a declaration error a run reports gains no line', () => {
    const { status, stderr } = run('default-rejected', []);
    expect(status).toBe(1);
    expect(stderr).toMatch(/^Invalid declaration: /u);
    expect(stderr).not.toContain('--help');
  });
});
