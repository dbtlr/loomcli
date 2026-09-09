import { Application, Command, GlobalOptions } from '@loomcli/core';

const dispatch = ({ out }) => out.print('dispatched');

/**
 * Each scenario declares a fact, changes the object it declared with, and then builds. A captured
 * fact reports the value the constructor read, so the later change reaches nothing.
 */
const scenarios = {
  'application-description': () => {
    const options = { description: 'One.' };
    const app = new Application('capture', options).action(dispatch);
    options.description = 'Two.';
    return app.inspect().description;
  },
  'application-version': () => {
    const options = { version: '1.2.0' };
    const app = new Application('capture', options).action(dispatch);
    options.version = '9.9.9';
    return app.inspect().version;
  },
  'command-blanked': () => {
    const globals = new GlobalOptions();
    const options = { description: 'One.', globals };
    const get = new Command('get', options).action(dispatch);
    const app = new Application('capture', { globals }).command(get).action(dispatch);
    options.description = '   ';
    return app.inspect().root.children[0].description;
  },
  'command-description': () => {
    const globals = new GlobalOptions();
    const options = { description: 'One.', globals };
    const get = new Command('get', options).action(dispatch);
    const app = new Application('capture', { globals }).command(get).action(dispatch);
    options.description = 'Two.';
    return app.inspect().root.children[0].description;
  },
};

process.stdout.write(`${JSON.stringify(scenarios[process.argv[2]]())}\n`);
