- Derive Homebrew, npm, pnpm, Bun, and Yarn installations from the resolved application path when no installation record matches. `host.release.installation.digest` is now optional because a derived installation has no recorded digest.
- Show the package manager's upgrade command in update notices and when `self-update` refuses a package-managed installation, when the facts the command needs are available, such as the npm package name the build bakes. Otherwise an update notice is skipped, and the refusal tells you to update with the package manager. A script-recorded binary whose real path is in a Homebrew Cellar or a package manager's global root counts as that package manager's installation.
- Export `packageManagerInstallation(path, platform)` from `@loomcli/core`, which derives the Homebrew installation or the global installation for npm, pnpm, Bun, or Yarn for an absolute realpath.
- Export `isNpmPackageName(name)` from `@loomcli/core`, the npm package name rule that update notices and `loom build --target npm` judge a name by.

### Migration

**Affected surface.** Code that requires `host.release.installation.digest` to be a string can now fail type checking. Code that uses the presence of `host.release.installation` to identify a script installation changes behavior at run time without a compile error. `host.release.installation` is now present on Homebrew, npm, pnpm, Bun, and Yarn runs that match the layout rules.

**Why.** The resolved application path can identify a package-managed installation. Only a matching installation record supplies its verified digest.

**Before and after.**

Before:

```ts
const { installation } = host.release;
if (installation !== undefined) {
  checkInstalledBinary(installation.path, installation.digest);
}
```

After:

```ts
const { installation } = host.release;
if (installation?.method === 'script' && installation.digest !== undefined) {
  checkInstalledBinary(installation.path, installation.digest);
}
```

**Steps.**

1. Check `installation.method === 'script'` anywhere presence previously meant a script installation.
2. Check `installation.digest !== undefined` before using the digest.

**Validation.** Run your project's type checker, for example `pnpm exec tsc --noEmit`. Run the application with a matching script record and from a matching Homebrew, npm, pnpm, Bun, or Yarn path. Confirm that only the script installation enters the code that needs its recorded digest.
