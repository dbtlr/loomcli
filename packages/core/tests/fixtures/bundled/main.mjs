import { Application, Command, pad } from '@loomcli/core';

// The application each bundler bundles with no define, so nothing bakes release facts into it.
// `measure` pads wide, combining, and emoji text, so it reads core's Unicode tables.
// It prints the build last, which reads source, as the source run does.
// `fail` throws a foreign error, which a source build reports as its Developer Diagnostic.
await new Application('bundled', { description: 'Measure bundled text.' })
  .command(
    new Command('measure', { description: 'Pad text to its width.' }).action(({ host, out }) => {
      for (const text of ['日本', 'é', '👩‍💻', '🇯🇵', 'abc']) {
        out.print(`${pad(text, 6)}|`);
      }
      out.print(host.release.build);
    }),
  )
  .command(
    new Command('fail', { description: 'Throw a foreign error.' }).action(() => {
      throw new TypeError('The bundle failed.');
    }),
  )
  .run({ host: { argv: process.argv.slice(2) } });
