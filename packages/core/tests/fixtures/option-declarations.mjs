import { Application } from '@loomcli/core';

import { declare } from './declare.mjs';

const scenario = process.argv[2];

/** The one faulty option declaration each scenario makes, which throws from its own call. */
function build() {
  let app = new Application('declarations');
  switch (scenario) {
    case 'duplicate-key': {
      app = app.option('total', { type: 'string' }).option('total', { type: 'boolean' });
      break;
    }
    case 'duplicate-short': {
      app = app
        .option('total', { short: 't', type: 'boolean' })
        .option('trace', { short: 't', type: 'boolean' });
      break;
    }
    case 'negative-collision': {
      app = app
        .option('total', { polarity: 'both', type: 'boolean' })
        .option('no-total', { type: 'string' });
      break;
    }
    case 'invalid-name': {
      app = app.option('bad=name', { type: 'string' });
      break;
    }
  }
  return app.action(({ out }) => out.print('dispatched'));
}

const app = declare(build);
process.stdout.write('assembled\n');
const code = await app.run({ host: { argv: ['--unknown'], release: { build: 'distributed' } } });
process.stdout.write(`resolved:${code}\n`);
