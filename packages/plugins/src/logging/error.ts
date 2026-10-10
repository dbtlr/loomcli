/** The step of writing a record that failed. */
type LoggingErrorKind = 'unresolved-directory' | 'create-directory' | 'append' | 'rotate';

/** What a failure of one step knows beside its kind. */
interface LoggingErrorDetail {
  readonly path: string | null;
  readonly variable?: string;
  readonly cause?: unknown;
}

/** The sentence for each step, which names the path or the variable that step failed on. */
function messageOf(kind: LoggingErrorKind, { path, variable }: LoggingErrorDetail): string {
  switch (kind) {
    case 'unresolved-directory': {
      return `Cannot resolve the log directory because ${variable ?? 'a variable'} is not set.`;
    }
    case 'create-directory': {
      return `Cannot create the log directory "${path}".`;
    }
    case 'append': {
      return `Cannot append to the log file "${path}".`;
    }
    case 'rotate': {
      return `Cannot rotate the log file "${path}".`;
    }
    default: {
      return kind;
    }
  }
}

/**
 * One failure to resolve, create, append to, or rotate the log file, which the plugin hands to the
 * author's `onError`. `variable` and `cause` are absent unless the step has one to report.
 */
class LoggingError extends Error {
  readonly kind: LoggingErrorKind;
  /** The file or directory the step failed on, or `null` when no directory could be resolved. */
  readonly path: string | null;
  /** The unset variable, for an unresolved directory. */
  declare readonly variable?: string;

  constructor(kind: LoggingErrorKind, detail: LoggingErrorDetail) {
    super(messageOf(kind, detail), 'cause' in detail ? { cause: detail.cause } : undefined);
    this.name = 'LoggingError';
    this.kind = kind;
    this.path = detail.path;
    if (detail.variable !== undefined) {
      this.variable = detail.variable;
    }
  }
}

export type { LoggingErrorKind };
export { LoggingError };
