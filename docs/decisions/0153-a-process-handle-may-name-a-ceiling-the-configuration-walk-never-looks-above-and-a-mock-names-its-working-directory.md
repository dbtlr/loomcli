---
type: adr
title: ADR-0153 - A process handle may name a ceiling the configuration walk never looks above, and a mock names its working directory
description: ProcessHandle gains an optional ceiling, a directory that core copies into host.ceiling at entry. The configuration plugin's project walk looks in the ceiling directory itself and never in an ancestor of it, and ends at whichever stop it meets first, below home, the ceiling, a root marker, or the filesystem root. The real process's handle names none, so a real run walks as ADR-0119 and ADR-0129 state. mockProcess names its cwd unless the test names another ceiling, whether or not the cwd is inside home, so a mock run reads configuration from its working directory and nowhere above. The user scope, --config, and the variable are not bounded. It amends the walk's end in ADR-0119 and ADR-0129, and extends ADR-0107's handle and mock.
status: proposed
created: 2026-11-14
modified: 2026-11-14
---

# ADR-0153 - A process handle may name a ceiling the configuration walk never looks above, and a mock names its working directory

## Context

[ADR-0119](0119-the-configuration-lookup-walks-to-home-reads-an-author-named-variable-and-the-xdg-user-file-and-never-falls-back-after-a-broken-file.md) ends the configuration plugin's walk at the home directory for a start directory inside home, and at the filesystem root otherwise. [ADR-0129](0129-an-author-chooses-the-configuration-scopes-an-application-reads-and-a-root-marker-where-the-project-walk-stops.md) moved the home directory into the user scope, so the walk ends below home, and let the author end it at a root marker. The lookup reads the real file system, because [ADR-0107](0107-a-run-reads-the-process-through-one-process-handle.md) leaves the file system outside the process handle.

A test that runs an application on `mockProcess` with a temporary home and a working directory outside that home therefore walks to the filesystem root. Heimdall's tests did this from a checkout under the developer's home, and the walk read the developer's real configuration file in an ancestor of the checkout. The only bound a test has today is a start inside home, and a root marker bounds only an application whose author named one and a tree that holds it. Loom's own repository has the same rule for its tests, under "Tests stay inside their sandbox" in `AGENTS.md`, and its in-process toolchain tests already stop their walks at a ceiling directory of their own.

Git names the same bound `GIT_CEILING_DIRECTORIES`: a list of directories its search for a repository does not climb past.

## Decision

- **A ceiling on the handle.** `ProcessHandle` gains one optional member, `ceiling`, a directory. Core copies it into the run's host as `host.ceiling` at entry, once, right after it reads the working directory, so a run whose working directory cannot be read fails before core reads the ceiling. A handle with no ceiling gives a host with no `ceiling` member. Every run copies it, a run through `run()`, an invocation by name, and an action's `invoke`, which binds its own run's handle. `ProcessFields` takes it as it takes every other fact, so `processHandle({ ceiling })` names one, and `processHandle()` names none.
- **The walk never looks above it.** The configuration plugin's project walk looks in the ceiling directory itself and never in an ancestor of it. From a start directory that is the ceiling or inside it, the walk ends after it looks in the ceiling. From a start directory outside the ceiling, as the directory option's value can be, the walk climbs until it meets an ancestor of the ceiling and ends without looking there, so a start directory that is itself an ancestor of the ceiling looks nowhere. The filesystem root is an ancestor of every ceiling other than the root, so a walk under such a ceiling never looks in the root. The ceiling compares lexically, as `node:path` resolves it, like every other path of the walk, so a relative ceiling resolves against the process's working directory.
- **The first stop ends the walk.** The ceiling joins the walk's three existing stops, and the walk ends at whichever it meets first: below the home directory, for a start directory inside home, with no directory looked in for a start at home; at the ceiling; after a directory that holds a root marker; and at the filesystem root. A root marker in the ceiling directory changes nothing, because the walk ends there anyway, and a marker above the ceiling is never checked.
- **Only the project walk.** The ceiling bounds the project scope's walk and nothing else. The user scope's home file and XDG user file read under `host.home` and `host.env`, which the handle already supplies, and `--config` and the author-named variable name a file the operator or the test chose. No other code in Loom reads the ceiling in this change, and it is not a seal on the file system: a run's own code reads any file it names.
- **The real process names none.** A real run's walk is ADR-0119's and ADR-0129's, unchanged.
- **A mock names its working directory.** `mockProcess` sets `ceiling` to its `cwd` unless the test supplies `ceiling`, whether or not the `cwd` is inside `home`, so every mock run reads its configuration file from its working directory and never from a directory above it. With a `cwd` function, the ceiling is what that function answers when core reads the ceiling. A test whose file sits in a parent of its `cwd` names a higher ceiling through the `ceiling` field, and `ceiling: '/'` lets the walk reach the filesystem root, as a real run's does. `MockProcess` reads the ceiling as a `string`, because the mock always names one. The owner chose the default: "Cwd only. Tests need to be predictable".
- **Types.** `ProcessHandle` is an input type under [ADR-0137](0137-a-published-export-is-public-and-its-tag-says-whether-it-is-an-input-type-or-an-output-type.md), so the new member is optional and adding it is a feature, and so is the optional `ceiling` on `Host`. The mock's default is the break: a test whose `cwd` is below its configuration file compiles unchanged and finds no file.

