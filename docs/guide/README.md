---
description: "The author guide, built one running-pace calculator at a time. A placeholder until the chapters land."
---

# Author guide

This page is a placeholder. It holds one block of each kind the guide binds to a real file, so the binding check has something to verify.

The whole application of the first chapter:

<!-- example: ../../examples/guide/src/01-first-application/application.ts -->
```ts
import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';

import { formatPace, paceOf, parseDistance, parseTime } from './pace.js';

export const pace = new Application('pace', {
  description: 'Work out the pace of a run from its distance and time.',
  plugins: [help(), version()],
})
  .argument('distance', {
    description: 'How far you ran, such as 10k, 5mi, 400m, half, or marathon.',
    required: true,
  })
  .argument('time', {
    description: 'How long the run took, as mm:ss or h:mm:ss.',
    required: true,
  })
  // #region action
  .action(({ args, out, style }) => {
    const metres =
      parseDistance(args.distance) ??
      out.fatal(
        `Cannot read the distance "${style.escape(args.distance)}". Write one such as 10k, 5mi, 400m, half, or marathon.`,
      );
    const seconds =
      parseTime(args.time) ??
      out.fatal(
        `Cannot read the time "${style.escape(args.time)}". Write it as mm:ss or h:mm:ss, such as 25:30.`,
      );
    return out.print(formatPace(paceOf(metres, seconds, 'km')));
  });
// #endregion
```

Its action alone:

<!-- example: ../../examples/guide/src/01-first-application/application.ts#action -->
```ts
.action(({ args, out, style }) => {
  const metres =
    parseDistance(args.distance) ??
    out.fatal(
      `Cannot read the distance "${style.escape(args.distance)}". Write one such as 10k, 5mi, 400m, half, or marathon.`,
    );
  const seconds =
    parseTime(args.time) ??
    out.fatal(
      `Cannot read the time "${style.escape(args.time)}". Write it as mm:ss or h:mm:ss, such as 25:30.`,
    );
  return out.print(formatPace(paceOf(metres, seconds, 'km')));
});
```

Running it:

<!-- transcript: ../../examples/guide/transcripts/01-first-application/calc.txt -->
```console
$ pace 10k 50:00
5:00 /km
```
