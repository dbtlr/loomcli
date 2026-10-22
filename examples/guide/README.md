# guide

guide is a private workspace package, `@loom/guide`, that holds the examples of the author guide in [`docs/guide/`](../../docs/guide/README.md). Every TypeScript block and every terminal block in the guide is a real file here, so each one compiles against the packed packages and runs in `pnpm verify`.

## Layout

- `src/<NN-slug>/` is one chapter. It is a snapshot of one application, `pace` (a running-pace calculator), as it stands at the end of that chapter. The directory stands for the application's `src/`, the directory `loom init` writes `application.ts`, `main.ts`, and `application.test.ts` into. `application.ts` exports exactly one `Application`, under any name, and `main.ts` runs it. A later chapter starts as a copy of the one before it and keeps its file names, so two neighbors differ by one chapter's lesson.
- `src/package.json` stands for the application's `package.json`, one level above its sources, where a chapter that declares the version reads it.
- `application.test.ts` is the assembly test `loom init` writes for bun test. Each chapter compiles it, and [`tests/assembly.test.ts`](tests/assembly.test.ts) runs the same check on every chapter under the repository's runner. A chapter compiles with `skipLibCheck` on, as the `tsconfig.json` init writes does, because the bun test types bring a second `@types/node` beside the one core pins.
- Each chapter compiles as its own TypeScript project, through the `tsconfig.json` beside its sources, which extends [`tsconfig.base.json`](tsconfig.base.json). A modular application registers its environment by augmenting core's `Register` interface, and one project allows a single registration, so two snapshots never share a project. [`scripts/build.mjs`](scripts/build.mjs) compiles every chapter directory that has a `tsconfig.json` into `dist/src/<NN-slug>/`; a new chapter needs no script edit. The root `tsconfig.json` excludes `src/`, and `pnpm run check:types` compiles each chapter again against the packed tarballs.
- `transcripts/<NN-slug>/<name>.txt` is one terminal session against the snapshot with the same `<NN-slug>`.

## Transcripts

Line 1 is `$ ` followed by optional `NAME=value` assignments, `pace`, and the arguments, written with POSIX single and double quotes. Nothing else a shell does, such as a pipe or an expansion, is read. The remaining lines are the combined stdout and stderr in write order, as a terminal shows them with color off. The environment of the run holds only the assignments, and its working directory is the transcript's own directory, so a fixture a run reads, such as a configuration file, sits beside the transcripts. The expected exit status is 0, or `n` for a file name that ends in `.exit-<n>.txt`, such as `missing-time.exit-2.txt`.

## Binding Markdown to the files

A comment on the line directly above a fence binds the fence to a source:

- `<!-- example: <path> -->` before a `ts` fence. The fence body equals the whole file without its trailing newline. `<path>` is relative to the Markdown file.
- `<!-- example: <path>#<region> -->` before a `ts` fence. The body equals the lines between `// #region <region>` and the next `// #endregion` in that file, dedented by their common indentation.
- `<!-- transcript: <path> -->` before a `console` fence. The body equals the transcript file without its trailing newline.

Every `ts`, `typescript`, and `console` fence in `docs/guide/` needs a binding, and the check names the file and line of one that has none. Fences in other languages, such as `sh`, `text`, and `json`, are free.

## Running and updating

`pnpm vp test --run examples/guide` runs the unit tests of the sync logic, runs every transcript, and checks every Markdown page. After `pnpm run build`, `pnpm vp test --run --tagsFilter docs` runs the transcript and page checks alone, as a documentation-only pull request does.

`UPDATE_GUIDE=1 pnpm vp test --run examples/guide` rewrites instead of failing: a transcript whose output changed gets the new output (line 1 and the file name stay as written, so a wrong exit status is still a failure to fix by renaming), and a stale bound fence is rewritten from its source. Review the diff before committing it.
