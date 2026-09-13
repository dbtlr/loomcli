import { Writable } from 'node:stream';

import { Application, Command } from '@loomcli/core';

const dispatch = ({ out }) => out.print('dispatched');
const leaf = (name) => new Command(name).action(dispatch);

// One value sits in two Applications, and two distinct values share a name under two parents.
// Every graph here is a tree, so every build must succeed, however often it runs.
const shared = leaf('clear');
const first = new Application('tree-first')
  .globalOption('file', { short: 'f', type: 'string' })
  .command(new Command('cache').command(shared))
  .action(dispatch);
const second = new Application('tree-second')
  .globalOption('file', { short: 'f', type: 'string' })
  .command(new Command('cache').command(leaf('clear')))
  .command(new Command('store').command(leaf('clear')))
  .command(new Command('extra').command(shared))
  .action(dispatch);

const lines = [];
const errors = [];
const capture = (into) =>
  new Writable({
    write(chunk, _encoding, callback) {
      into.push(chunk.toString().trim());
      callback();
    },
  });
const stdout = capture(lines);
const stderr = capture(errors);

const codes = [];
first.inspect();
first.inspect();
codes.push(await first.run({ host: { argv: ['cache', 'clear'], stderr, stdout } }));
codes.push(await first.run({ host: { argv: ['cache', 'clear'], stderr, stdout } }));
codes.push(await second.run({ host: { argv: ['cache', 'clear'], stderr, stdout } }));
codes.push(await second.run({ host: { argv: ['store', 'clear'], stderr, stdout } }));
codes.push(await second.run({ host: { argv: ['extra', 'clear'], stderr, stdout } }));
second.inspect();
process.stdout.write(`${JSON.stringify({ codes, errors, lines })}\n`);
