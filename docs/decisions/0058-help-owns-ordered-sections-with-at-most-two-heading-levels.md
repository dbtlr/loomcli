---
type: adr
title: ADR-0058 - Help owns ordered sections with at most two heading levels
description: Commands and options declare help section membership as one or two heading strings. Each page owns separate partial orders for Command sections and option sections, and named option sections combine local and global members. The help plugin owns every field and both help variants use the same layout.
status: proposed
created: 2026-10-05
modified: 2026-10-05
---

# ADR-0058 - Help owns ordered sections with at most two heading levels

## Context

Help prints Commands and options as flat lists. Applications with many Commands need headings for areas of work and subsections within those areas. Replacing the entire `helpPage` view duplicates help's existing layout, filtering, and row facts just to add headings.

Sections belong to help's content, beside the existing help extensions. Core already supplies descriptor-keyed values on Commands and options. A Command supplied by a plugin is an ordinary Command under [ADR-0033](0033-a-plugin-attaches-ordinary-commands-to-the-root.md), so its membership follows the same rule as an application's Command.

[Commander](https://github.com/tj/commander.js#help-groups) has independent Command and option help groups. [Cobra](https://github.com/spf13/cobra/blob/main/site/content/user_guide.md#grouping-commands-in-help) declares Command groups on the parent, in display order, with membership on each child. Both support flat headings. [Optique](https://optique.dev/concepts/runners#section-ordering) instead allows mixed sections and a page-wide ordering comparator. Two heading levels serve a page with an area such as Work commands and a subsection such as Read, without introducing unrestricted nesting.

## Decision

- **Help owns membership.** `helpCommand` and `helpInput` gain optional `section` fields. A path contains exactly one or two heading strings, each checked by help's existing `line` schema. Matching uses each heading's uppercase form, the form help prints, while stored values retain their authored strings. A child's membership places its row on the parent's page. An option's membership places its row wherever that option appears. Membership does not enclose the declaring Command's own page.
- **Defaults are sections.** Unsectioned members retain COMMANDS, OPTIONS, and GLOBAL OPTIONS, with the existing childless-root folding. An authored section replaces the default for its members. A default path participates in matching and ordering like any authored path.
- **The page owns ordering.** `helpCommand` gains optional `commandSections` and `optionSections` lists of paths. Each list is a partial order within its own part of the page. Listed headings come first at each level, followed by unlisted headings in first visible appearance order. A path for an absent inner section is ignored entirely, even when its outer heading is visible through another subsection. An outer-heading-only path can position that visible heading. Outer sections remain together, and direct members precede subsections. A page reads its own order alone. No order inherits along a Command path.
- **One named option section.** Local and global options with the same path share one section, with local members first. Unsectioned options retain the separate defaults except on a childless root. Plugin-declared global options use the same rule.
- **One layout for both variants.** Outer headings are uppercase at the left margin. Inner headings and direct members are indented two spaces, and inner members four spaces. One blank line separates outer blocks, with no blank line inside a block. Each direct row list and each inner section measures its columns independently. The existing semantic styles, literal escaping, hidden filtering, row facts, and final newline apply.
- **The graph remains the source.** All fields live in ordinary extension values. Core gains no field, and graph lists stay in authoring order. Help still supplies only details and examples to the manifest's collecting extension under [ADR-0031](0031-a-plugin-supplies-facts-to-another-plugins-projection-through-a-collecting-extension.md). Manifest and completion keep their existing order and content. A whole-page view replacement reads section facts through `readExtension`.

This record narrows ADR-0033's consequence that plugin-attached Commands lead the help page's rows: a page's authored section order may put another section first. Attachment order, member order within a section, and the manifest's child order retain that record's rules. No plugin-specific section is introduced.

## Considered options

- **An unrestricted path.** Rejected. Two levels cover an outer heading and a subsection, and the path's type and runtime schema make that bound explicit.
- **Separate outer-heading and inner-heading fields.** Rejected. A bounded path keeps the related headings together and uses one shape for membership and order entries.
- **One application-wide order.** Rejected. Root and child pages may organize their members differently. The declaring parent already owns the page that lists those members.
- **One order that interleaves Commands and options.** Rejected. Separate lists preserve the existing help page parts and match Commander's category separation.
- **A complete order listing every section.** Rejected. A plugin can contribute a member in a new section, and an author need not repeat every section to prioritize a few.
- **Separate named local and global option sections.** Rejected. Matching headings would appear twice. An authored option section groups its members together, while unsectioned options preserve the familiar scope defaults.

## Consequences

The existing descriptors gain optional fields, and the help renderer groups rows before rendering them. Applications without section fields keep their help bytes. The descriptor module still exports three descriptors, and no new authoring call, view, or core declaration is needed. The implementation carries an ordinary change fragment because no existing application must change its code.

## Status

Proposed 2026-10-05 with [Ordered help sections](../core.md#ordered-help-sections). It moves to accepted in the release PR that ships the implementation, after the public API, validation, layout, default compatibility, and packed-package acceptance run under Node and Bun.

## Changelog

- 2026-10-05: Proposed with the ordered help sections contract.
- 2026-10-05: Implementation adds the descriptor fields and shared section renderer. textstat groups its counting options, and jsonkit groups its document Commands. Runtime fixtures and packed consumers cover both help variants, combined named option sections, and unchanged unsectioned pages. The record stays proposed until the release PR accepts it.
