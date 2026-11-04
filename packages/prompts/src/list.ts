import { escapeControlCharacters, validateLinkedValue } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';

import { TypedLine, graphemes } from './line.js';
import { invalid, resolveLink } from './link.js';
import { asking } from './question.js';
import { openReader } from './reader.js';
import type { ChoiceEntry, ChoiceSource, PromptContext } from './types.js';
import type { ChoiceRow, SeparatorRow } from './views.js';

function quoted(list: unknown[]): string {
  return list.map((value) => `"${escapeControlCharacters(String(value))}"`).join(', ');
}
interface Item {
  value: unknown;
  row: ChoiceRow;
}
function item(entry: ChoiceEntry): Item | undefined {
  if (typeof entry !== 'string' && 'separator' in entry) {
    return undefined;
  }
  const object = typeof entry === 'string' ? { value: entry } : entry;
  return {
    row: {
      description: object.description,
      disabled: object.disabled === true || typeof object.disabled === 'string',
      kind: 'choice',
      label: object.label ?? String(object.value),
      reason:
        typeof object.disabled === 'string' && object.disabled !== '' ? object.disabled : undefined,
      selected: false,
    },
    value: object.value,
  };
}
function row(entry: ChoiceEntry): ChoiceRow | SeparatorRow {
  return (
    item(entry)?.row ?? {
      kind: 'separator',
      label: typeof entry !== 'string' && 'separator' in entry ? entry.separator : '',
    }
  );
}
/**
 * The values a prefill matches: the first of `candidates` that is present, where `undefined` is
 * absence and `null` is a value. A multiselect's prefill is a list, and a select's is one value.
 */
function prefillValues(candidates: readonly unknown[], multiple: boolean): readonly unknown[] {
  const prefill = candidates.find((candidate) => candidate !== undefined);
  if (prefill === undefined) {
    return [];
  }
  if (multiple) {
    return Array.isArray(prefill) ? prefill : [];
  }
  return [prefill];
}
interface ListSettings<Options, Args> {
  message: string;
  option?: keyof Options & string;
  argument?: keyof Args & string;
  skipIfSupplied?: boolean;
  choices?: readonly ChoiceEntry[];
  source?: ChoiceSource;
  search?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
}

