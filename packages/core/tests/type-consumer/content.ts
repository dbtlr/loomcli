import { Application, Command } from '@loomcli/core';
import type { ActionHandler, Content } from '@loomcli/core';
import { z } from 'zod';

const files = new Command('files')
  .argument('files', { max: 3, min: 1, stdin: true, type: 'content', variadic: true })
  .option('document', { required: true, type: 'content' });
const read: ActionHandler<typeof files> = ({ args, options }) => {
  const sources: Content[] = args.files;
  const document: Content = options.document;
  return { document, sources };
};
files.action(read);

new Application('events')
  .stdin({ required: true })
  .option('quiet', { type: 'boolean' })
  .rows<string>({ views: {} })
  .action(({ stdin }) => stdin.stream());

new Command('events').stdin({ required: true }).action(({ stdin }) => stdin.text());
new Command('optional').stdin({ required: false }).action(({ stdin }) => {
  const source: Content | undefined = stdin;
  return source;
});

// @ts-expect-error TS2345: Content inputs reject defaults.
new Command('bad').argument('file', { default: 'input.txt', type: 'content' });
// @ts-expect-error TS2345: Content inputs use native source preparation, not a custom validator.
new Command('bad').option('file', { type: 'content', validate: z.string() });
// @ts-expect-error TS2345: Content inputs are local to the Command that reads them.
new Application('bad').globalOption('file', { type: 'content' });
// @ts-expect-error TS2345: Source count bounds belong to collections.
new Command('bad').argument('file', { min: 1, type: 'content' });
