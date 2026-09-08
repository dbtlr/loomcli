- Change the core package name to `@loomcli/core` before the first publication. The validation context key follows the package name.

### Migration

**Affected surface.** Core dependencies, import specifiers, and direct Standard Schema `libraryOptions` access.

**Why.** The published libraries use the maintained `@loomcli` npm scope.

**Before and after.**

```ts
import { Application } from '@loom/core';
```

```ts
import { Application } from '@loomcli/core';
```

**Steps.**

1. Replace the `@loom/core` dependency with `@loomcli/core` at the release version.
2. Update core import specifiers to `@loomcli/core`.
3. Use the exported `validationContext` accessor or `validationContextKey` instead of a literal `libraryOptions` key.

**Validation.** Compile the application against the installed package and run its command and validation tests.
