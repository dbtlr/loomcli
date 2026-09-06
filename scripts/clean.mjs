import { rm } from 'node:fs/promises';

await Promise.all(
  ['packages/core/dist', 'examples/textstat/dist', 'examples/jsonkit/dist'].map((path) =>
    rm(new URL(`../${path}`, import.meta.url), { force: true, recursive: true }),
  ),
);
