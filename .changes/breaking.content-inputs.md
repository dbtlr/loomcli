- Add local content arguments and options that prepare readable file paths into lazy `Content` handles, with one declared stdin target per Command and source-count bounds on collections.
- Add `.stdin()` for an input that accepts piped or redirected content without a file operand. Content preparation reads no bytes; the action selects `text()` or `stream()`.
- Extend inspected option types with `content` and input-problem identities with `stdin`. Named invocations and MCP calls accept file paths and have no content stdin.

### Migration

**Affected surface.** Applications with exhaustive readers of `OptionNode.type`, `InputIdentity.kind`, or the Command authoring-method surface.

**Why.** Native content inputs and stdin-only declarations add variants to these public surfaces. Existing string inputs keep their behavior.

**Before and after.** A reader that handles `string`, `boolean`, and `count` options now also handles `content`. Content options consume a separate string token and publish a path schema; their action value is a lazy handle.

```ts
switch (option.type) {
	case 'string':
	case 'content':
		return option.schema;
	case 'boolean':
	case 'count':
		return null;
}
```

**Steps.**

1. Add `content` to exhaustive inspected-option readers and `stdin` to exhaustive input-identity readers.
2. Update authoring-method readers to include `.stdin()` where they enumerate available methods.
3. To adopt content inputs, declare them locally with `type: 'content'` and read the resulting handle in the action. Declare `stdin: true` on at most one input, or use `.stdin()` alone.

**Validation.** Run the application's type check and tests. Check file and pipe invocations, named calls with explicit paths, and help without opening or reading content.
