import { z } from 'zod';

/** The unadvertised alias `--format` accepts for `jsonl`, unless a record names it directly. */
const ndjsonAlias = 'ndjson';

/**
 * The validator the format hook attaches to `--format`: a string that names one of `names`, with
 * `ndjson` accepted as an alias of `jsonl` unless the record already names `ndjson` itself.
 */
export function formatName(names: readonly string[]) {
  const list = names.join(', ');
  const aliased = !names.includes(ndjsonAlias);
  return z
    .string()
    .transform((value) => (aliased && value === ndjsonAlias ? 'jsonl' : value))
    .refine((value) => names.includes(value), { message: `Supply one of ${list}.` });
}
