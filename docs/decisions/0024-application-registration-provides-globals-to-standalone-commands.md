---
type: adr
title: ADR-0024 - Application registration provides globals to standalone Commands
description: One shallow Application environment registration supplies global types across modules; the Application alone supplies global values at invocation.
status: superseded
superseded_by: ADR-0026
created: 2026-09-13
modified: 2026-09-13
---

# ADR-0024 - Application registration provides globals to standalone Commands

## Context

A global option is declared once on an Application and reaches every action. Requiring each independently authored Command to import the same `GlobalOptions` value repeats Application wiring throughout the graph. Attaching a Command later cannot retroactively type an action declared in another module.

## Decision

The Application owns one `Register` module augmentation per TypeScript compilation context. `Register.environment` is `EnvironmentOf<typeof configured>`, where `configured` is the Application value before Command attachment or action registration. The environment contains global schema output types and the installed plugin types. It excludes the Command graph and root-local inputs. Application construction retains the literal plugin tuple rather than widening it to `Plugin[]`.

Standalone Command construction uses the registered global types. They import no Application or globals value. `ActionHandler<typeof command>` preserves arguments, local options, and those global types across modules. An Application's own action derives its globals directly from its constructor configuration. With no registration, a standalone Command knows no Application globals. An invalid registration is rejected; separate TypeScript projects can register different Applications.

The Application alone owns the runtime `GlobalOptions` declaration. Graph build supplies its binder to each Command. Dispatch merges the validated Application globals with the selected Command's validated local options. No runtime module augmentation or global singleton participates.

A library compiles its Commands without a consumer's registration. Its emitted declarations retain its own action inputs. Public `Command` type parameters retain neutral defaults; only the `new Command()` constructor reads the registered globals. Thus an explicit library annotation such as `Command` cannot acquire consumer globals when its declaration is imported. Such a Command can attach to an Application with globals; its existing action does not acquire a new compile-time contract. Attachment rejects an unsatisfied global type requirement and a statically visible global/local key collision. Graph build retains the complete key and spelling collision checks for every caller, JavaScript included. Relocation never changes a Command's action contract.

This decision supersedes ADR-0003. Its provisions are incorporated by reference except for per-Command globals wiring and invariant globals matching, which this record replaces. In particular: one Application-owned global table; no parent-local inheritance; no local option on an actionless group; global pre-scan before routing; routing commits at the first hyphen token; values win over route names; no global/local key or spelling collision; mixed-scope short groups fail with reason `'mixed-scope'`. Inspection lists application and plugin options together and `OptionNode.scope` distinguishes them. Plugin options share the pre-scan table but reach their own middleware alone, never an action.

## Consequences

Registration of the completed Application creates a circular inference dependency through Commands that already consume that registration. Naming the configured value first keeps inference one-way. `EnvironmentOf` reads a type-only marker rather than exposing a runtime property that appears to contain parsed values before a run.

Application-specific registration stays out of reusable package declarations. A packed consumer must compile an independent library first, then consume its emitted declarations under an Application registration. Applications, examples, and tests with different registrations use separate compiler projects. Declaration-time local/global name checks remain; attachment adds checks for imported local keys.

Plugin literal types survive this boundary for the later ADR-0022 rendering work. Current Plugin types carry option declarations; theme configuration and typed rendering contexts still require the ADR-0022 implementation. This decision does not add styles, events, hooks, or plugin-provided runtime context values.

## Status

Accepted 2026-09-13 with Application registration in the public SDK. `pnpm verify` passes 937 tests and the workspace/packed declaration checks. The same 937 tests pass with `LOOM_TEST_RUNTIME=bun`. `pnpm check:packed` compiles an independent library and a registered Application, then verifies automatic globals and customized library help under Node and Bun. Type checks reject unknown globals, incompatible attachments, union collisions, invalid registration, wrong extension targets, and reopened input/action methods.

## Changelog

- 2026-09-13: Superseded by [ADR-0026](0026-applications-declare-global-options-through-a-fluent-method.md). Global declarations move to `Application.globalOption()`; automatic registration and library contracts remain in force.
