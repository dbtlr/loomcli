import { escapeControlCharacters, LoomError } from '@loomcli/core';

/** Whether a value is a failure class: `LoomError` or a class that extends it, as core reads one. */
function isFailureClass(value: unknown): value is typeof LoomError {
  return (
    typeof value === 'function' && (value === LoomError || value.prototype instanceof LoomError)
  );
}

/**
 * The grammar of a failure code: words of lowercase ASCII letters and digits joined by single
 * hyphens. It mirrors core's own check under Failure codes, which core does not export. Core judges
 * a code when a failure of the class is constructed, and the manifest lists classes no run has
 * constructed, so it judges the code it lists.
 */
const failureCodeGrammar = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * The failure code and exit code one class declares, or the sentence that rejects it: a value that
 * is not a failure class, then a failure code outside the grammar, with core's sentence for that
 * code. Each static is read from the nearest ancestor that declares it, so no failure is
 * constructed and the class itself never reaches the graph. The value is `unknown`, because no
 * typed path names a class without an assertion, so a value that is not a failure class is rejected
 * at run time alone.
 */
function readFailure(value: unknown): { code: string; exitCode: number } | { issue: string } {
  if (!isFailureClass(value)) {
    return { issue: 'Supply a failure class, a class that extends LoomError.' };
  }
  const { code, exitCode, name } = value;
  if (!failureCodeGrammar.test(code)) {
    return {
      issue: `Failure class "${name}" declares failure code "${escapeControlCharacters(code)}". Declare a kebab-case code of lowercase letters and digits, such as "registry-down".`,
    };
  }
  return { code, exitCode };
}

export { readFailure };
