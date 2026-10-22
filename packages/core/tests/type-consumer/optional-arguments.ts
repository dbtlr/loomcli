import { Application, Command } from '@loomcli/core';
import type { ArgumentConfig, ScalarArgument } from '@loomcli/core';
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

new Command('tail').argument('files', { required: false, variadic: true }).action(({ args }) => {
  const files: string[] = args.files;
  return files;
});

new Command('validated-tail')
  .argument('files', {
    validate: z.string().transform((file) => file.length),
    variadic: true,
  })
  .action(({ args }) => {
    const counts: number[] = args.files;
    return counts;
  });

new Command('defaulted-tail').argument('files', { default: ['a'], variadic: true });
// @ts-expect-error TS2322: An unvalidated variadic default is a string array.
new Command('bad').argument('files', { default: 'a', variadic: true });

// Core reads only the keys ArgumentConfig declares, so every declarer rejects any other at the call.
// @ts-expect-error TS2345: A Command argument takes no hidden fact.
new Command('bad').argument('path', { description: 'd', hidden: true });
// @ts-expect-error TS2345: A Command argument takes no deprecated fact.
new Command('bad').argument('path', { deprecated: 'm', description: 'd' });
// @ts-expect-error TS2345: A Command argument takes no multiple key.
new Command('bad').argument('path', { description: 'd', multiple: true });
// @ts-expect-error TS2345: A Command argument takes no env key.
new Command('bad').argument('path', { description: 'd', env: 'PATH_VALUE' });
// @ts-expect-error TS2345: A Command argument takes no control key.
new Command('bad').argument('path', { control: true, description: 'd' });
// @ts-expect-error TS2353: A config that holds only a deprecated fact is no argument config.
new Command('bad').argument('path', { deprecated: 'm' });
// @ts-expect-error TS2345: An Application argument takes no hidden fact.
new Application('bad').argument('path', { description: 'd', hidden: true });
// @ts-expect-error TS2345: An Application argument takes no deprecated fact.
new Application('bad').argument('path', { deprecated: 'm', description: 'd' });
// @ts-expect-error TS2345: An Application argument takes no multiple key.
new Application('bad').argument('path', { description: 'd', multiple: true });
// @ts-expect-error TS2345: An Application argument takes no env key.
new Application('bad').argument('path', { description: 'd', env: 'PATH_VALUE' });
// @ts-expect-error TS2345: An Application argument takes no control key.
new Application('bad').argument('path', { control: true, description: 'd' });
// @ts-expect-error TS2353: A config that holds only a deprecated fact is no argument config.
new Application('bad').argument('path', { deprecated: 'm' });
// @ts-expect-error TS2345: A variadic argument takes no hidden fact.
new Command('bad').argument('files', { hidden: true, variadic: true });
// @ts-expect-error TS2345: A content argument takes no deprecated fact.
new Command('bad').argument('body', { deprecated: 'm', type: 'content' });

// An ordinary config keeps its inferred value type.
new Command('plain').argument('path', { description: 'd' }).action(({ args }) => {
  const path: string | undefined = args.path;
  return path;
});
new Application('plain')
  .argument('path', { description: 'd', required: true })
  .action(({ args }) => {
    const path: string = args.path;
    return path;
  });

// Every key ArgumentConfig declares still compiles.
new Command('full')
  .argument('first', { description: 'd', extensions: [], required: true })
  .argument('second', { default: 'a', type: 'string', validate: z.string() })
  .argument('third', { required: false, validate: z.string().optional(), validateOmitted: true })
  .argument('rest', { type: 'string', variadic: true });
new Command('content').argument('body', {
  max: 2,
  min: 1,
  stdin: true,
  type: 'content',
  variadic: true,
});
