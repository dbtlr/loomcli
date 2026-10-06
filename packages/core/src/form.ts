import { exitCodeOf, failureCodeOf, FatalError, isAuthorFault } from './errors.js';
import type { LoomError } from './errors.js';
import type { FailureExitCode } from './exit-codes.js';
import { escapeText } from './style.js';

/**
 * One failure as plain data, for a reader that cannot parse prose: `invoke()`'s outcome and its
 * caller's handler, and a failure encoder under `run()`. `code` is the class's failure code, or
 * `internal` for a defect or a declaration fault. `exitCode` is the failure's declared exit code,
 * which the code a run resolves can differ from. `message` is the sentence as plain text, without
 * the application-name prefix, and `hints` are the `onFailure` lines as plain text, in the order
 * the failure view receives them.
 */
interface FailureForm {
  readonly code: string;
  readonly exitCode: FailureExitCode;
  readonly message: string;
  readonly hints: readonly string[];
}

/** What one form reads beside its failure: the run's build, the hints, and the plain resolution. */
interface FormScene {
  /** Whether the run is a development build, whose defect reads its sentence. */
  readonly development: boolean;
  /** The hints the failure view receives, as marked text. */
  readonly hints: readonly string[];
  /** Resolves marked text as plain text, with no color, modifier, or hyperlink. */
  readonly plain: (marked: string) => string;
}

/**
 * One failure's sentence as core's default text marks it: escaped, unless it is the authored marked
 * message of a `FatalError`. Core's default failure text and a failure form's message both read it.
 */
function markedSentence(failure: LoomError, text: string): string {
  return failure instanceof FatalError ? text : escapeText(text);
}

/** The message a defect reads in a distributed build, which names no reason. */
const genericMessage = 'Something went wrong.';

/**
 * The form of one failure, built after the translators and the hooks. A defect or a declaration
 * fault reads `internal`, and its message follows the build: its sentence in a development build
 * and the generic message in a distributed one, so no form carries a cause, a stack, a finding, or
 * a rule identity. Every other failure reads its message as core's default text does, escaped
 * unless it is the authored marked message of a `FatalError`, resolved as plain text.
 */
function failureForm(failure: LoomError, scene: FormScene): FailureForm {
  const { development, hints, plain } = scene;
  const author = isAuthorFault(failure);
  let message = genericMessage;
  if (!author) {
    message = plain(markedSentence(failure, failure.message));
  } else if (development) {
    message = plain(escapeText(failure.sentence));
  }
  return Object.freeze({
    code: author ? 'internal' : failureCodeOf(failure),
    exitCode: exitCodeOf(failure),
    message,
    hints: Object.freeze(hints.map(plain)),
  });
}

export type { FailureForm, FormScene };
export { failureForm, markedSentence };
