import {
  Application,
  FatalError,
  GlobalOptions,
  InputError,
  issuePath,
  renderFailure,
  UnknownCommandError,
  UsageError,
} from '@loom/core';
import type {
  ApplicationOptions,
  FailureRenderer,
  InputProblem,
  Renderer,
  LoomError,
} from '@loom/core';

interface Row {
  count: number;
  source: string;
}

const table: Renderer<readonly Row[]> = {
  render: (rows) => rows.map((row) => `${String(row.count)}  ${row.source}\n`).join(''),
};
const counts: Renderer<number> = { render: (value) => String(value) };

new Application('render').action(async ({ out }) => {
  const rows: readonly Row[] = [{ count: 6, source: 'one.txt' }];
  await out.render(rows, table);
  await out.render(rows.length, counts);
  // @ts-expect-error TS2345: A renderer for another value type cannot read these rows.
  await out.render(rows, counts);
  // @ts-expect-error TS2322: A renderer returns the text core writes, never another value.
  await out.render(rows, { render: (data) => data.length });
});

/** An application's own fatal type, so registering it implies the renderer for it. */
class ConfigError extends FatalError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const problems: Renderer<InputError> = {
  render: (failure) => failure.problems.map((problem) => describe(problem)).join('\n'),
};
const unknownCommand: Renderer<UnknownCommandError> = {
  render: (failure) => `unknown command "${failure.token}"; try ${failure.candidates.join(', ')}`,
};
const anyFailure: Renderer<LoomError> = {
  render: (failure) => `${String(failure.exitCode)}: ${failure.message}`,
};

function describe(problem: InputProblem): string {
  return problem.reason === 'missing'
    ? `${problem.spelling}: required`
    : problem.issues
        .map((issue) => {
          const path: string | undefined = issuePath(issue);
          return `${problem.spelling}${path === undefined ? '' : ` at ${path}`}: ${issue.message}`;
        })
        .join('\n');
}

const failures: readonly FailureRenderer[] = [
  renderFailure(InputError, problems),
  renderFailure(UnknownCommandError, unknownCommand),
  renderFailure(UsageError, anyFailure),
  renderFailure(ConfigError, { render: (failure) => failure.message }),
];

// @ts-expect-error TS2345: A class outside the failure hierarchy has no failure to render.
renderFailure(Error, anyFailure);
// @ts-expect-error TS2345: A renderer for another class cannot answer this one.
renderFailure(UnknownCommandError, problems);

const globals = new GlobalOptions().option('file', { required: true, type: 'string' });
const configured: ApplicationOptions<{ file: string }> = { failures, globals };

new Application('inline', { failures, globals }).action(({ options }) => {
  const file: string = options.file;
  return file;
});

new Application('renderers-only', { failures }).action(({ options }) => {
  // @ts-expect-error TS2339: An Application without globals gains no global keys.
  options.file;
});

// @ts-expect-error TS2559: The positional globals form is retired.
new Application('positional', globals);

export const jsonkit = new Application('jsonkit', configured)
  .option('pretty', { type: 'boolean' })
  .action(({ options, out }) => out.print(`${options.file}:${String(options.pretty)}`));
