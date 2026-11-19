- Change `run()`, `app.invoke()`, and `inspect()` to reuse the graph an Application already built in the same process, one for a development build and one for a distributed build. A second call on one Application builds no Command and runs no `onCommandAttach` or `onGraphBuilt` hook, so repeated runs in a test suite or an embedding host cost only the run's own work, and two `inspect()` calls return the same object. `check()` still builds anew on every call, a build that faults keeps nothing, and every run still validates its declared defaults and implied values. A launch is unchanged. See [Reusing the built graph](docs/core/graph-inspection.md#reusing-the-built-graph).

### Migration

**Affected surface.** No compile error. A plugin's `onCommandAttach` or `onGraphBuilt` hook, and a test that counts their calls, now sees one graph build per Application and build in a process, where 0.19.0 built the graph, and ran both hooks, on every `run()`, `app.invoke()`, and `inspect()`.

**Why.** A built graph depends only on the Application's declarations and its build, so repeated calls in one process, in a test suite or an embedding host, no longer pay for a build each time.

**Before and after.** Before, two `run()` calls on one Application ran each `onGraphBuilt` hook twice. After, they run it once, and a second `inspect()` returns the same object as the first.

**Steps.**

1. Find `onCommandAttach` and `onGraphBuilt` hooks that read the host, the environment, or anything that changes between runs, and move that work into middleware or the action.
2. In tests that count hook calls or need a fresh build, call `check()`, which still builds anew, or build a new Application value, since every authoring call returns one.

**Validation.** Run `tsc --noEmit` and the application's tests. Run the application twice in one process and check that each hook runs once and both runs give the same output.
