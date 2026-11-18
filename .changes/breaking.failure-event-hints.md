- Change failure log events to carry `failure.hints: []`. Core records the failure before gathering hints; the failure report still shows every hint.

### Migration

**Affected surface.** No compile error: `onLog` hooks and JSONL log-file readers that read `failure.hints` now receive an empty array instead of the `onFailure` hooks' hints recorded in 0.19.0.

**Why.** Core records the failure before gathering hints, so a failure that is a run's first record reaches the log file and a hint can name that file and run.

**Before and after.**

Before, a failure event's form could include a hook's hint:

```json
{ "code": "fatal", "exitCode": 1, "message": "Cannot finish.", "hints": ["Check the connection."] }
```

After, the same event's form has no hints:

```json
{ "code": "fatal", "exitCode": 1, "message": "Cannot finish.", "hints": [] }
```

The failure report still includes `Check the connection.`.

**Steps.**

1. Find `onLog` hooks and log-file readers that read `failure.hints`.
2. Read hints from the failure report. If a consumer needs hints separately, pass the hints your `onFailure` hook returns directly to that consumer.

**Validation.** Run `tsc --noEmit` and the application's tests. Trigger a failure for which an `onFailure` hook returns a hint. Check that the failure report or the hook supplies that hint to its consumer, while the failure event in `onLog` and the JSONL file carries `hints: []`.
