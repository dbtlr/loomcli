import { Application, Command, override, UnknownCommandError } from '@loomcli/core';

import { unknownCommand } from '../../dist/src/views.js';

/**
 * A parent whose every child is hidden, so a routing failure there offers no candidate and the
 * application's own view ends its line after the first clause. jsonkit itself advertises
 * children, so this fixture is where the empty case reaches the view it ships.
 */
const debug = new Command('debug', {
  description: 'Dump the parsed document.',
  hidden: true,
}).action(({ out }) => out.print('debug'));

const application = new Application('jsonkit', {
  views: [override(UnknownCommandError, unknownCommand)],
}).command(debug);

process.exitCode = await application.run({ host: { argv: ['nope'] } });
