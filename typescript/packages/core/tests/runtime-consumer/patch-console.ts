import { Application } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';
import { patchConsole } from '@loomcli/plugins/patch-console';
import { mockProcess } from '@loomcli/testing';

// The packed patch-console plugin routes a console.log made while a frame is drawn to the run's stdout.
const installed: Plugin = patchConsole();
const original = console.log;
const mock = mockProcess({ terminal: { columns: 80, rows: 24, streams: ['stderr'] } });

const app = new Application('packed-patch-console', { plugins: [installed] }).action(
  async ({ out }) => {
    const region = out.region();
    await region.draw('frame', { render: (text: string) => text });
    console.log('routed');
    await region.end();
  },
);

const code = await app.run({ process: mock });
process.stdout.write(`${code} ${console.log === original} ${mock.stdout.text}`);
