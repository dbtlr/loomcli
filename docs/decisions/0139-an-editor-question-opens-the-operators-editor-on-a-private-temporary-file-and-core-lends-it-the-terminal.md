---
type: adr
title: ADR-0139 - An editor question opens the operator's editor on a private temporary file, and core lends it the terminal
description: A sixth question kind, editor, waits for Enter and then opens the editor VISUAL, EDITOR, or vi names, through /bin/sh as help's pager runs PAGER, on a file in a private folder under host.tmpdir that holds the prefill. Its answer is the saved text exactly. It links, prefills, skips, and validates as text does. An editor that cannot start or exits with a code other than 0, and a file the question cannot write, fail the run with EditorError. While the editor runs, the question leaves raw mode and starts it inside a new core method, out.lendTerminal, which ends the bottom frame's row, holds every live region still, and draws a fresh stack below whatever the child wrote when it exits, erasing nothing. This narrows ADR-0082's kinds, exports, link clause, and leaving clause, ADR-0138's count of kinds, ADR-0091's rules that core redraws regions around every write and that the failure report is last, ADR-0106's terminal users' suspend and resume handlers, and ADR-0115's rule that the pager is the one child that runs through a shell.
status: proposed
created: 2026-11-04
modified: 2026-11-04
---

# ADR-0139 - An editor question opens the operator's editor on a private temporary file, and core lends it the terminal

## Context

