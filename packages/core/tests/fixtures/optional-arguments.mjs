import { Application, Command } from '@loomcli/core';
import { z } from 'zod';

const [scenario, ...argv] = process.argv.slice(2);
const digits = z.string().regex(/^\d+$/u, 'Use decimal digits.').transform(Number);
let calls = 0;
const counting = (inner) => ({
  '~standard': {
    validate: (value) => {
      calls += 1;
      return inner['~standard'].validate(value);
    },
    vendor: 'fixture',
    version: 1,
  },
});
const report = ({ args, passthrough, out }) => out.print(JSON.stringify({ args, passthrough }));
const strings = z.array(z.string());

let app = undefined;
switch (scenario) {
  case 'optional': {
    app = new Application('optional')
      .argument('path', {})
      .action(({ args, out }) =>
        out.print(JSON.stringify({ absent: args.path === undefined, args })),
      );
    break;
  }
  case 'default':
  case 'invalid-default': {
    app = new Application('optional')
      .argument('path', { default: scenario === 'default' ? '10' : 'bad', validate: digits })
      .action(report);
    break;
  }
  case 'schema': {
    app = new Application('optional')
      .argument('path', { validate: counting(z.string().min(1, 'Supply a path.')) })
      .action(({ args, out }) => out.print(JSON.stringify({ args, calls })));
    break;
  }
  case 'pair': {
    app = new Application('optional')
      .argument('name', { required: true })
      .argument('path', { required: false })
      .action(report);
    break;
  }
  case 'optional-first': {
    const keys = new Command('keys')
      .argument('path', {})
      .argument('name', { required: true })
      .action(report);
    app = new Application('optional').command(keys).action(report);
    break;
  }
  case 'after-optional': {
    app = new Application('optional').argument('path', {}).argument('extra', {}).action(report);
    break;
  }
  case 'tail': {
    app = new Application('optional')
      .argument('files', { validate: counting(strings), variadic: true })
      .action(({ args, out }) => out.print(JSON.stringify({ args, calls })));
    break;
  }
  case 'tail-default': {
    app = new Application('optional')
      .argument('files', { default: ['a'], variadic: true })
      .action(({ args, out }) => {
        args.files.push('x');
        return out.print(JSON.stringify({ args }));
      });
    break;
  }
  case 'tail-required': {
    app = new Application('optional')
      .argument('files', { required: true, variadic: true })
      .action(report);
    break;
  }
  case 'tail-raw-default': {
    app = new Application('optional')
      .argument('files', { default: 'a', variadic: true })
      .action(report);
    break;
  }
  case 'tail-invalid-default': {
    app = new Application('optional')
      .argument('files', { default: ['bad'], validate: z.array(digits), variadic: true })
      .action(report);
    break;
  }
  default: {
    throw new Error(`Unknown scenario: ${scenario}`);
  }
}
await app.run({ host: { argv } });
// A second run proves each invocation receives its own copy of a declared array default.
if (scenario === 'tail-default') {
  await app.run({ host: { argv } });
}
