import { Application, Command } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import type { MockFields, MockProcess, RecordingStream } from '@loomcli/testing';

// The packed testing package runs an Application on a mock process and reads what it wrote.
const app = new Application('packed-mock').command(
  new Command('get').action(({ host, out }) => out.print(`got ${host.cwd}`)),
);
const fields: MockFields = { argv: ['get'], cwd: '/packed' };
const mock: MockProcess = mockProcess(fields);
const stdout: RecordingStream = mock.stdout;

const code = await app.run({ process: mock });
process.stdout.write(`${code} ${mock.exitCode} ${stdout.text}`);
