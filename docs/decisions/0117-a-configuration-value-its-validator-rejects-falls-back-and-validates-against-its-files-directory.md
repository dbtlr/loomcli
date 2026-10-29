---
type: adr
title: ADR-0117 - A configuration value its validator rejects falls back, and a configuration value validates against its file's directory
description: A value the configuration source filled that the option's validator rejects is dropped, so the option falls back as if no tier supplied it, and core names the drop in one out.debug line at -v. An answer may carry the absolute directory of the file it came from, and the option's validator then reads that directory as host.cwd. This narrows ADR-0006's and ADR-0032's rule that a filled value its schema rejects fails the run, for the configuration tier alone.
status: proposed
created: 2026-10-28
modified: 2026-10-28
---

# ADR-0117 - A configuration value its validator rejects falls back, and a configuration value validates against its file's directory

## Context

[ADR-0006](0006-absence-rules-and-no-lenient-input.md) holds that "an operator who typed a bad value must see the rejection, not a silently different run", and [ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md) extended the rule to the environment and the configuration tiers: a filled value its validator rejects fails the run with code 2. [ADR-0039](0039-the-configuration-plugin-reads-layered-json-files-and-fails-only-on-the-file-the-operator-names.md) did the same for a value of the wrong shape in the configuration file.

That serves a value the operator typed for this run. A configuration file is written once and read by every later run, by commands that never needed the value, and by agents that never wrote it. A wrong value there fails every run until someone edits the file, the command that would repair it included. The owner's ruling for the 0.17.0 configuration plugin (LM-269) is that configuration never breaks an operator's run unless the operator stated it: "An unreadable or broken config should NEVER break the build for an operator. It should at most trigger a warning for them." A value a linked option's validator rejects "wouldn't carry into the option, but it would still live in the config."

A relative path in a configuration file is written relative to the file, as tsconfig, git's `include.path`, Cargo, and figment's `RelativePathBuf` resolve it. `@loomcli/validators`' `path()` and every validator that reads the validation context resolve against `host.cwd`, which is the run's working directory, so a file found three directories up would resolve its paths against the wrong place.

## Decision

- **A rejected configuration fill falls back.** When an option's value came from the configuration source and the option's validator returns issues, core drops the fill. The option then reads as unfilled by every tier: its declared default applies, or it is omitted, under [Absence and defaults](../core/validation.md#absence-and-defaults). A `required` option reports its missing-value error, and an option that declares `validateOmitted` calls its validator with `undefined`. A dropped fill is not present, so it activates no middleware. A multiple option's list is one fill, so one rejected item drops the whole list.
- **Named at `-v`.** Core writes one `out.debug` line for each dropped fill: `Ignored option "<spelling>" from <label>: <issue>`, where `<spelling>` is the option's [reported spelling](../core/failures.md#failure-classes), `<label>` is the answer's label, and `<issue>` is the first issue's message, with its path after the option as a failure prints one. The line shows at `-v` alone, under [ADR-0090](0090-an-operators-v-or-q-settles-the-runs-verbosity-right-after-graph-build.md).
- **The configuration tier alone.** A value from argv or the environment that its validator rejects still fails the run with code 2, and a validator that throws is still a developer error. A source's answer of the wrong raw type is still that plugin's defect.
- **`supplied` is unchanged.** The validation context's `supplied` record is taken before any validator runs, so it holds the raw value the source filled, as it holds every filled value.
- **An answer carries its file's directory.** `SourceAnswer` gains an optional `directory`, an absolute path. When an answer holds one, the option's validator receives a validation context whose `host` is the run's host with `cwd` replaced by that directory, so `path()` resolves a relative value against the file's directory. Every other field of the host is the run's. A `directory` that is not a string holding an absolute path is a defect of the source, under the rule for answers outside the contract.
- **The configuration schema keeps its paths as written.** A Standard Schema library passes no options to the validators nested inside it, so a configuration plugin cannot hand its own schema a host whose `cwd` is the file's directory, and `path()` cannot be nested in a zod, valibot, or ArkType object. The owner chose that a value the schema reads keeps the path the file wrote, and only a linked option resolves against the file's directory.

## Considered options

- **Keep the failure, as ADR-0006 and ADR-0032 hold.** Rejected for the configuration tier. A file is persistent state, so one bad value fails every later run, including the run that would repair it.
- **Fall back for every tier.** Rejected. A value typed on the command line or set in the environment belongs to this run, and the operator must see the rejection.
- **Warn on stderr at the default verbosity.** Rejected. A file the operator shares across machines or tool versions would warn on every run. The owner: "someone might be trying to figure out why the value in their config file is being ignored", which `-v` serves.
- **Resolve relative paths against the working directory, as today.** Rejected. A file found by the walk of [ADR-0119](0119-the-configuration-lookup-walks-to-home-reads-an-author-named-variable-and-the-xdg-user-file-and-never-falls-back-after-a-broken-file.md) would resolve its paths against wherever the operator stood.
- **A validation phase of its own for the configuration schema, built by a core helper.** Rejected. zod's `~standard.validate` takes the value alone, so the options never reach a nested validator. A plugin helper that resolves a path inside a schema transform, and a list of path keys the plugin resolves before the schema runs, were offered and not chosen: the owner chose paths as written.

## Consequences

The input-source stage keeps its tiers and its precedence. Validation gains one branch for a configuration fill, and the stage reads `directory` from each answer. A third-party configuration source gains the fallback with no change, because it is a rule of the tier. [Input sources](../core/input-sources.md) and [Validation](../core/validation.md) carry the contract.

## Status

Proposed. It moves to accepted in the release PR of the release whose implementation drops a configuration fill its option's validator rejects, writes the `-v` line, and validates an answer that carries a `directory` against that directory.

## Changelog

- 2026-10-28: Proposed with the configuration contract (LM-426). It narrows ADR-0006's rule that a default never substitutes for invalid input, and ADR-0032's dated reading that a filled value its schema rejects never falls through to the default, for the configuration tier alone, and supersedes ADR-0039's clause that a wrong value in the file is a usage failure. Each carries a dated entry.
