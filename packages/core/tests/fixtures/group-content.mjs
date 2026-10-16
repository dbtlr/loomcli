import { Application } from '../../dist/index.js';

const [kind, ...argv] = process.argv.slice(2);
const declaration = new Application('groups', { description: 'Groups probe.' })
  .option('file', { description: 'Read a file or stdin.', stdin: true, type: 'content' })
  .option('url', { description: 'Read a URL.', type: 'string' });
const app = declaration[kind]('file', 'url').action(({ options, out }) =>
  out.print(options.file?.kind ?? 'absent'),
);
process.exitCode = await app.run({ host: { argv, env: {} } });
