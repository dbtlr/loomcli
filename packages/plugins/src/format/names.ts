import { createValidator } from '@loomcli/validators';

/** The unadvertised alias `--format` accepts for `jsonl`, unless a record names it directly. */
const ndjsonAlias = 'ndjson';

/**
 * The validator the format hook attaches to `--format`: a string that names one of `names`, with
 * `ndjson` accepted as an alias of `jsonl` unless the record already names `ndjson` itself.
 * The alias is mapped ahead of the match, so the input schema the option publishes carries the view
 * names alone and the unadvertised alias stays out of it.
 */
export function formatName(names: readonly string[]) {
  const list = names.join(', ');
  const aliased = !names.includes(ndjsonAlias);
  return createValidator({
    inputSchema: { type: 'string', enum: [...names] },
    parse: (raw) => {
      const name = aliased && raw === ndjsonAlias ? 'jsonl' : raw;
      const match = names.find((each) => each === name);
      return match === undefined
        ? { issues: [{ message: `Supply one of ${list}.` }] }
        : { value: match };
    },
  });
}
