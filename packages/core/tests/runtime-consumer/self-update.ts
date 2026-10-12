import { Application } from '@loomcli/core';
import { selfUpdate } from '@loomcli/plugins/self-update';
import type { AfterReplaceContext } from '@loomcli/plugins/self-update';

// The packed self-update plugin compiles against its declaration, `afterReplace` and its context
// Included. A run with no release asset refuses before any request, so the check needs no network.
const restarted: AfterReplaceContext['current'][] = [];

const app = new Application('packed-update', {
  plugins: [selfUpdate({ afterReplace: ({ current }) => void restarted.push(current) })],
});

process.exitCode = await app.run({
  host: { argv: ['self-update'], platform: 'linux', release: { build: 'distributed' } },
});