The amendment: ADR-0119's step that the walk goes "up to the filesystem root otherwise", and ADR-0129's rule that the walk "still stops below home and at the filesystem root when it meets no marker", now also end at the host's ceiling when the host has one. Every other clause of both records stands.

## Considered options

- **A testing default of `--no-config`.** Heimdall's first suggestion. Rejected. `--no-config` is the configuration plugin's option, and the mock knows nothing of the plugins an application installs. A test that writes a configuration file into its working directory, the common case, would then have to opt back in, and the lookup's own tests would test something other than a default run.
- **A walk that stops at the temporary home.** Heimdall's second suggestion. Rejected. The walk already ends below home for a start inside home, so the change would only bound a start outside home at the home directory, which is not an ancestor of that start. It would also change where a real run's walk ends.
- **ADR-0129's root marker as the bound.** Rejected. The marker is the author's choice for the application, not the test's. A test cannot rely on it, and a walk that meets no marker still climbs to the filesystem root.
- **A ceiling at the mock's home, or at the temporary directory.** Rejected by the owner, who chose the working directory alone. A working directory is the one place every test states, so each test's walk reads the same directories on every machine.
- **A ceiling the walk does not look in, as git's is.** Rejected, a named deviation from `GIT_CEILING_DIRECTORIES`. Git never searches a ceiling directory when it climbs, but a mock's ceiling is its working directory, and a test that writes a file there expects the run to read it.
- **A ceiling that bounds only a start inside it, as home bounds the walk.** Rejected. A directory option that points outside the mock's working directory would then walk to the filesystem root, which is the leak this record closes. Never looking in an ancestor of the ceiling holds for every start directory.
- **A ceiling read from an environment variable, as git reads its own.** Rejected. A variable would let an operator's environment change real runs, and a run reads its process facts from its handle alone under ADR-0107, where a mock states them.
- **A ceiling that also bounds the user scope.** Rejected. The user scope reads under `host.home`, which the mock already seals to a folder the test supplies, and a test that writes a home file expects the run to read it.

## Consequences

A real run is unchanged. A test on `mockProcess` reads configuration from its working directory and nowhere above it, inside or outside its home, so a developer's own configuration file above a checkout can no longer reach a test. A test that starts in a subdirectory and expects the walk to reach a file above it now finds no file, with no compile error, and names a higher ceiling; the `@loomcli/testing` fragment is breaking and carries the migration. An embedding host or a harness that builds a handle with `processHandle` may name a ceiling of its own. A later change may let another walk read the ceiling, such as a walk to the nearest `package.json`, under a record of its own. [Host](../core/host.md), the [configuration plugin](../plugins/config.md), the [testing reference](../libs/testing.md), and the [glossary](../glossary.md) carry the contract.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-14: Proposed with the ceiling contract (LM-511). It amends the end of ADR-0119's walk and of ADR-0129's project walk, and extends ADR-0107's handle with one fact and its mock with one default. ADR-0107, ADR-0119, and ADR-0129 carry dated entries.
