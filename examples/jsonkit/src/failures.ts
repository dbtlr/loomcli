import { issuePath } from '@loomcli/core';
import type { InputError, InputProblem, Renderer, UnknownCommandError } from '@loomcli/core';

/** Every diagnostic this application writes names the application first. */
const NAME = 'jsonkit';

function branded(text: string): string {
  return `${NAME}: ${text}`;
}

/**
 * One line per rejected input. Both readings name the token an operator would type, so an omission
 * and a rejected value read alike, and neither line parses the sentence core would have written.
 */
function describe(problem: InputProblem): string[] {
  if (problem.reason === 'missing') {
    return [branded(`${problem.spelling}: required`)];
  }
  // A path names a position inside a collected value, so a rejected field reads "at 0".
  return problem.issues.map((issue) => {
    const path = issuePath(issue);
    return branded(
      `${problem.spelling}${path === undefined ? '' : ` at ${path}`}: ${issue.message}`,
    );
  });
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
