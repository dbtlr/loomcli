import type {
  InputError,
  InputProblem,
  Renderer,
  StandardSchemaV1,
  UnknownCommandError,
} from '@loom/core';

/** Every diagnostic this application writes names the application first. */
const NAME = 'jsonkit';

function branded(text: string): string {
  return `${NAME}: ${text}`;
}

/** An issue path names a position inside a collected value, so a rejected field reads "at 0". */
function located(issue: StandardSchemaV1.Issue): string {
  const path = issue.path
    ?.map((segment) => String(typeof segment === 'object' ? segment.key : segment))
    .join('.');
  return path ? ` at ${path}` : '';
}

/**
 * One line per rejected input. Both readings name the token an operator would type, so an omission
 * and a rejected value read alike, and neither line parses the sentence core would have written.
 */
function describe(problem: InputProblem): string[] {
  return problem.reason === 'missing'
    ? [branded(`${problem.spelling}: required`)]
    : problem.issues.map((issue) =>
        branded(`${problem.spelling}${located(issue)}: ${issue.message}`),
      );
}

/**
 * The whole validation phase, in the authoring order the failure collected it. The renderer owns
 * every byte core writes, so the joined lines end in the trailing newline core no longer adds.
 */
export const inputProblems: Renderer<InputError> = {
  render: (failure) => `${failure.problems.flatMap(describe).join('\n')}\n`,
};

export const unknownCommand: Renderer<UnknownCommandError> = {
  render: (failure) =>
    `${branded(`unknown command "${failure.token}"; try ${failure.candidates.join(', ')}.`)}\n`,
};
