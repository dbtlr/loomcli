---
description: "The author guide, built one running-pace calculator at a time. A placeholder until the chapters land."
---

# Author guide

This page is a placeholder. It holds one block of each kind the guide binds to a real file, so the binding check has something to verify.

The whole application of the first chapter:

<!-- example: ../../examples/guide/src/01-first-application/application.ts -->
```ts
import { Application } from '@loomcli/core';

export const pace = new Application('pace', { description: 'Work out a running pace.' })
  .option('time', { description: 'The time the run took, such as 25:30.', type: 'string' })
  // #region action
  .action(async ({ options, out }) => {
    await out.print(`time: ${options.time ?? 'not given'}`);
  });
// #endregion
```

Its action alone:

<!-- example: ../../examples/guide/src/01-first-application/application.ts#action -->
```ts
.action(async ({ options, out }) => {
  await out.print(`time: ${options.time ?? 'not given'}`);
});
```

Running it:

<!-- transcript: ../../examples/guide/transcripts/01-first-application/with-time.txt -->
```console
$ pace --time 5:30
time: 5:30
```
