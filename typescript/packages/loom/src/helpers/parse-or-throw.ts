import { getDotPath, safeParse } from 'valibot';
import type { BaseIssue, BaseSchema, InferOutput } from 'valibot';

/** One issue as a line: its message, led by the dot path of the key it concerns unless it is at the root. */
function describe(issue: BaseIssue<unknown>): string {
  const path = getDotPath(issue);
  return path === null ? issue.message : `${path}: ${issue.message}`;
}

/**
 * Parses a value against a schema, or throws an Error that lists every issue on its own line, so
 * the operator sees each key that is wrong and not only the first problem.
 */
export function parseOrThrow<Schema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>>(
  schema: Schema,
  input: unknown,
): InferOutput<Schema> {
  const result = safeParse(schema, input);
  if (result.success) {
    return result.output;
  }
  throw new Error(result.issues.map((issue) => describe(issue)).join('\n'));
}
