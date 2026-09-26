import { Application } from '@loomcli/core';
import { integer, oneOf, port, text } from '@loomcli/validators';

// The packed catalog validates, transforms, and types each option the way the reference states.
const app = new Application('validators')
  .option('port', { default: '8080', type: 'string', validate: port() })
  .option('mode', { default: 'dev', type: 'string', validate: oneOf(['dev', 'prod']) })
  .option('workers', { type: 'string', validate: integer({ max: 64, min: 1 }) })
  .option('tag', { multiple: true, type: 'string', validate: text({ maxLength: 8 }) })
  .action(({ options, out }) => {
    const listen: number = options.port;
    const mode: 'dev' | 'prod' = options.mode;
    const workers: number | undefined = options.workers;
    const tags: string[] = options.tag;
    return out.print(JSON.stringify({ listen, mode, tags, workers }));
  });

await app.run({ host: { argv: process.argv.slice(2) } });