/** Both list kinds share source ownership, navigation, prefill, and selection identity. */
async function askList<Options, Args>(
  context: PromptContext<Options, Args>,
  settings: ListSettings<Options, Args>,
  multiple: boolean,
): Promise<unknown> {
  const kind = multiple ? 'multiselect' : 'select';
  const min = settings.min ?? 0;
  const max = settings.max;
  const available = settings.choices?.filter((entry) => {
    const choice = item(entry);
    return choice !== undefined && !choice.row.disabled;
  }).length;
  if (multiple && max !== undefined && min > max) {
    invalid(
      `The multiselect question "${settings.message}" has min ${min} above max ${max}.`,
      'Set min at or below max.',
    );
  }
  if (available !== undefined) {
    if (available === 0) {
      invalid(
        `The ${kind} question "${settings.message}" has no choice that is not disabled.`,
        'Supply at least one choice that is not disabled.',
      );
    }
    if (multiple && available < min) {
      invalid(
        `The multiselect question "${settings.message}" has min ${min} and ${available} choices that are not disabled.`,
        'Supply at least min choices that are not disabled.',
      );
    }
  }
  // Resolve keys through the same declaration and presence checks every question uses.
  const resolved = resolveLink(context, settings, kind);
  if (resolved.kind === 'answered') {
    return resolved.value;
  }
  const raw =
    settings.argument === undefined
      ? context.supplied.options[settings.option ?? '']
      : context.supplied.args[settings.argument];
  const supplied = raw !== undefined && (!Array.isArray(raw) || raw.length > 0);
  const values = prefillValues(
    [supplied ? raw : undefined, settings.default, resolved.prefill],
    multiple,
  );
  const search = settings.search === true || settings.source !== undefined;
  const line = new TypedLine();
  const reader = openReader(context);
  const draw = asking(context, { kind, message: settings.message }, reader);
  let entries: readonly ChoiceEntry[] = settings.choices ?? [];
  let highlighted: number | undefined = undefined;
  let start = 0;
  let issue: string | undefined = undefined;
  const selection: Item[] = [];
  let answered: { value: string } | undefined = undefined;
  let controller: AbortController | undefined = undefined;
  const controllers: AbortController[] = [];
  let pending: Promise<void> = Promise.resolve();
  const stopped = new Promise<never>((_resolve, reject) => {
    draw.signal.addEventListener('abort', () => reject(draw.signal.reason), { once: true });
  });
  void stopped.catch(() => {});
  const wait = () => Promise.race([pending, stopped]);
  let loading = false;
  let first = true;
  const failure: { current?: { error: unknown } } = {};
  const checkFailure = () => {
    if (failure.current) {
      throw failure.current.error;
    }
  };
  const selectable = () =>
    entries.flatMap((entry, index) => {
      const choice = item(entry);
      return choice && !choice.row.disabled ? [index] : [];
    });
  const reset = () => {
    highlighted = selectable()[0];
    start = 0;
  };
  const frame = () => {
    const positions = selectable();
    const rows = context.host.terminal.stderr.rows;
    const count = Math.min(7, rows && rows > 0 ? Math.max(1, rows - 4) : 7);
    start = Math.max(0, Math.min(start, Math.max(0, entries.length - count)));
    if (highlighted === undefined || highlighted === positions[0]) {
      start = 0;
    }
    if (highlighted !== undefined) {
      if (highlighted === positions.at(-1)) {
        start = Math.max(0, entries.length - count);
      }
      start = Math.min(start, highlighted);
      if (highlighted >= start + count) {
        start = highlighted - count + 1;
      }
    }
    const choices = entries.slice(start, start + count).map((entry) => {
      const rendered = row(entry);
      const choice = item(entry);
      return rendered.kind === 'separator'
        ? rendered
        : {
            description: rendered.description,
            disabled: rendered.disabled,
            kind: rendered.kind,
            label: rendered.label,
            reason: rendered.reason,
            selected:
              multiple && selection.some((chosen) => Object.is(chosen.value, choice?.value)),
          };
    });
    const data = {
      above: start,
      below: Math.max(0, entries.length - start - count),
      choices,
      cursor: line.cursor,
      highlighted: highlighted === undefined ? undefined : highlighted - start,
      issue,
      loading,
      message: settings.message,
      rows,
      term: search ? line.value : undefined,
    };
    return multiple
      ? draw.frame({ ...data, count: selection.length, kind: 'multiselect', max, min })
      : draw.frame({ ...data, kind: 'select' });
  };
  const applyPrefill = async () => {
    const missing: unknown[] = [];
    const limited: unknown[] = [];
    const unique = values.filter(
      (value, index) => values.findIndex((other) => Object.is(value, other)) === index,
    );
    for (const value of unique) {
      let match = entries
        .map(item)
        .find((choice) => choice !== undefined && Object.is(choice.value, value));
      if (match === undefined && supplied && typeof value === 'string' && settings.source) {
        const lookup = new AbortController();
        controllers.push(lookup);
        const called = settings.source(value, { signal: lookup.signal });
        let found: readonly ChoiceEntry[] = [];
        if (Array.isArray(called)) {
          found = called;
        } else {
          // A lookup is a call of the source, so the frame shows it loading until it settles.
          if (!loading) {
            loading = true;
            await frame();
          }
          found = await Promise.race([Promise.resolve(called), stopped]);
        }
        match = found
          .map(item)
          .find((choice) => choice !== undefined && Object.is(choice.value, value));
        if (!multiple && match !== undefined && !match.row.disabled) {
          entries = found;
          line.value = value;
          line.cursor = graphemes(value).length;
        }
      }
      if (match === undefined || match.row.disabled) {
        if (supplied) {
          missing.push(value);
        }
        continue;
      }
      if (multiple) {
        if (max !== undefined && selection.length >= max) {
          if (supplied) {
            limited.push(value);
          }
        } else {
          selection.push(match);
        }
      } else {
        highlighted = entries.findIndex((entry) => Object.is(item(entry)?.value, value));
      }
    }
    issue =
      [
        missing.length ? `Cannot select ${quoted(missing)}. Choose from the list.` : '',
        limited.length
          ? `Cannot select ${quoted(limited)}: at most ${max} can be selected. Deselect a choice to select ${limited.length === 1 ? 'it' : 'one'}.`
          : '',
      ]
        .filter(Boolean)
        .join(' ') || undefined;
  };
  const settle = async (found: readonly ChoiceEntry[], signal: AbortSignal) => {
    if (signal.aborted) {
      return;
    }
    entries = found;
    reset();
    if (first) {
      first = false;
      await applyPrefill();
    }
    if (signal.aborted) {
      return;
    }
    loading = false;
    await frame();
  };
  const load = () => {
    controller?.abort();
    controller = new AbortController();
    controllers.push(controller);
    const signal = controller.signal;
    loading = false;
    const result = settings.source?.(line.value, { signal }) ?? [];
    if (Array.isArray(result)) {
      pending = settle(result, signal);
    } else {
      loading = true;
      pending = Promise.resolve(result)
        .then((found) => settle(found, signal))
        .catch((error: unknown) => {
          if (!signal.aborted) {
            failure.current = { error };
            reader.abandon(error);
          }
        });
    }
  };
  const abort = () => {
    for (const call of controllers) {
      call.abort();
    }
  };
  draw.signal.addEventListener('abort', abort, { once: true });
  context.signal.addEventListener('abort', abort, { once: true });
  try {
    if (settings.source) {
      load();
      // The loading frame draws first; only keys wait for the prefill, and settling draws the list.
      if (loading) {
        await frame();
      }
      if (supplied || !loading) {
        await wait();
      }
    } else {
      reset();
      await applyPrefill();
      await frame();
    }
    while (true) {
      checkFailure();
      const key = await reader.read();
      const toggle =
        multiple && (key.kind === 'tab' || (!search && key.kind === 'text' && key.value === ' '));
      const navigation =
        ['up', 'down', 'previous', 'next'].includes(key.kind) ||
        (!search && ['home', 'end'].includes(key.kind));
      if (toggle || navigation || key.kind === 'enter') {
        await wait();
        checkFailure();
      }
      // A list that does not search never edits its line, so Ctrl-D always ends input there.
      if (key.kind === 'eof' && line.value === '') {
        context.cancel();
        context.signal.throwIfAborted();
      }
      if (key.kind === 'enter') {
        const highlightedItem =
          highlighted === undefined ? undefined : item(entries[highlighted] ?? { separator: '' });
        const current = highlightedItem?.row.disabled === false ? highlightedItem : undefined;
        if (!multiple && !current) {
          issue = 'No choice can be selected. Change the search.';
          await frame();
          continue;
        }
        if (multiple && selection.length < min) {
          issue = `Choose at least ${min}.`;
          await frame();
          continue;
        }
        const single = current ? [current] : [];
        const chosen = multiple ? selection : single;
        const outputs: unknown[] = [];
        issue = undefined;
        for (const choice of chosen) {
          let result: StandardSchemaV1.Result<unknown> = { value: choice.value };
          if (typeof choice.value === 'string') {
            if (settings.option !== undefined) {
              result = await validateLinkedValue(
                context,
                { message: settings.message, option: settings.option },
                choice.value,
              );
            } else if (settings.argument !== undefined) {
              result = await validateLinkedValue(
                context,
                { argument: settings.argument, message: settings.message },
                choice.value,
              );
            }
          }
          context.signal.throwIfAborted();
          if (result.issues !== undefined) {
            issue = `${multiple ? `${choice.row.label}: ` : ''}${result.issues[0]?.message ?? 'The answer is invalid.'}`;
            break;
          }
          outputs.push(result.value);
        }
        if (issue !== undefined) {
          await frame();
          continue;
        }
        answered = { value: chosen.map((choice) => choice.row.label).join(', ') };
        return multiple ? outputs : outputs[0];
      }
      if (navigation) {
        const positions = selectable();
        const position = highlighted === undefined ? -1 : positions.indexOf(highlighted);
        if (key.kind === 'home') {
          highlighted = positions[0];
        } else if (key.kind === 'end') {
          highlighted = positions.at(-1);
        } else {
          highlighted =
            positions[
              Math.max(
                0,
                Math.min(
                  positions.length - 1,
                  position + (key.kind === 'up' || key.kind === 'previous' ? -1 : 1),
                ),
              )
            ];
        }
      } else if (toggle && highlighted !== undefined) {
        const choice = item(entries[highlighted] ?? { separator: '' });
        if (choice && !choice.row.disabled) {
          const index = selection.findIndex((chosen) => Object.is(chosen.value, choice.value));
          if (index !== -1) {
            selection.splice(index, 1);
            issue = undefined;
          } else if (max === undefined || selection.length < max) {
            selection.push(choice);
            issue = undefined;
          }
        }
      } else if (search) {
        const before = line.value;
        if (key.kind === 'escape') {
          line.value = '';
          line.cursor = 0;
        } else {
          line.edit(key.kind, key.kind === 'text' || key.kind === 'paste' ? key.value : '');
        }
        if (before !== line.value) {
          issue = undefined;
          if (settings.source) {
            load();
            if (!loading) {
              await wait();
            }
          } else {
            entries =
              line.value === ''
                ? (settings.choices ?? [])
                : (settings.choices ?? []).filter((entry) =>
                    item(entry)?.row.label.toLowerCase().includes(line.value.toLowerCase()),
                  );
            reset();
          }
        }
      }
      await frame();
    }
  } finally {
    abort();
    context.signal.removeEventListener('abort', abort);
    draw.signal.removeEventListener('abort', abort);
    await draw.finish(answered, reader.close());
  }
}

export { askList };
