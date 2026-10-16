- Add `dateTime()` and `duration()` validators to `@loomcli/validators`, and `host.timeZone` to the `Host` in `@loomcli/core`.
  - `dateTime()` reads an ISO 8601 or RFC 3339 date and time into a `Date`. A token with an offset or `Z` names that instant, and an offset may be `+05:00`, `+0500`, or the hour-only `+05`. A token without one is read in the `timeZone` option or, when none is given, in the operator's time zone from `host.timeZone`, which honours `TZ`. A time a clock change skips moves forward, and one it repeats takes the earlier instant.
  - `duration()` reads systemd.time(7) span spellings, such as `90s`, `2h30m`, `1.5h`, `2 hours`, or `1 hour 30 min`, or a bare number of seconds, into milliseconds. Whitespace may separate a number from its unit and the parts from each other. Units are case-sensitive, a capital `M` is rejected as ambiguous, and months and years are rejected. `min` and `max` take durations in the same grammar and are inclusive.
  - `run({ host: { timeZone } })` overrides the captured zone.

### Migration

**Affected surface.** Applications that construct a complete `Host` object, including validation-context fixtures and host wrappers. Partial host overrides passed to `Application.run()` need no change.

**Why.** `Host` now requires `timeZone`, the IANA zone that `dateTime()` uses for timestamps without an explicit offset.

**Before and after.** A helper that constructs a complete host must include its zone:

Before:

```ts
const host: Host = { ...hostFields };
```

After:

```ts
const host: Host = { ...hostFields, timeZone: 'UTC' };
```

**Steps.**

1. Update the first-party packages together to the same version.
2. Add an appropriate IANA `timeZone` to complete host fixtures. Use a fixed zone such as `UTC` for deterministic tests, and preserve the captured zone in wrappers.
3. Prefer partial `run({ host: { ... } })` overrides when a test needs only selected host fields; core captures the remaining fields.

**Validation.** Run `pnpm exec tsc --noEmit` and the application's tests. When using `dateTime()` without an offset, verify the resulting instant under the intended host zone.
