import { PassThrough } from 'node:stream';
import { ReadStream } from 'node:tty';

import { inBackgroundJob } from '../../dist/process-handle.js';

/**
 * Whether the background query's foreground check counts each stdin as a background job. The test
 * starts this fixture in a session of its own, which no terminal controls, so a check that runs
 * finds no foreground job to belong to. A terminal stream other than `process.stdin` stands for one
 * opened on `/dev/tty`; a scripted stream is no terminal at all.
 */
const read = {
  scripted: inBackgroundJob(new PassThrough()),
  terminal: inBackgroundJob(Object.create(ReadStream.prototype)),
};
process.stdout.write(`${JSON.stringify(read)}\n`);
