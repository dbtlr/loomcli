---
description: The router into the libraries an application uses beside @loomcli/core. Validators, prompts, testing, and the ESLint plugin, each listed with the moment to open it.
---

# Libraries

These packages sit beside `@loomcli/core`. An application adds each one it needs, and each page documents one package.

- [Validators](validators.md): open it when an input needs a ready-made Standard Schema validator, such as `port()`, `oneOf()`, `duration()`, or `path()`, or when you write your own with `createValidator`.
- [Prompts](prompts.md): open it when an action asks the operator a question or shows progress with `@loomcli/prompts`.
- [Testing](testing.md): open it when you add the assembly check from `@loomcli/testing` to the application's tests, or run the application in a test on a `mockProcess` handle.
- [ESLint plugin](eslint-plugin.md): open it when you load Loom's lint rules into oxlint or ESLint.
