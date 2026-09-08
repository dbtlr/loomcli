import { Application } from '@loomcli/core';

const scenario = process.argv[2];
let app = new Application('declarations');
switch (scenario) {
  case 'nonstring-name': {
    app = app.option(1, { type: 'boolean' });
    break;
  }
  case 'symbol-short': {
    app = app.option('flag', { short: Symbol('f'), type: 'boolean' });
    break;
  }
  case 'nonboolean-short-only': {
    app = app.option('flag', { short: 'f', shortOnly: 'false', type: 'boolean' });
    break;
  }
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
  case 'missing-short': {
    app = app.option('metric', { shortOnly: true, type: 'string' });
    break;
  }
  case 'both-short-only': {
    app = app.option('total', { polarity: 'both', short: 't', shortOnly: true, type: 'boolean' });
    break;
  }
  case 'string-polarity': {
    app = app.option('metric', { polarity: 'negative', type: 'string' });
    break;
  }
  case 'invalid-short': {
    app = app.option('metric', { short: 'mm', type: 'string' });
    break;
  }
  case 'invalid-name': {
    app = app.option('bad=name', { type: 'string' });
    break;
  }
  case 'invalid-type': {
    app = app.option('metric', { type: 'number' });
    break;
  }
  case 'invalid-polarity': {
    app = app.option('total', { polarity: 'unknown', type: 'boolean' });
    break;
  }
}
app = app.action(({ out }) => out.print('dispatched'));
process.stdout.write('assembled\n');
const code = await app.run({ host: { argv: ['--unknown'] } });
process.stdout.write(`resolved:${code}\n`);
