import { Application, Command } from '@loom/core';
import type { ArgumentConfig, ScalarArgument } from '@loom/core';
import { z } from 'zod';

const size = z.string().transform(Number);
const optional = {} satisfies ScalarArgument;
const defaulted = { default: '10', validate: size } satisfies ArgumentConfig;

new Command('optional')
  .argument('name', { required: true })
  .argument('path', optional)
  .action(({ args }) => {
    const name: string = args.name;
    const path: string | undefined = args.path;
    // @ts-expect-error TS2322: An omitted optional argument has no value.
    const certain: string = args.path;
    return { certain, name, path };
  });

new Application('defaults').argument('size', defaulted).action(({ args }) => {
  const bytes: number = args.size;
  return bytes;
});

new Command('validated')
  .argument('size', { required: false, validate: size })
  .action(({ args }) => {
    const value: number | undefined = args.size;
    // @ts-expect-error TS2322: A validated optional argument keeps its omission.
    const certain: number = args.size;
    return { certain, value };
  });

// @ts-expect-error TS2345: A required argument declares no default.
new Command('bad').argument('path', { default: '10', required: true });
new Command('ok').argument('path', { default: 'a' });
// @ts-expect-error TS2322: An unvalidated argument default is a string.
new Command('bad').argument('path', { default: 0 });
// @ts-expect-error TS2345: A variadic argument stays required.
new Command('bad').argument('files', { required: false, variadic: true });
