import { Application, Command } from '@loomcli/core';

import { scenario } from './scenario.mjs';

export async function run(words) {
  const fixture = scenario();
  const [kind, ...tail] = words;
  let app = undefined;
  let argv = tail;
  if (kind === 'copy') {
    app = new Application('copy')
      .argument('src', { required: true, variadic: true })
      .argument('dest', { required: true })
      .action(({ args, out }) => out.print(JSON.stringify(args)));
  } else if (kind === 'wrapper') {
    app = new Application('wrapper')
      .argument('path', {})
      .passthrough()
      .action(({ passthrough, out }) => out.print(JSON.stringify(passthrough)));
  } else if (kind === 'group') {
    app = new Application('group').command(new Command('leaf').action(() => {}));
  } else {
    app = new Application('rm')
      .argument('path', { required: true })
      .action(({ args, out }) => out.print(JSON.stringify(args)));
    argv = words;
  }
  await app.run({ process: fixture.createProcess({ argv }) });
  return fixture.result();
}