The [prompts reference](../libs/prompts.md#not-shipped) lists an editor question as not shipped. A commit message, release notes, or a description runs to several lines, and a one-line text question cannot hold it. git, Inquirer's `editor`, and gh open the operator's own editor on a temporary file for this, and an operator expects the same editor there.

Several facts already fit the change.

- **The pager.** [ADR-0115](0115-help-pages-a-long-page-through-the-operators-pager-on-opt-in.md) runs the operator's `PAGER` through `/bin/sh -c 'exec …'` with `host.spawn`, passes the run's signal so the run's abort ends it, holds an `onShutdown` handler that sends it `SIGTERM`, and reads 126 and 127 as a program that could not start. A mock scripts `/bin/sh` to test it.
- **An interactive child.** [ADR-0107](0107-a-run-reads-the-process-through-one-process-handle.md)'s `host.spawn` gives a child the run's own stdin with `stdin: 'inherit'`, so an editor reads the operator's keys.
- **The text question.** Text links one string option or argument, prefills from the supplied value, the question's default, or the declared default, and validates a submitted answer with its own `validate`, under [ADR-0082](0082-an-action-asks-through-the-prompts-library-and-one-interaction-decision-governs-questions-and-conditional-requiredness.md) and [ADR-0136](0136-a-multiple-string-option-or-a-string-argument-may-be-required-only-when-input-is-not-interactive-and-a-question-may-link-an-argument.md).
- **No way to hand over the screen.** [ADR-0091](0091-live-regions-stack-at-the-bottom-of-stderr-and-progress-reaches-invoke-callers-and-mcp-clients-as-typed-events.md) has core erase and redraw the regions around every write, and [ADR-0106](0106-a-signal-ends-the-process-within-one-bounded-shutdown.md) has core erase them on a suspend and redraw them on every resume. An input region holds the other regions' frames, but nothing holds the input region's own, and a resume after Ctrl-Z redraws the stack whatever owns the screen. A child that draws on the terminal has no way to stop core drawing over it.
- **Stdout plays no part.** The interaction decision reads stdin and stderr alone, so `app release > notes.log` still asks, and an editor that writes its screen to the run's stdout would draw into the log.

## Decision

- **A sixth kind.** `@loomcli/prompts` exports `editor(context, settings)`, with the type parameters and return type of `text`, and `EditorSettings`, which holds `message`, `default`, `validate`, `extension`, and the link. It links one string option or one string argument, prefills, skips, and validates as text does, and resolves with interaction off as every kind does. There is no secret editor question.
- **When it opens.** The question waits for Enter, with the hint `Press Enter to open your editor`, and opens the editor at each Enter, so the operator sees the question before an editor takes the screen. It discards keys typed ahead at an earlier question when it opens. While it waits, Enter opens and Ctrl-D ends input, and every other key is ignored.
- **Which editor.** `VISUAL`, then `EDITOR`, then `vi`, literally, whatever `TERM` holds, with a blank variable read as unset.
- **Through the shell.** The question starts `/bin/sh` with `-c`, the script `exec 1>&2; exec <command line> "$@"`, the command line as `$0`, and the file's path, as ADR-0115 runs `PAGER`, so a quoted path and `code --wait` work and the shell replaces itself with the editor. The editor's stdin and stderr are the run's, and its stdout is stderr, through the shell's `exec 1>&2`, because a question's terminal is stdin and stderr. The redirect is a command of its own ahead of the command line, so a `#` or a line break in the command line cannot comment it out. The question passes `host.spawn` a signal that aborts with the run's signal or its own region's.
- **The file.** At the first Enter, the question creates a folder of mode `0700` in `host.tmpdir`, named for the application, and in it `answer` and the `extension`, which takes its leading dot or not, created new with mode `0600`. The file starts with the prefill as UTF-8. The question removes the folder on every path that ends it, and an `onShutdown` handler removes it when a shutdown cuts the run off.
- **The answer.** The answer is the text the file holds when the editor exits with 0, trailing line break included, so a launcher that exits at once, such as `code` without `--wait`, answers the prefill. Decoding keeps a leading byte order mark, as `TextDecoder` with `ignoreBOM: true` does, and changes nothing; trimming and removing the mark are the validator's. A rejected answer draws its issue, and Enter reopens the editor on the saved text. A file the editor removed or left unreadable and a file that is not UTF-8 draw issues of their own and ask again, and a removed or unreadable file comes back holding the bytes it held when that editor opened.
- **Editor failures.** Three outcomes fail the run with `EditorError`. An editor that cannot start, an `unstarted` shell or exit 126 or 127, fails with a sentence that says to set `VISUAL` or `EDITOR`. Any other code but 0 fails naming the editor and the code, a shell's syntax error, a non-zero exit, included. A file the question cannot create or write fails with a sentence that names `host.tmpdir` and says to set `TMPDIR`. Each sentence ends by telling the operator to run the command again. `EditorError` extends `FatalError` with the failure code `editor-failed` and exit 1, and carries `editor` and `status`, which is `undefined` when nothing exited. An editor that exits because the run was cancelled ends the question as a cancellation.
- **Handing the terminal over.** Before the editor starts, the question draws its editing frame, `Waiting for your editor to close the file…`, stops reading stdin, discards every queued key, leaves raw mode, turns bracketed paste off, and shows the cursor. It starts the editor inside `out.lendTerminal(work)`, a new member of core's `Out`. Before `work` runs, core ends the bottom frame's row with a line break, so the child's output starts on a row of its own. While `work` runs, core draws no region's frame, a write through `out` lands as it is without erasing or redrawing the stack, and core's suspend and resume write nothing. When `work` settles, core writes one line break, draws a fresh stack at the start of the row it opens, and returns `work`'s result. Core does not erase or overwrite anything the child wrote, so every row the child wrote stays intact, and the frame drawn before the lend stays in scrollback because core never erases rows the child may have written. The cost is one blank row after a child that leaves the cursor at the start of an empty row, such as an editor that restores the alternate screen. A failure report and the incomplete-result line wait until every lend settles, so the report stays last.
- **Keys and signals during the lend.** The question's own suspend and resume handlers do nothing while the editor runs, so a resume enters no raw mode. Because core's resume redraws nothing during a lend, after `fg` with a graphical editor open no frame shows until the editor exits: core cannot tell a graphical editor from a terminal editor, whose screen a redraw would land on. Node and Bun cannot flush terminal input, so keys typed into the terminal during the lend are not discarded: the cooked terminal echoes them, and when the question reads again they arrive as typeahead, as keys typed after the editor exits do. An Enter typed there can reopen the editor after a rejected answer or answer the next question. A Ctrl-C that reaches Loom, while the question waits for Enter or as the `SIGINT` the terminal delivers while a graphical editor runs, ends the run with the code of its cancellation, 130 for Ctrl-C (`SIGINT`), as everywhere else: the run's signal sends the editor `SIGTERM`, and the cancelled line the question draws at the abort lands when the lend ends. Inside a terminal editor such as vim or nano, Ctrl-C belongs to the editor, because the editor turns the terminal's interrupt key off; an operator backs out by quitting the editor with an error, such as vim's `:cq`, which fails the run with `EditorError` naming the editor and its exit code, as git aborts a commit.
- **One frame view.** `questionFrame`'s data gains the variant `EditorFrame`, `{ kind: 'editor', message, issue, editing }`, which never holds the text being edited. `answeredLine`'s `kind` gains `'editor'`, its data gains the optional `lines`, and the editor's answered line draws the first line with visible text, one that holds more than `White_Space` characters and U+FEFF, and a count of the other lines, fitted to one row.
- **Platforms.** The editor needs `/bin/sh`, as the pager does: Linux and macOS.

The contract is in the [prompts reference](../libs/prompts.md#the-editor-question) and, for the lend, [Output](../core/output.md#lending-the-terminal).

## Considered options

- **Open the editor when the question opens.** Rejected. The editor would take the screen before the operator read what it asks for, and a typed-ahead Enter could never tell the two apart.
- **Inherit the run's stdout, as git does.** Rejected. Interaction ignores stdout, so under `app release > notes.log` a terminal editor would draw into the log while the operator faced a terminal that showed nothing.
- **Close the question's input region while the editor runs and open another after.** Rejected. The other regions would draw again as soon as it closed, so a progress line's timer would draw over the editor, and a resume after Ctrl-Z would still redraw the stack over it.
- **Erase the stack for the lend, as a suspend does.** Rejected. A graphical editor such as `code --wait` leaves the terminal alone, and the operator would face an empty screen with no word of what the run waits for, which is why git prints its waiting hint. A full-screen editor uses the alternate screen and never sees the stack.
- **Erase the frame drawn before the lend when it ends, and redraw in its place.** Rejected. The rows above the cursor may be the child's: a shell's `nano: 1: exec: nano: not found`, emacsclient's `Waiting for Emacs...`, a terminal editor's lines on the main screen, or echoed keys. Erasing them deletes what the operator needs to read, and a count of the stack's rows says nothing about how many the child wrote, so stale rows could stay.
- **Redraw on a resume during the lend.** Rejected. A terminal editor redraws its own screen when it continues, and core cannot tell it from a graphical editor, so a frame core drew then would land on the editor's screen.
- **Skip `VISUAL` under `TERM=dumb`, as git does.** Not chosen. The order is literal: `VISUAL`, then `EDITOR`, then `vi`.
- **Remove a leading byte order mark.** Not chosen. The answer is the saved text exactly, and a validator that wants the mark gone removes it, as it trims.
- **Hold every write through `out` during the lend.** Rejected. A `work` that awaited a write would wait for itself, and a write beside a running question is the author's code running in parallel, which lands where it lands beside any interactive child.
- **A file directly in the temporary folder, mode `0600`.** Rejected. An editor writes swap, backup, and undo files beside the file with its own modes, in a folder every user can list, and a private folder covers every file an editor writes beside the answer file. Files an editor keeps elsewhere, such as Neovim's swap and undo folders and VS Code's backups, stay the editor's to protect.
- **Trim the answer or strip comment lines, as git strips `#` lines.** Rejected. The answer is the operator's saved text, and an author who wants it trimmed transforms it in `validate`, which every other kind's answer already passes through.
- **A secret editor question.** Rejected. The answer would sit in files the question cannot promise to remove, a swap file and an undo file among them.
- **Ask again when the editor exits with an error.** Rejected. Exiting with an error, such as vim's `:cq`, is how an operator abandons an edit under git, and the run fails as git aborts the commit.
- **An `editor` setting that names the editor.** Not chosen. `VISUAL` and `EDITOR` are the operator's standard, and an application that wants another editor sets one in the environment it starts.
- **A frame view of the editor's own.** Rejected, as ADR-0138 rejects one for multiselect: one view lets an override restyle every question, and the union discriminates by `kind`.

## Consequences

- `@loomcli/prompts` exports `editor`, `EditorSettings`, and `EditorError`, and `@loomcli/prompts/views` exports `EditorFrame`. The editor question reads and writes its file through `node:fs`, which ADR-0107 leaves outside the process handle.
- `@loomcli/core`'s `Out` gains `lendTerminal`, a new member of a sealed type, so it breaks nothing, and its API report gains the member. `@loomcli/testing`'s builders answer it by calling `work`.
- The rule `@loomcli/prompts/link` gains the editor among the kinds that link one string value, and its explanation is unchanged.
- The glossary gains Editor question and Terminal lend, and Question and Child program widen.
- **Breaking changes.** `questionFrame`'s data is in read position for a view override, and it gains an object variant, which the [changelog rules](../../.changes/README.md#explain-a-breaking-change) count as breaking: an override that switches on `kind` with an exhaustive check no longer compiles, and one that falls through for an unknown kind draws whatever its default case draws when the application asks an editor question. `answeredLine`'s data is in read position too, and it changes in two ways those rules count as not breaking: its optional `kind`, a string-literal union, gains `'editor'`, and it gains the optional `lines`.
- **One fragment.** The implementing PR adds `.changes/breaking.editor-question.md` with this text:

  ````markdown
  - Add `editor`, a question that waits for Enter, opens the operator's editor, named by `VISUAL`, `EDITOR`, or `vi`, on a private temporary file that holds the prefill, and answers the text the file holds when the editor exits. It links a string option or a string argument that takes one value, prefills, skips, and validates as `text` does, takes an `extension` for the file, and fails with `EditorError` when the editor cannot start, exits with a code other than 0, or the question cannot write the editor's file.
  - Add `out.lendTerminal(work)` to `@loomcli/core`, which holds every live region still while `work` runs a child program that draws on the terminal, and draws them again below whatever the child wrote once it settles.
  - Add the `editor` member, `EditorFrame`, to `questionFrame`'s data, and to `answeredLine`'s data the `kind` `'editor'` and an optional `lines`.

  ### Migration

  **Affected surface.** A view override of `questionFrame` from `@loomcli/prompts/views` that switches on its data's `kind`.

  **Why.** An editor question draws through `questionFrame` with a frame of its own, `{ kind: 'editor', message, issue, editing }`, so the data's union gains a variant.

  **Before and after.**

  Before, in a `questionFrame` override with an exhaustive check:

  ```ts
  switch (data.kind) {
    case 'text':
    case 'secret':
    case 'confirm':
      return drawTyped(data);
    case 'select':
    case 'multiselect':
      return drawList(data);
    default:
      return assertNever(data);
  }
  ```

  After:

  ```ts
  switch (data.kind) {
    case 'text':
    case 'secret':
    case 'confirm':
      return drawTyped(data);
    case 'select':
    case 'multiselect':
      return drawList(data);
    case 'editor': {
      const hint = data.editing ? 'Waiting for your editor to close the file…' : 'Press Enter to open your editor';
      const line = `? ${data.message} › ${hint}`;
      return data.issue === undefined ? line : `${line}\n  ✘ ${data.issue}`;
    }
    default:
      return assertNever(data);
  }
  ```

  **Steps.**

  1. In a `questionFrame` override, handle the `'editor'` kind: draw its `message`, its `issue` when it has one, and a hint that reads `editing`, which is `true` while the editor is open.
  2. Where an override falls through to a default case for a kind it does not know, check that the default draws a frame an editor question can show.

  **Validation.** Run `tsc --noEmit` to type-check every override with an exhaustive check. Run the application's test command, such as `vitest run` or `bun test`, with a test that draws the overridden `questionFrame` through `viewContext` with an `EditorFrame` and asserts the text it draws.
  ````

- ADR-0082's clauses that the library exports four kinds and that text, secret, and select link a string option that is not multiple are narrowed by this record, as ADR-0138's clause that adds a fifth kind is. ADR-0082's leaving clause gains the editor's exception to raw mode. ADR-0091's rules that core redraws the stack around every other write and that the failure report is last gain the lend, during which core draws no frame and after which it erases nothing, and for which the report waits. ADR-0106's terminal users' suspend and resume handlers write nothing during a lend, and a question's do nothing while its editor runs. ADR-0115's rule that Loom's other children keep no shell gains the editor, which runs through one for the reason the pager does. Each carries a dated entry.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-04: Proposed with the contract for the editor question (LM-462). It narrows ADR-0082's kinds, exports, link clause, and leaving clause, ADR-0138's count of kinds, ADR-0091's redraw and report rules, ADR-0106's terminal users' suspend and resume handlers, and ADR-0115's no-shell rule for Loom's other children. Each carries a dated entry.
