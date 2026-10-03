- Change `override()` from three overloads, one per key kind, to one signature whose type parameter is the key's type. The replacement's type is derived from the key, so a mismatched replacement now reports its own type against the one the key expects, such as `Argument of type 'View<number>' is not assignable to parameter of type 'View<readonly Row[]>'`, instead of `No overload matches this call`, and a key that is neither a declared view nor a failure class is reported at the key. Inference is unchanged for declared views, declared row views, and failure classes, and a helper generic over a view's data or a failure class's instances still forwards to `override()` unchanged.
- Add the exported types `AnyOverrideKey`, every value an override can key on, and `ReplacementView<Key>`, the replacement view one key takes, so a helper generic over the key can type its replacement. See the [core reference](docs/core.md#views).

### Migration

**Affected surface.** A call to `override()` that passes an explicit type argument, such as `override<readonly Row[]>(summary, table)` or `override<InputError>(InputError, problems)`. A helper generic over a failure class's own type, such as `function f<C extends typeof UsageError>(key: C)`, that passes a concrete replacement. Any other call without a type argument compiles unchanged.

**Why.** The type parameter is now the key's type rather than the view's data or the failure class's instance type, so a data or instance type passed as the type argument no longer satisfies its constraint and fails with `TS2344`. In a helper generic over the class type, the replacement's type stays unresolved until the key is known, so a concrete replacement fails with `TS2345`.

**Before and after.**

Before, the type argument named the data:

```ts
override<readonly Row[]>(summary, table);
```

After, drop it, because the key determines the replacement's type:

```ts
override(summary, table);
```

**Steps.**

1. Find each `override<` call in the application and its plugins.
2. Remove the type argument. Where the call must name a type, type the key or the replacement instead, such as `const table: View<readonly Row[]> = …`.
3. Make a helper generic over the failure's instances instead of its class, such as `function f<F extends UsageError>(key: FailureClass<F>)`, and type the replacement's parameter as `Readonly<UsageError>`.

**Validation.** Run `tsc --noEmit` on the application. It reports no error at an `override()` call.
