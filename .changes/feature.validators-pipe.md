- Add `pipe(first, ...steps)` to `@loomcli/validators`. A pipe runs any validator, then one to eight steps that check or transform the value the validator or step before it accepted, each a Standard Schema value or a parse function, and publishes exactly the input schema the first validator publishes. See the [validators reference](docs/libs/validators.md#pipe).

  ```ts
  const pairs = pipe(integer({ min: 2 }), (count) =>
    count % 2 === 0 ? { value: count } : { issues: [{ message: 'Expected an even number.' }] },
  );
  ```
