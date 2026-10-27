---
type: adr
title: ADR-0114 - A CI run is not interactive, draws no live region, and renders as the standard detectors do
description: Core reads CI as ci-info reads it, set and nonempty with CI=false meaning not CI, and a CI run is not interactive, draws no live region, renders color and hyperlinks as supports-color and supports-hyperlinks do under CI, and sends no background query. The interaction decision is off under CI whatever the terminal facts say, so a linked question takes its supplied option or fails with the missing-input error, an unlinked one fails with InteractionUnavailableError, and a required non-interactive option is required. A region opened without input true is not live on a terminal stderr under CI or TERM=dumb, so a progress line writes plain lines. CI=false is the operator's way back, and the interaction mark stays one-way.
status: proposed
created: 2026-10-27
modified: 2026-10-27
---

# ADR-0114 - A CI run is not interactive, draws no live region, and renders as the standard detectors do

## Context

[ADR-0082](0082-an-action-asks-through-the-prompts-library-and-one-interaction-decision-governs-questions-and-conditional-requiredness.md) turns the interaction decision on when stdin and stderr are both terminals and the interaction mark has not turned it off. [ADR-0091](0091-live-regions-stack-at-the-bottom-of-stderr-and-progress-reaches-invoke-callers-and-mcp-clients-as-typed-events.md) makes a region live when stderr is a terminal. When a CI runner gives a job a pseudo-terminal, a run under either rule asks a question no one answers and redraws a progress line into a build log.

CI systems such as GitHub Actions, GitLab CI, CircleCI, Travis CI, and Buildkite set `CI=true`. The detectors read the variable differently. ci-info, which npm and is-ci use, treats `CI=false` as not CI before any other check. is-interactive, which ora uses, treats any `CI` in the environment as CI, and std-env 4.3.0 reads the raw value, so `CI=false` counts as CI in both. People set `CI=false` to stop tools from acting as if they ran on CI, as in `CI=false npm run build`.

The owner's ruling on 2026-10-27: "CI should effectively become non-interactive mode, so prompts and such should fail, unless given as a linked option." On the variable, the owner ruled that Loom follows how CI systems use it and the standards that read it.

## Decision

- **CI as ci-info reads it.** A run is under CI when `CI` in `host.env` is set, nonempty, and not `false`. Core reads it through one helper for both rules below.
- **Not interactive.** Under CI, the interaction decision is off whatever the terminal facts say. A question whose linked option was supplied takes that value without asking, a linked question whose option was omitted fails with core's missing-input error and exit 2, an unlinked question fails with `InteractionUnavailableError` and exit 1, and an omitted `required: 'non-interactive'` option fails before the action with exit 2, exactly as with stdin piped.
- **No live region.** On a terminal stderr, a region opened without `input: true` is not live under CI or under `TERM=dumb`, a terminal that cannot move its cursor, so a progress line writes the plain lines it writes to a pipe. On such a terminal, `out.draw` keeps the Application's `terminalControls` setting, as a draw to a stderr that is not a terminal does, and a shutdown or a suspend writes no show-cursor sequence unless the Application preserves controls. An input region still draws under `TERM=dumb`, so a question there still asks.
- **Rendering as the standard detectors do.** On a terminal under CI, automatic color and modifiers follow supports-color's CI block: `GITHUB_ACTIONS`, `GITEA_ACTIONS`, or `CIRCLECI` set gives truecolor; `TRAVIS`, `APPVEYOR`, `GITLAB_CI`, `BUILDKITE`, `DRONE`, or `CI_NAME=codeship` gives 16 colors; any other CI gives none. `FORCE_COLOR`, `NO_COLOR`, the operator's color choice, and the rendering policy keep [ADR-0022](0022-renderers-return-marked-strings-that-core-resolves-and-a-theme-is-a-palette.md)'s and [ADR-0089](0089-an-operators-color-or-no-color-settles-the-runs-color-right-after-host-capture.md)'s precedence over it. Automatic hyperlinks are off under CI, as supports-hyperlinks has them.
- **No background query.** Under CI, core sends no background query, because a CI terminal feeds a build log that never answers. Settlement continues past the query, as [ADR-0092](0092-core-settles-each-runs-background-once-and-a-theme-entry-may-adapt-to-it.md) settles a run whose query is skipped.
- **The way back.** `CI=false` says the run is not CI, so questions ask and regions draw as the terminal facts allow. The interaction mark keeps ADR-0082's one-way rule: it can turn interaction off and never on.
- **No new member.** Core adds no host fact or export for CI.

The rules are stated in [Interaction](../core/interaction.md), [Live region](../core/output.md#live-region), [Styles](../core/styles.md), and [Background](../core/background.md).

## Considered options

- **Count any set `CI`, as is-interactive and std-env 4.3.0 do.** Rejected. `CI=false` would then mean CI, while CI systems set `CI=true` and a person sets `CI=false` to say the run is not CI.
- **Turn off live regions under CI and leave questions to the terminal facts.** Rejected by the owner's ruling that CI becomes non-interactive mode.
- **No automatic color under CI at all.** Rejected for supports-color's list, which chalk-based tools follow, so a Loom application colors the same CI logs they color. The owner's ruling: "Whatever meets common standards".
- **Let the interaction mark turn interaction on under CI.** Rejected. ADR-0082's mark can only turn interaction off, and `CI=false` already gives the operator the way back.

## Consequences

A run that a CI runner starts on a pseudo-terminal no longer waits for an answer. An application that asks in CI fails with the sentence that names the option to supply. On a CI pseudo-terminal, color appears only where supports-color expects the log viewer to render it, and no run waits on a background query. The self-update plugin reads `CI` by the same ci-info rule for its update notices.

## Status

Proposed. It moves to accepted with the 0.16.0 release, which ships it.

## Changelog

- 2026-10-27: Proposed with the rendering and background rules, after the owner ruled the background query skips under CI and color follows common standards.
- 2026-10-27: Proposed. It records the live-region rule shipped in PR 293 and its `CI=false` reading from PR 298, and adds the interaction decision.
