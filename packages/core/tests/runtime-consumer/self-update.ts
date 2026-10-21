import { Application } from '@loomcli/core';
import { selfUpdate } from '@loomcli/plugins/self-update';
import type { AfterReplaceContext, NoticeSettings } from '@loomcli/plugins/self-update';

// The packed self-update plugin compiles against its declaration, `afterReplace` and its context
// Included, and `notices` as NoticeSettings. A run with no release asset refuses before any
// Request, so the check needs no network.
const restarted: AfterReplaceContext['current'][] = [];
const notices: NoticeSettings = { env: 'PACKED_UPDATE_NO_NOTICE' };

const app = new Application('packed-update', {
  plugins: [selfUpdate({ afterReplace: ({ current }) => void restarted.push(current), notices })],
});

process.exitCode = await app.run({
  host: { argv: ['self-update'], platform: 'linux' },
});
