import { Application, FatalError } from '@loom/core';

const scenario = process.argv[2];
let app = new Application('fixture');
switch (scenario) {
  case 'duplicate': {
    app = app
      .argument('files', { required: true, variadic: true })
      .argument('files', { required: true, variadic: true });
    break;
  }
  case 'competing': {
    app = app
      .argument('files', { required: true, variadic: true })
      .argument('extras', { required: true, variadic: true });
    break;
  }
  case 'multiple-actions': {
    app.action(() => {
      throw new Error('Dispatched the first action.');
    });
    break;
  }
  case 'required': {
    app = app.argument('files', { required: true, variadic: true });
    break;
  }
}
if (scenario !== 'actionless') {
  app.action(({ out }) => {
    if (scenario === 'fatal') {
      out.fatal('Expected failure.');
    }
    if (scenario === 'throw-fatal') {
      throw new FatalError('Expected failure.');
    }
    if (scenario === 'unexpected') {
      throw new Error('Unexpected failure.');
    }
    if (scenario === 'unknown-throw') {
      throw null;
    }
    if (scenario === 'caught-fatal') {
      try {
        out.fatal('Caught failure.');
      } catch (error) {
        if (!(error instanceof FatalError)) {
          throw error;
        }
      }
    }
    out.print('dispatched');
  });
}
process.stdout.write('assembled\n');
const code = await app.run({ host: { argv: process.argv.slice(3) } });
process.stdout.write(`resolved:${code}\n`);
