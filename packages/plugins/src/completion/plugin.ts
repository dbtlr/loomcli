import type { Writable } from 'node:stream';

import { Command, locate, plugin } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';

import Package from '../../package.json' with { type: 'json' };
import { answer } from './answer.js';
import { bashScript } from './bash.js';
import { fishScript } from './fish.js';
import { zshScript } from './zsh.js';

/**
 * Writes the whole text in one write and settles when the stream took it. The text goes to the
 * host's stdout as it is, because `out` styles text and appends a newline.
 */
function writeExactly(stream: Writable, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(text, (failure) => {
      if (failure) {
        reject(failure);
      } else {
        resolve();
      }
    });
  });
}

/** One child that prints the script its shell sources, for the application it is installed in. */
function shellCommand(name: string, shell: string, script: (application: string) => string) {
  return new Command(name, { description: `Print the ${shell} completion script.` }).action(
    ({ graph, host }) => writeExactly(host.stdout, script(graph.name)),
  );
}

// The words arrive after a bare `--`, so the pre-scan never reads one of them as an option.
const answerCommand = new Command('__complete', {
  description: 'Answer a completion script.',
  hidden: true,
}).action(({ graph, host, passthrough }) =>
  writeExactly(host.stdout, answer(graph, locate(graph, passthrough))),
);

// This package compiles outside any Application's registration, so the Command requires no globals.
const completionCommand = new Command('completion', {
  description: 'Print a shell completion script.',
})
  .command(shellCommand('bash', 'Bash', bashScript))
  .command(shellCommand('zsh', 'Zsh', zshScript))
  .command(shellCommand('fish', 'Fish', fishScript))
  .command(answerCommand);

/**
 * A plugin that prints Bash, Zsh, and Fish completion scripts and answers them. Its whole
 * contribution is the `completion` Command; it declares no option, middleware, or extension.
 */
export function completion(): Plugin {
  return plugin(`${Package.name}/completion`, { commands: [completionCommand] });
}
