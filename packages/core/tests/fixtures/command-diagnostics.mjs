import { Application, Command, DeclarationError, plugin, processHandle } from '@loomcli/core';

const act = () => undefined;
const leaf = (name) => new Command(name).action(act);

/**
 * One faulty declaration per scenario. Each throws a declaration fault whose rule the Command and
 * naming family declares, and the fixture prints the diagnostic its message holds.
 */
const scenarios = {
  'alias-portable': () => new Command('keys').alias('ls', 'bad name'),
  'application-name': () => new Application('bad name'),
  'argument-beside-child': () =>
    new Application('probe', {
      plugins: [plugin('@acme/doctor', { commands: [leaf('check')] })],
    }).argument('files', { variadic: true }),
  'argument-name': () => new Command('get').argument('-path', {}),
  'argument-twice': () =>
    new Command('get').argument('path', { required: true }).argument('path', {}),
  'attached-twice': () => {
    const clear = leaf('clear');
    return new Application('probe')
      .command(new Command('cache').command(clear))
      .command(new Command('tmp').command(clear));
  },
  'child-without-action': () => new Command('store').command(new Command('get')),
  'command-name': () => new Command('bad name'),
  'optional-before-required': () =>
    new Command('keys').argument('path', {}).argument('name', { required: true }),
  'plugin-sibling': () =>
    plugin('@acme/doctor', {
      commands: [leaf('check'), new Command('probe').alias('check').action(act)],
    }),
  'sibling-alias': () =>
    new Command('store')
      .command(new Command('select').alias('ls').action(act))
      .command(new Command('keys').alias('ls').action(act)),
  'sibling-alias-name': () =>
    new Command('store').command(leaf('get')).command(new Command('keys').alias('get').action(act)),
  'sibling-name': () => new Command('store').command(leaf('get')).command(leaf('get')),
  'sibling-name-alias': () =>
    new Command('store').command(new Command('keys').alias('get').action(act)).command(leaf('get')),
  'variadic-not-last': () =>
    new Command('get').argument('paths', { variadic: true }).argument('path', {}),
};

const scenario = process.argv[2];

if (scenario === 'root-without-action') {
  // A root fault waits for build, which run() reports with the application name in a development build.
  process.exitCode = await new Application('probe').run({ process: processHandle({ argv: [] }) });
} else {
  try {
    scenarios[scenario]();
    process.stdout.write('returned\n');
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    // The sentence mode reads the sentence the fault holds, before any rendering escapes it.
    const modes = {
      sentence: () => error.sentence,
    };
    process.stdout.write(`${modes[process.argv[3]]?.() ?? error.message}\n`);
  }
}
