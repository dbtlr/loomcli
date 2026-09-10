import { Application, Command, renderFailure, UnknownCommandError } from '@loomcli/core';

import { unknownCommand } from '../../dist/src/failures.js';

/**
 * A parent whose every child is hidden, so a routing failure there offers no candidate and the
 * application's own renderer ends its line after the first clause. jsonkit itself advertises
 * children, so this fixture is where the empty case reaches the renderer it ships.
 */
const debug = new Command('debug', {
  description: 'Dump the parsed document.',
  hidden: true,
}).action(({ out }) => out.print('debug'));

const application = new Application('jsonkit', {
  failures: [renderFailure(UnknownCommandError, unknownCommand)],
}).command(debug);

process.exitCode = await application.run({ host: { argv: ['nope'] } });
