import { Application, validationContext, validationContextKey } from '@loom/core';
import type {
  InputIdentity,
  StandardSchemaV1,
  SuppliedInputs,
  ValidationContext,
} from '@loom/core';

const key: string = validationContextKey;
const identity: InputIdentity = { global: true, kind: 'option', name: 'mode' };
const inputs: SuppliedInputs = {
  args: { files: ['a', 'b'], name: 'one' },
  options: { flag: true, mode: 'fast', multi: ['a'], single: undefined },
};

/** Narrowing on the phase is the whole reading rule, so the compiler must enforce it. */
function describe(context: ValidationContext): string {
  if (context.phase === 'default') {
    // @ts-expect-error TS2339: The default phase carries no supplied inputs.
    context.supplied;
    return `${context.input.kind}:${context.input.name}:${context.host.cwd}`;
  }
  const command: readonly string[] = context.command;
  const passthrough: readonly string[] = context.passthrough;
  const supplied: SuppliedInputs = context.supplied;
  const global: boolean = context.input.global;
  return `${command.join(' ')}:${passthrough.length}:${String(supplied.args.name)}:${String(global)}`;
}

const types: { input: string[]; output: string[] } | undefined = undefined;
const reports: string[] = [];

new Application('context-types')
  .argument('files', {
    validate: {
      '~standard': {
        types,
        validate: (value: unknown, options?: StandardSchemaV1.Options) => {
          const context = validationContext(options);
          if (context) {
            reports.push(describe(context));
          }
          const output: string[] = Array.isArray(value) ? value.map(String) : [];
          return { value: output };
        },
        vendor: 'type-consumer',
        version: 1,
      },
    },
    variadic: true,
  })
  .action(({ args }) => {
    const files: string[] = args.files;
    return { files, identity, inputs, key, reports };
  });

// @ts-expect-error TS2322: An input identity names a declared kind.
const wrongKind: InputIdentity = { global: false, kind: 'flag', name: 'mode' };
// @ts-expect-error TS2322: A raw supplied argument is a string, a string array, or absent.
const wrongSupplied: SuppliedInputs = { args: { count: 1 }, options: {} };
export { wrongKind, wrongSupplied };
