import { Application } from '@loom/core';

const metric = 'metric';
const files = 'files';
new Application('literal-constants')
  .option(metric, { type: 'string' })
  .argument(files, { required: true, variadic: true })
  .action(({ args, options }) => {
    const paths: string[] = args.files;
    const selected: string | undefined = options.metric;
    return { paths, selected };
  });

declare const dynamic: string;
declare const union: 'left' | 'right';
declare const pattern: `prefix-${string}`;
declare const numericPattern: `${number}`;

// @ts-expect-error TS2345: A widened name cannot define a known option key.
new Application('dynamic-option').option(dynamic, { type: 'boolean' });
// @ts-expect-error TS2345: A union declares one option, not both possible keys.
new Application('union-option').option(union, { type: 'boolean' });
// @ts-expect-error TS2345: An open template does not identify one option key.
new Application('pattern-option').option(pattern, { type: 'boolean' });
// @ts-expect-error TS2345: A numeric template does not identify one option key.
new Application('numeric-option').option(numericPattern, { type: 'boolean' });
// @ts-expect-error TS2345: A widened name cannot define a known argument key.
new Application('dynamic-argument').argument(dynamic, { required: true, variadic: true });
// @ts-expect-error TS2345: A union declares one argument, not both possible keys.
new Application('union-argument').argument(union, { required: true, variadic: true });
// @ts-expect-error TS2345: An open template does not identify one argument key.
new Application('pattern-argument').argument(pattern, { required: true, variadic: true });
// @ts-expect-error TS2345: A numeric template does not identify one argument key.
new Application('numeric-argument').argument(numericPattern, { required: true, variadic: true });

// @ts-expect-error TS2345: Explicit type parameters cannot claim two option keys.
new Application('explicit-union-option').option<'left' | 'right', { type: 'boolean' }>('left', {
  type: 'boolean',
});
interface RequiredFiles {
  required: true;
  variadic: true;
}
const explicit = new Application('explicit-union-argument');
// @ts-expect-error TS2345: Explicit type parameters cannot claim two argument keys.
explicit.argument<'left' | 'right', RequiredFiles>('left', { required: true, variadic: true });
