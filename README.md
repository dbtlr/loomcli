---
description: Build and run the first Loom CLI example and verify its public package.
---

# Loom CLI

Loom CLI is a TypeScript framework for command applications. The first increment runs an unnamed Command with required file arguments.

## Run textstat

Install dependencies and build the core package and example:

```sh
pnpm install --frozen-lockfile
pnpm build
node examples/textstat/dist/main.js README.md
```

Each output line contains a byte count, a tab, and the supplied file path. The example reads files in argument order.

The same built application runs with Bun:

```sh
bun examples/textstat/dist/main.js README.md
```

The [example declaration](examples/textstat/src/application.ts) imports the built `@loom/core` package. Its [separate action](examples/textstat/src/count-files.ts) derives argument types from that declaration.

## Verify the package

```sh
pnpm verify
```

This command builds ESM and declarations, checks source, tests a packed declaration consumer, and runs process integration tests with Node.

To run the process cases with Bun in a POSIX shell:

```sh
LOOM_TEST_RUNTIME=bun pnpm test
```

In PowerShell, set `$env:LOOM_TEST_RUNTIME = 'bun'` before `pnpm test`.

CI tests Node 22.23.2 and Bun 1.4.0 on macOS, Linux, and Windows. These versions define the compatibility baseline for this increment. TypeScript 7.0.2 checks emitted declarations with strict NodeNext resolution. Earlier versions are unverified.

The [core reference](docs/core.md) defines invocation, output, and failure behavior.
