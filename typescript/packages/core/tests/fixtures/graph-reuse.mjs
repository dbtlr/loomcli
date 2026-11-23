import { Application, plugin } from '@loomcli/core';

/*
 * One probe that a test runs from source, a development build, or from a bundle whose baked facts
 * read distributed. The real process's run and inspect() then name the same build.
 */
const [scenario] = process.argv.slice(2);

/** The build hooks' calls, which the report reads after each step. */
const calls = { attached: 0, built: 0 };

const counting = plugin('@fixture/counting', {
  onCommandAttach: (command) => {
    calls.attached += 1;
    return command;
  },
  onGraphBuilt: () => {
    calls.built += 1;
    return undefined;
  },
});

/** The graph the root's action read in its run. */
let read = undefined;

const app = new Application('probe', { description: 'Probe graph reuse.', plugins: [counting] })
  .argument('scenario', { description: 'The scenario.', required: true })
  .action(({ graph }) => {
    read = graph;
  });

/** The hook calls after one step, labelled. */
const marks = [];
function mark(label) {
  marks.push({ label, ...calls });
}

if (scenario === 'run-then-inspect') {
  await app.run();
  mark('run');
  await app.run();
  mark('run');
  const first = app.inspect();
  mark('inspect');
  const second = app.inspect();
  mark('inspect');
  process.stdout.write(
    `${JSON.stringify({ marks, sameAsRun: first === read, sameInspect: first === second })}\n`,
  );
}
