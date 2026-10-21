- Remove the `bun-windows-x64`, `bun-windows-x64-baseline`, `bun-windows-x64-modern`, and `bun-windows-arm64` targets from `loom build`, with their `.exe` output and asset names, under [ADR-0100](docs/decisions/0100-acceptance-plans-live-beside-the-tests.md). Each is now an option error that names the targets. On Windows, `--target` has no default, so a run without one fails as that option error.

### Migration

**Affected surface.** Packages whose scripts or CI run `loom build --target bun-windows-<arch>`, or run `loom build` without `--target` on a Windows host.

**Why.** No CI job runs the Windows binary these targets built, and support that no CI entry runs is not shipped.

**Before and after.**

Before:

```sh
loom build --target bun-windows-x64 --release
```

After, Bun compiles the Windows binary directly. The facts of a bundle name no release asset, so `self-update` does not replace that binary:

```sh
bun build src/main.ts --compile --target bun-windows-x64 --outfile dist/notes.exe \
  --define "$(loom build --target node --release --define)"
```

**Steps.**

1. Replace each `loom build --target bun-windows-<arch>` call with `bun build --compile --target bun-windows-<arch>`, as above.
2. On a Windows build host, pass `--target` to every `loom build` call, such as `--target node`.
3. Remove `.exe` assets from release automation that expected `loom build` to name them.

**Validation.** Run `loom build --target bun-windows-x64` and confirm that it exits 2 and names the targets. Run the replacement `bun build` command and confirm that it writes `dist/notes.exe`.
