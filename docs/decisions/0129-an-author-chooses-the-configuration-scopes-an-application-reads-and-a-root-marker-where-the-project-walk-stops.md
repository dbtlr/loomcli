---
type: adr
title: ADR-0129 - An author chooses the configuration scopes an application reads, and a root marker where the project walk stops
description: configuration() takes scopes, a list of project and user that defaults to both, and the lookup reads only the scopes listed, in a fixed order, project first. The project scope is the walk, which never looks in the home directory; the user scope is the home file and the XDG user file. root names one or more entries whose presence marks the directory where the project walk stops, after it looks there; root false states that there is none. A root beside scopes without project is a declaration fault. The lint rule unrooted-configuration warns on a configuration() call that reads the project scope and sets no root. With neither setting the lookup is ADR-0119's. It amends ADR-0119.
status: proposed
created: 2026-10-31
modified: 2026-10-31
---

# ADR-0129 - An author chooses the configuration scopes an application reads, and a root marker where the project walk stops

## Context

[ADR-0119](0119-the-configuration-lookup-walks-to-home-reads-an-author-named-variable-and-the-xdg-user-file-and-never-falls-back-after-a-broken-file.md) gives every application one lookup: the walk from the start directory up to the home directory, or to the filesystem root outside home, then the home file, then the XDG user file. An application run from a project, such as the `loom` toolchain or Mimir, reads a file that describes that project, and a walk that climbs past it finds another project's file. In a monorepo, a `loom` run in `packages/cli` would read the repository root's file as its own. An application run from the operator's shell, such as Heimdall's tools, reads a file that describes the operator's setup, and a file in whatever directory the operator stands in should not change it.

Other configuration offerings name these as scopes. Git reads a repository's file, the user's file, and a system file, and its options name each one. npm reads a project `.npmrc` beside the nearest `package.json`, a user `.npmrc`, and a global one. cosmiconfig's `searchStrategy` chooses between the start directory alone, a walk up to the nearest `package.json`, and a walk to home followed by the operating system's configuration folder. A project scope needs a place to stop, and the place differs by tool: npm and cosmiconfig stop at `package.json`, git at the repository, and an application that is not a JavaScript tool has neither. No one boundary fits every application, so the author names it.

## Decision

- **Two scopes.** The project scope is the walk. The user scope is the home file and then the XDG user file. `--config` and the author-named variable name one file each and belong to no scope, so they work under every choice of scopes, and `--no-config` reads no scope.
- **The author chooses.** `configuration()` takes `scopes`, a non-empty list of `'project'` and `'user'`. The lookup reads only the scopes listed, and always in one order, the project scope first, whatever order the list gives. With no `scopes`, the lookup reads both, which is ADR-0119's lookup.
- **The home directory is the user's.** The project walk never looks in the home directory. A run that starts at or under home walks up to the directory below home, and a run outside home walks to the filesystem root. With both scopes, the order of the directories looked in is ADR-0119's, because the home file follows the walk.
- **A root marker.** `configuration()` takes `root`, one name or a non-empty list of names. In each directory it walks, the project walk looks for the configuration file first, then checks whether an entry of a listed name exists there, a file, a directory, or a symbolic link, and stops after that directory when one does. So with `root: 'package.json'`, the walk from a package's `src` directory looks in `src`, then in the package directory, and stops. The walk still stops below home and at the filesystem root when it meets no marker. Each name is one path segment: nonempty, holding no `/` or `\`, and neither `.` nor `..`.
- **No marker, stated.** `root: false` states that the project scope has no marker, so the walk ends at the directory below home, or at the filesystem root outside home. An omitted `root` walks the same way.
- **Faults at the call.** `configuration()` throws a `DeclarationError` for a `root` name that breaks the segment rule, `@loomcli/plugins/config/root-name`, and for a `root` other than `false` beside a `scopes` list without `'project'`, `@loomcli/plugins/config/root-without-project`, because the marker then bounds nothing. The types reject an empty `scopes` list, a scope other than the two, and an empty `root` list.
- **A lint nudge.** `@loomcli/eslint-plugin` gains `unrooted-configuration`. It reports a `configuration()` call, imported from `@loomcli/plugins/config`, whose settings object literal reads the project scope, through no `scopes` key or a `scopes` array literal that lists `'project'`, and has no `root` key. Its message: `This configuration reads the project scope with no root marker, so its walk climbs past the project. Name the file that marks the project's root, such as root: 'package.json', or set root: false.` Unlike every earlier rule, the recommended configurations turn it on at `warn`, because a project with no obvious marker is legitimate and the rule is advice. It follows the plugin's rule for what it can trace: a settings object it cannot read gets no report.
- **The graph is unchanged.** Scopes and the marker are how the plugin finds its file, so the graph publishes neither, as it publishes no other lookup setting.

## Considered options

- **One fixed project boundary for every application, such as the repository.** Rejected. A package inside a monorepo would read the repository's file, and a project outside version control has no repository.
- **A system scope now.** Not taken. ADR-0119 left a system level out, and no application asks for one yet. The list form lets a third scope join later without breaking a declaration that names the first two.
- **Merging files across scopes, as git and npm do.** Not taken. ADR-0119's rule stands: a run reads at most one file, the first found.
- **The lookup order following the list's order.** Rejected. A user file that outranks a project file would let the operator's setup override what a project states about itself, and no surveyed tool reads the user scope first.
- **The marker as an error-level rule.** Rejected. A tool whose projects share no marker, or whose walk to home is the intended behavior, is correct without one.
- **A marker that also starts the walk at the project root.** Not taken. The walk keeps its start directory, so a file nearer the start directory still answers first, as in every walk-based lookup.

## Consequences

The configuration plugin's settings gain `scopes` and `root`, both optional, so an application that declared neither compiles and looks up its file as before, and its recommended lint configuration gains one warning for each `configuration()` call with no `root` until the author sets one or turns the rule off. The `loom` toolchain is the first application to set both, under [ADR-0130](0130-the-loom-toolchain-reads-loom-config-json-from-the-package-directory-and-every-path-it-owns-is-a-key.md). [Configuration plugin](../plugins/config.md), [ESLint plugin](../libs/eslint-plugin.md), and the [glossary](../glossary.md) carry the contract.

## Status

Proposed. It moves to accepted in the release PR of the release that ships the scopes, the marker, and the lint rule.

## Changelog

- 2026-10-31: Proposed with the toolchain configuration contract (LM-434). It amends ADR-0119's lookup by letting the author choose its scopes and bound its walk. ADR-0119 carries a dated entry.
