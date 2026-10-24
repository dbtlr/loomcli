import { Application, processHandle } from '@loomcli/core';

import { list } from './modules/list.mjs';

// The imported module throws while it evaluates, so nothing below runs.
process.stdout.write('imported\n');
await new Application('app').command(list).run({ process: processHandle({ argv: ['list'] }) });
