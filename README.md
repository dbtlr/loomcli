---
description: Build and run textstat with local options and verify the public Loom CLI package.
---

# Loom CLI

Loom CLI is a TypeScript framework for command applications. The current increment runs an unnamed Command with required file arguments, local options, and passthrough.

## Run textstat

Install dependencies and build the core package and example:

```sh
pnpm install --frozen-lockfile
pnpm build
node examples/textstat/dist/main.js README.md
```

Each output line contains a count, a tab, and the supplied file path. The example reads files in argument order. Bytes are the default metric.

To count words and add a combined total:

```sh
node examples/textstat/dist/main.js --metric words --total README.md docs/core.md
node examples/textstat/dist/main.js -tm words README.md docs/core.md
```

`--metric` accepts `bytes`, `words`, or `lines`. Bytes count file bytes. Words are runs of non-whitespace characters after UTF-8 decoding, using JavaScript whitespace rules. Lines count LF characters; an unterminated final line adds no LF. Empty files count as zero for every metric.

`--total` or `-t` appends a `count<TAB>total` row, including for one file. Unsupported metrics fail before file access. A read error retains earlier output and prevents the final total.

The first bare `--` starts a separate passthrough tail. `textstat` ignores that tail; it does not treat tail tokens as file paths.

The same built application runs with Bun:

```sh
bun examples/textstat/dist/main.js README.md
```

The [example declaration](examples/textstat/src/application.ts) imports the built `@loom/core` package. Its [separate action](examples/textstat/src/count-files.ts) derives argument and option types from that declaration.

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
