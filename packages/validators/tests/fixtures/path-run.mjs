import { Application } from '@loomcli/core';
import { path } from '@loomcli/validators';

/**
 * One run of an application whose `--target` option validates with `path()`.
 * The arguments are the factory options as JSON, the host override's cwd and platform, then argv.
 */
const [declared, cwd, platform, ...argv] = process.argv.slice(2);

const app = new Application('probe')
  .option('target', { type: 'string', validate: path(JSON.parse(declared)) })
  .action(({ options, out }) => out.print(JSON.stringify(options.target)));

process.exitCode = await app.run({ host: { argv, cwd, platform } });
