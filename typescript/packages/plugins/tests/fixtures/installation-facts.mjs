import { Application, Command, processHandle } from '@loomcli/core';

const [path, kind, platform] = process.argv.splice(2, 3, 'facts');
if (kind === 'bundle') {
  process.argv[1] = path;
} else if (kind !== 'program') {
  process.execPath = path;
}
Reflect.set(globalThis, '__LOOM_RELEASE__', {
  build: 'distributed',
  ...(kind === 'compiled' ? { compiled: true } : {}),
  release: {
    ...(kind === 'binary' ? { asset: 'notes-linux-x64' } : {}),
    repository: 'acme/notes',
    version: '1.5.0',
  },
});

const notes = new Application('notes', { description: 'Read installation facts.' }).command(
  new Command('facts', { description: 'Print the installation.' }).action(({ host, out }) =>
    out.print(JSON.stringify(host.release.installation ?? null)),
  ),
);

process.exitCode = await notes.run({
  process: processHandle({
    ceiling: process.cwd(),
    ...(platform === undefined ? {} : { platform }),
    ...(kind === 'program' ? { program: [process.execPath, path] } : {}),
  }),
});
