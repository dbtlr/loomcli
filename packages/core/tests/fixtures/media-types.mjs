import { Application, Command, DeclarationError, plugin, view } from '@loomcli/core';

const scenario = process.argv[2];

/** Prints one line of JSON to stdout, the fixture's report. */
function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

const render = (data) => `${JSON.stringify(data)}\n`;
const row = (data) => `${JSON.stringify(data)}\n`;

/** Each Command's path and published media types, depth first. */
function walk(node) {
  return [[node.path.join(' '), node.result?.mediaTypes ?? null], ...node.children.flatMap(walk)];
}

/** The media types `inspect()` publishes for each Command, keyed by its path. */
function mediaTypes(app) {
  return Object.fromEntries(walk(app.inspect().root));
}

if (scenario === 'stores') {
  const page = view('@fixture/page', { mediaType: 'text/plain', render });
  // The fixture writes to this view after the call that stored it, which changes no fact.
  const later = { mediaType: 'text/csv', render };
  const adding = plugin('@fixture/adding', {
    onCommandAttach: (command) =>
      command.name === 'rows'
        ? command.views({ hooked: { mediaType: 'application/x-hooked', render } })
        : command,
  });
  const app = new Application('probe', { plugins: [adding] })
    .command(
      new Command('value')
        .result({ views: { csv: later, page, plain: { render } } })
        .views({ added: { mediaType: 'text/markdown', render } })
        .action(({ out }) => out.results({})),
    )
    .command(
      new Command('rows')
        .rows({
          views: {
            lines: { mediaType: 'application/jsonl', row },
            odd: { mediaType: 'nonsense', render },
          },
        })
        .action(({ out }) => out.results([])),
    );
  later.mediaType = 'text/changed';
  print({ declared: page.mediaType, mediaTypes: mediaTypes(app) });
} else if (scenario === 'replaced') {
  // A later views() call replaces a key in place, and its view's media type replaces the old one.
  const app = new Application('probe').command(
    new Command('value')
      .result({ views: { json: { mediaType: 'application/json', render }, text: { render } } })
      .views({ json: { render } })
      .action(({ out }) => out.results({})),
  );
  print(mediaTypes(app));
} else if (scenario === 'unchecked') {
  // A view that writes text its declared media type does not describe renders as written.
  await new Application('probe')
    .result({ views: { json: { mediaType: 'application/json', render: () => 'not json\n' } } })
    .action(({ out }) => out.results({}))
    .run({ host: { argv: [], release: { build: 'distributed' } } });
} else if (scenario === 'faults') {
  const faults = {};
  const attempts = {
    declared: () => view('@fixture/page', { mediaType: 5, render }),
    result: () => new Command('count').result({ views: { csv: { mediaType: 5, render } } }),
    views: () =>
      new Command('count')
        .result({ views: { csv: { render } } })
        .views({ tsv: { mediaType: true, render } }),
  };
  for (const [kind, attempt] of Object.entries(attempts)) {
    try {
      attempt();
      faults[kind] = 'returned';
    } catch (error) {
      faults[kind] =
        error instanceof DeclarationError ? error.rule?.identity : 'threw something else';
    }
  }
  print(faults);
}
