import { recordLoads } from '../../../../scripts/record-loads.mjs';

// The hook registers first, so it sees every plugin module this invocation loads.
// The entry module reads the argv the harness supplied, so the application runs as it always does.
await recordLoads();
await import('../../dist/src/main.js');
