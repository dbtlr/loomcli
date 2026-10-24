import { Application, processHandle } from '@loomcli/core';

const config = { polarity: 'negative', short: 'n', type: 'boolean' };
const base = new Application('state')
  .option('enabled', config)
  .option('__proto__', { type: 'string' })
  .option('dryRun', { type: 'boolean' });
config.polarity = 'positive';
config.short = 'x';

const left = base.option('left', { short: 'l', type: 'boolean' });
const right = base.option('right', { short: 'l', type: 'boolean' });

function report({ options, passthrough, out }) {
  out.print(JSON.stringify({ options, passthrough }));
  options.enabled = false;
  passthrough.push('action mutation');
}
const first = left.action(report);
const second = right.action(report);
await first.run({
  process: processHandle({
    argv: ['-nl', '--__proto__=safe', '--dryRun', '--', '--', '', 'two words'],
  }),
});
await first.run({ process: processHandle({ argv: [] }) });
await second.run({ process: processHandle({ argv: ['-l'] }) });
