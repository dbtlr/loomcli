import { Application, Command, GlobalOptions } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand, helpInput } from '@loomcli/plugins/help/extension';

const dispatch = ({ out }) => out.print('dispatched');

/** One application whose only fault is the help extension value the scenario names. */
const scenarios = {
  'blank-details': () =>
    new Application('app', {
      extensions: [helpCommand({ details: 'one\n\ntwo' })],
      plugins: [help()],
    }).action(dispatch),
  'example-line': () => {
    const get = new Command('get', {
      extensions: [helpCommand({ examples: [{ command: 'get\none' }] })],
    }).action(dispatch);
    return new Application('app', { plugins: [help()] }).command(get).action(dispatch);
  },
  'placeholder-whitespace': () =>
    new Application('app', {
      globals: new GlobalOptions().option('file', {
        extensions: [helpInput({ placeholder: 'a path' })],
        type: 'string',
      }),
      plugins: [help()],
    }).action(dispatch),
};

const [name, ...argv] = process.argv.slice(2);

process.exitCode = await scenarios[name]().run({ host: { argv } });
