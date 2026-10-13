import { Application, Command } from '@loomcli/core';
import { service } from '@loomcli/plugins/service';
import type { ProbeContext, ServiceDetail, ServiceStatus } from '@loomcli/plugins/service';

// The packed service plugin compiles against its declaration, the probe and its context included.
// A run on a platform with neither manager refuses before it reads or runs anything.
const probe = ({ state }: ProbeContext): readonly ServiceDetail[] => [
  { name: 'state', value: state.state },
];
const reported: ServiceStatus['details'] = [];

const app = new Application('packed-service', {
  description: 'Serve from the packed plugin.',
  plugins: [service({ label: 'com.acme.packed', probe, run: ['serve'] })],
}).command(
  new Command('serve', { description: 'Serve.' }).action(({ out }) =>
    out.print(`serving ${reported.length}`),
  ),
);

process.exitCode = await app.run({
  host: { argv: ['service', 'status'], platform: 'win32', release: { build: 'distributed' } },
});
