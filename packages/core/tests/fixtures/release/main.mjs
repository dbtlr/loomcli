import { Application, Command } from '@loomcli/core';

// One probe per scenario, which a test runs from source or from a bundle that bakes release facts.
const [scenario] = process.argv.slice(2);

/** A validator whose JSON Schema converter throws, which a development build reports. */
const unconvertible = {
  '~standard': {
    jsonSchema: {
      input: () => {
        throw new Error('No JSON Schema.');
      },
      output: () => ({}),
    },
    validate: (value) => ({ value }),
    vendor: 'probe',
    version: 1,
  },
};

/** Prints one line of JSON. */
function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/** The release facts an action reads, and whether core froze them. */
function described(release) {
  const frozen =
    Object.isFrozen(release) && (release.release === undefined || Object.isFrozen(release.release));
  return { facts: release, frozen };
}

/** An application whose root prints the release facts its run reads. */
function facts() {
  return new Application('probe', { description: 'Probe the release facts.' }).action(
    ({ host, out }) => out.print(JSON.stringify(described(host.release))),
  );
}

/** An application whose root throws a foreign error, a defect. */
function throwing() {
  return new Application('probe', { description: 'Probe the release facts.' }).action(() => {
    throw new TypeError('The probe failed.');
  });
}

/** An application whose root declares neither children nor an action, a build fault. */
function unfinished() {
  return new Application('probe', { description: 'Probe the release facts.' });
}

/** An application with one option whose converter throws, which only a development build checks. */
function converter() {
  return new Application('probe', { description: 'Probe the release facts.' })
    .option('limit', { description: 'The limit.', type: 'string', validate: unconvertible })
    .action(({ out }) => out.print('ran'));
}

/** An application whose `outer` action calls `inner`, which prints the facts the call reads. */
function nested() {
  return new Application('probe', { description: 'Probe the release facts.' })
    .command(
      new Command('inner', { description: 'Print the release facts.' }).action(({ host, out }) =>
        out.print(JSON.stringify(host.release)),
      ),
    )
    .command(
      new Command('outer', { description: 'Call inner by name.' }).action(
        async ({ invoke, out }) => {
          const outcome = await invoke(['inner'], {});
          await out.print(outcome.status === 'completed' ? outcome.output.trim() : outcome.status);
        },
      ),
    );
}

/** What `inspect()` answers: the graph's name, or the class, rule, and sentence it threw. */
function inspected(app) {
  try {
    return { name: app.inspect().name };
  } catch (error) {
    return { rule: error.rule?.identity, sentence: error.sentence, thrown: error.name };
  }
}

/** One failed or completed outcome, with the parts a test reads. */
function outcomeOf(outcome) {
  return {
    exitCode: outcome.exitCode,
    form: outcome.form,
    messages: outcome.messages,
    output: outcome.output,
    rule: outcome.failure?.rule?.identity,
    status: outcome.status,
  };
}

/** The words every run reads, so the scenario's name never reaches the probe. */
const host = { argv: [] };

/** A release override a test supplies, which core takes as given. */
const supplied = {
  build: 'development',
  release: { lane: 'given', repository: 'x', version: '0' },
};

const scenarios = {
  // The build fault through every door.
  'build-fault': () => unfinished().run({ host }),
  'build-fault-inspect': () => print(inspected(unfinished())),
  // The converter fault through run() and inspect(), and the schema a build reads.
  converter: () => converter().run({ host }),
  'converter-inspect': () => {
    try {
      print({ schema: converter().inspect().root.options[0].schema });
    } catch (error) {
      print({ rule: error.rule?.identity, thrown: error.name });
    }
  },
  facts: () => facts().run({ host }),
  inspect: () => print(inspected(facts())),
  invoke: async () => print(outcomeOf(await facts().invoke([], {}))),
  'invoke-override': async () =>
    print(outcomeOf(await facts().invoke([], {}, { host: { release: supplied } }))),
  nested: () => nested().run({ host: { argv: ['outer'], release: { build: 'development' } } }),
  override: () => facts().run({ host: { ...host, release: { build: 'distributed' } } }),
  'override-defect': () => throwing().run({ host: { ...host, release: { build: 'distributed' } } }),
  'override-development': () =>
    throwing().run({ host: { ...host, release: { build: 'development' } } }),
  'override-null': () => throwing().run({ host: { ...host, release: null } }),
  'override-null-invoke': async () => {
    const outcome = await throwing().invoke([], {}, { host: { release: null } });
    print({ exitCode: outcome.exitCode, status: outcome.status });
    return 0;
  },
  throw: () => throwing().run({ host }),
};

process.exitCode = await scenarios[scenario]();
