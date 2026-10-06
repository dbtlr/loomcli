import { Writable } from 'node:stream';

import { Application, Command, DeclarationError, diagnosticRule, plugin } from '@loomcli/core';

const scenario = process.argv[2];
const build = process.argv[3] ?? 'distributed';

/** The packet each Application reads, so a build fault renders by the build a test names. */
const packet = { packet: { build } };

/** Prints one line of JSON to stdout, the fixture's report. */
function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/** A stream that keeps what a run writes, so the report reads it back as text. */
function sink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  return { stream, text: () => chunks.join('') };
}

/** One run through argv, with its exit code and what it wrote to each stream. */
async function runCaptured(app, argv) {
  const stdout = sink();
  const stderr = sink();
  const exitCode = await app.run({ host: { argv, stderr: stderr.stream, stdout: stdout.stream } });
  return { exitCode, stderr: stderr.text(), stdout: stdout.text() };
}

/** Every Command path in one graph, depth first, as the hook saw it. */
function paths(node) {
  return [node.path.join(' '), ...node.children.flatMap(paths)];
}

const rejecting = diagnosticRule('@fixture/judge/shared-name', {
  explanation: 'Each Command describes its own job.',
  headline: 'Two Commands share one description',
});

if (scenario === 'order') {
  const calls = [];
  const graphs = [];
  // Each plugin records what its hook saw, so the report reads the order and the facts.
  const judge = (identity) =>
    plugin(identity, {
      onGraphBuilt: (graph) => {
        graphs.push(graph);
        const count = graph.root.children.find((child) => child.name === 'count');
        calls.push({
          commands: paths(graph.root),
          identity,
          options: count?.options.map((option) => option.name) ?? [],
        });
        return undefined;
      },
    });
  const attaching = plugin('@fixture/attach', {
    commands: [new Command('doctor').action(() => undefined)],
    onCommandAttach: (command) =>
      command.name === 'count' ? command.option('format', { type: 'string' }) : command,
  });
  let readByAction = undefined;
  const app = new Application('probe', {
    plugins: [attaching, judge('@fixture/first'), judge('@fixture/second')],
  })
    .command(
      new Command('count').action(({ graph }) => {
        readByAction = graph;
      }),
    )
    .command(
      new Command('caller').action(async ({ invoke }) => {
        await invoke(['count'], {});
      }),
    );
  const marks = [];
  const mark = (label) => marks.push({ calls: calls.length, label });
  await runCaptured(app, ['count']);
  mark('run');
  const sameAsAction = graphs.at(-1) === readByAction && graphs.at(-2) === readByAction;
  app.inspect();
  mark('inspect');
  await app.invoke(['count'], {});
  mark('app.invoke');
  await app.invoke(['caller'], {});
  mark('app.invoke with an action invoke');
  print({ calls: calls.slice(0, 2), marks, sameAsAction });
} else if (scenario === 'reject') {
  const seen = [];
  const judge = plugin('@fixture/judge', {
    onFailure: () => {
      seen.push('onFailure');
      return undefined;
    },
    onGraphBuilt: () => {
      seen.push('judge');
      throw new DeclarationError(rejecting, {
        correction: 'Describe what each Command does in its own words.',
        sentence: 'Commands "a" and "b" share one description.',
      });
    },
  });
  const later = plugin('@fixture/later', {
    onGraphBuilt: () => {
      seen.push('later');
      return undefined;
    },
  });
  const app = new Application('probe', { ...packet, plugins: [judge, later] }).action(() =>
    seen.push('action'),
  );
  const ran = await runCaptured(app, []);
  const afterRun = [...seen];
  let inspected = 'returned';
  try {
    app.inspect();
  } catch (error) {
    inspected = error instanceof DeclarationError ? error.message : 'threw something else';
  }
  print({ afterRun, inspected, ran });
} else if (scenario === 'broken') {
  // Each kind breaks the hook a different way, and every one is the broken-graph-hook fault.
  const hooks = {
    promise: () => Promise.reject(new Error('the hook rejected')),
    returns: () => true,
    throws: () => {
      throw new TypeError('the hook broke');
    },
  };
  const results = {};
  for (const [kind, onGraphBuilt] of Object.entries(hooks)) {
    const app = new Application('probe', {
      ...packet,
      plugins: [plugin('@fixture/broken', { onGraphBuilt })],
    }).action(() => undefined);
    results[kind] = await runCaptured(app, []);
  }
  print(results);
} else if (scenario === 'frozen') {
  const seen = [];
  const writing = plugin('@fixture/writing', {
    onGraphBuilt: (graph) => {
      try {
        graph.root.children.push(graph.root);
        seen.push('mutated');
      } catch {
        seen.push('threw');
      }
      return undefined;
    },
  });
  const app = new Application('probe', { plugins: [writing] })
    .command(new Command('leaf').action(() => undefined))
    .action(({ graph, out }) => out.print(String(graph.root.children.length)));
  const quiet = await runCaptured(app, []);
  const unguarded = new Application('probe', {
    ...packet,
    plugins: [
      plugin('@fixture/unguarded', {
        onGraphBuilt: (graph) => {
          graph.root.children.push(graph.root);
          return undefined;
        },
      }),
    ],
  }).action(() => undefined);
  print({ quiet, seen, unguarded: await runCaptured(unguarded, []) });
} else if (scenario === 'not-a-function') {
  try {
    plugin('@fixture/judge', { onGraphBuilt: 'judge' });
    process.stdout.write('returned\n');
  } catch (error) {
    process.stdout.write(
      error instanceof DeclarationError ? error.message : 'threw something else',
    );
  }
}

// Each run above set the process's exit status; the report itself succeeded.
process.exitCode = 0;
