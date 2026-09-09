import { rm } from 'node:fs/promises';

await Promise.all(
  [
    'apps/loom/dist',
    'packages/core/dist',
    'examples/explain/dist',
    'examples/textstat/dist',
    'examples/jsonkit/dist',
  ].map((path) => rm(new URL(`../${path}`, import.meta.url), { force: true, recursive: true })),
);
