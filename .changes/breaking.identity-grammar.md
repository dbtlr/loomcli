- Change `plugin()`, `extension()`, and `view()` to check their identity at the call against one grammar: an npm package name, scoped or unscoped, then zero or more subpath segments, each after a `/` and each of lowercase letters and digits in words joined by single hyphens. `help`, `@acme/config`, and `@loomcli/plugins/help/page` pass; `Help`, `@acme`, `x//y`, and `x/under_score` throw a `DeclarationError` under `@loomcli/core/invalid-identity`, such as `A plugin declares the identity "Help", which is not a package name with optional kebab-case subpath segments.` with the fix `Name it <package>[/<subpath>...], such as "@acme/notes" or "@acme/notes/page".` An empty identity and one that is not a string report under the same rule. See [Identity and installation](docs/core.md#identity-and-installation).
- Add `isRuleIdentity(value)` to `@loomcli/core`. It answers whether a value is a string in the grammar of a diagnostic rule's identity, an identity followed by a kebab-case rule name, and `issueCode()` in `@loomcli/validators` checks its code with it. See [Developer Diagnostics](docs/core.md#developer-diagnostics).

### Migration

**Affected surface.** Every `plugin()`, `extension()`, and `view()` call whose identity is not a package name followed by kebab-case subpath segments, such as one with an uppercase letter, an underscore, a space, an empty segment, or a scope with no package name. Since 0.2.0 `plugin()` accepted any nonempty string, and `extension()` and `view()` accepted any value.

**Why.** An identity keys what a plugin contributes and prefixes the identities of the diagnostic rules its package declares, so it follows the package-name convention as a rule rather than by habit. See [ADR-0052](docs/decisions/0052-a-plugin-extension-and-view-identity-follows-one-grammar.md).

**Before and after.**

Before:

```ts
import { extension, plugin, view } from '@loomcli/core';

const audit = plugin('Audit', { views: [view('Audit/Report', { render })] });
const owner = extension('audit/owner_name', { schema, target: 'command' });
```

After:

```ts
import { extension, plugin, view } from '@loomcli/core';

import Package from '../package.json' with { type: 'json' };

const audit = plugin(Package.name, { views: [view(`${Package.name}/report`, { render })] });
const owner = extension(`${Package.name}/owner-name`, { schema, target: 'command' });
```

**Steps.**

1. Find every `plugin()`, `extension()`, and `view()` call in the application and in the plugins it ships.
2. Name each plugin by its package name, or by the package name and a kebab-case subpath when the package ships several plugins, read from the package manifest.
3. Name each extension and view by its plugin's identity and a kebab-case suffix.
4. Lowercase every segment and replace each underscore or space with a hyphen.

**Validation.** Import each module that declares a plugin, an extension, or a view, or run the application's test command. A remaining identity outside the grammar throws `@loomcli/core/invalid-identity` when its module evaluates, with a finding that marks the identity.
