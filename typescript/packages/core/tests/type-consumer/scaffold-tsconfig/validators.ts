// Compiled under the tsconfig `loom init` writes, which leaves `exactOptionalPropertyTypes` off.
// There TypeScript gives a ternary's `{ issues }` branch an optional `value` of `undefined`.
import { Command } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';
import { createValidator } from '@loomcli/validators';
import type { ParseResult } from '@loomcli/validators';

/** The reference's form: a ternary that returns `{ issues }` or `{ value }`. */
const metres = createValidator({
  inputSchema: { type: 'number' },
  parse: (raw) => {
    const value = Number(raw);
    return Number.isNaN(value) ? { issues: [{ message: 'Expected metres.' }] } : { value };
  },
});

/** The same form without an input schema, answering through a promise. */
const seconds = createValidator({
  parse: async (raw) => {
    const value = Number(raw);
    return Number.isNaN(value) ? { issues: [{ message: 'Expected seconds.' }] } : { value };
  },
});

/** A parse that rejects directly and accepts through a promise. */
const size = createValidator({
  parse: (raw) =>
    raw === ''
      ? { issues: [{ message: 'Name a file.' }] }
      : Promise.resolve(raw.length).then((length) => ({ value: length })),
});

/** An annotated parse and a stated output type read as they did. */
const annotated = createValidator({
  parse: (raw): ParseResult<number> => ({ value: Number(raw) }),
});
const stated = createValidator<number>({
  parse: (raw) => (raw === '' ? { issues: [{ message: 'Expected a number.' }] } : { value: 1 }),
});

/** A parse whose accepted value may be `undefined` keeps it. */
const label = createValidator({
  parse: (raw) => (raw === '-' ? { value: undefined } : { value: raw }),
});

const pace = new Command('pace')
  .argument('distance', { required: true, validate: metres })
  .argument('time', { required: true, validate: seconds })
  .argument('file', { required: true, validate: size })
  .action(({ args }) => {
    const distance: number = args.distance;
    const time: number = args.time;
    const file: number = args.file;
    return distance / time + file;
  });

declare const annotatedOutput: StandardSchemaV1.InferOutput<typeof annotated>;
declare const statedOutput: StandardSchemaV1.InferOutput<typeof stated>;
declare const labelOutput: StandardSchemaV1.InferOutput<typeof label>;
const outputs: [number, number, string | undefined] = [annotatedOutput, statedOutput, labelOutput];

// @ts-expect-error TS2322: A rejected token produces no value, so the output is never undefined.
const absent: StandardSchemaV1.InferOutput<typeof metres> = undefined;

// @ts-expect-error TS2322: An accepted undefined stays in the output.
const present: string = labelOutput;

// @ts-expect-error TS2769: A parse returns `{ value }` or `{ issues }`.
createValidator({ parse: (raw) => ({ raw }) });

export { absent, outputs, pace, present };
