import { validateLinkedValue } from '@loomcli/core';
import type { Region, StandardSchemaV1 } from '@loomcli/core';

import { TypedLine, graphemes } from './line.js';
import { askLineByLine } from './lines.js';
import type { LineAsking } from './lines.js';
import { invalid, resolveLink } from './link.js';
import {
  choiceIssue,
  chooseAtLeast,
  chooseAtMost,
  invalidAnswer,
  noSelectableChoice,
  overLimit,
  typeNumbers,
  typeOneNumber,
  unselectable,
} from './messages.js';
import { asking, liveReader } from './question.js';
import type { ChoiceEntry, ChoiceSource, PromptContext } from './types.js';
import type { ChoiceRow, NumberedChoice, SeparatorRow } from './views.js';

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
function separatorRow(entry: ChoiceEntry): SeparatorRow {
  return {
    kind: 'separator',
    label: typeof entry !== 'string' && 'separator' in entry ? entry.separator : '',
  };
}
function row(entry: ChoiceEntry): ChoiceRow | SeparatorRow {
  return item(entry)?.row ?? separatorRow(entry);
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

/**
 * The issue a supplied value that selects nothing prints: the values no choice matches, or a
 * disabled one does, and the values past `max`.
 */
function prefillIssue(
  missing: readonly unknown[],
  limited: readonly unknown[],
  max: number | undefined,
): string | undefined {
  return (
    [
      missing.length ? unselectable(missing) : '',
      limited.length > 0 && max !== undefined ? overLimit(limited, max) : '',
    ]
      .filter(Boolean)
      .join(' ') || undefined
  );
}

/**
 * Runs each chosen value through the linked input's validator, as a linked question returns the
 * input's own value, and answers the outputs, or the issue of the first value it refused.
 */
async function validateChosen<Options, Args>(
  context: PromptContext<Options, Args>,
  settings: ListSettings<Options, Args>,
  picked: { readonly chosen: readonly Item[]; readonly multiple: boolean },
): Promise<{ readonly outputs: unknown[] } | { readonly issue: string }> {
  const { chosen, multiple } = picked;
  const outputs: unknown[] = [];
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
      const sentence = result.issues[0]?.message ?? invalidAnswer;
      return { issue: multiple ? choiceIssue(choice.row.label, sentence) : sentence };
    }
    outputs.push(result.value);
  }
  return { outputs };
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
  // A region that is not live is a terminal that does not move its cursor, so it asks line by line.
  const region = context.out.region({ input: true });
  if (!region.live) {
    return askListLines(context, settings, { multiple, region, search, supplied, values });
  }
  const line = new TypedLine();
  const reader = liveReader(context, region);
  const draw = asking(context, { kind, message: settings.message }, { reader, region });
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
    issue = prefillIssue(missing, limited, max);
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
          issue = noSelectableChoice;
          await frame();
          continue;
        }
        if (multiple && selection.length < min) {
          issue = chooseAtLeast(min);
          await frame();
          continue;
        }
        const single = current ? [current] : [];
        const chosen = multiple ? selection : single;
        issue = undefined;
        const checked = await validateChosen(context, settings, { chosen, multiple });
        if ('issue' in checked) {
          issue = checked.issue;
          await frame();
          continue;
        }
        answered = { value: chosen.map((choice) => choice.row.label).join(', ') };
        return multiple ? checked.outputs : checked.outputs[0];
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

/** A numbered list: the rows it prints, and the choice each number chooses, from 1 in order. */
interface NumberedList {
  readonly rows: readonly (NumberedChoice | SeparatorRow)[];
  readonly numbered: readonly Item[];
}

/** Numbers every choice that is not disabled, from 1 in the list's order. */
function numberedList(entries: readonly ChoiceEntry[]): NumberedList {
  const numbered: Item[] = [];
  const rows = entries.map((entry): NumberedChoice | SeparatorRow => {
    const choice = item(entry);
    if (choice === undefined) {
      return separatorRow(entry);
    }
    if (!choice.row.disabled) {
      numbered.push(choice);
    }
    return {
      description: choice.row.description,
      kind: 'choice',
      label: choice.row.label,
      number: choice.row.disabled ? undefined : numbered.length,
      reason: choice.row.reason,
    };
  });
  return { numbered, rows };
}

/**
 * The numbers a line names, each comma-separated item with the spaces around it ignored and an
 * empty item skipped, or `undefined` when an item is not a number.
 */
function numbersIn(typed: string): number[] | undefined {
  const items = typed
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return items.every((part) => /^\d+$/u.test(part)) ? items.map(Number) : undefined;
}

/** The limits a line of numbers meets: one choice at a select, and `min` and `max` at a multiselect. */
interface Limits {
  readonly multiple: boolean;
  readonly min: number;
  readonly max: number | undefined;
}

/**
 * The choices a line of numbers chooses from `list`: one number at a select, and any count at a
 * multiselect, a number given twice counted once, in the line's order, within `min` and `max`.
 * Answers the issue that refuses the line otherwise.
 */
function chosenBy(
  numbers: readonly number[],
  list: NumberedList,
  limits: Limits,
): { readonly chosen: Item[] } | { readonly issue: string } {
  const highest = list.numbered.length;
  if (!limits.multiple) {
    const choice = numbers.length === 1 ? list.numbered[(numbers[0] ?? 0) - 1] : undefined;
    return choice === undefined ? { issue: typeOneNumber(highest) } : { chosen: [choice] };
  }
  if (!numbers.every((number) => number >= 1 && number <= highest)) {
    return { issue: typeNumbers(highest) };
  }
  const chosen = [...new Set(numbers)].flatMap((number) => list.numbered[number - 1] ?? []);
  if (chosen.length < limits.min) {
    return { issue: chooseAtLeast(limits.min) };
  }
  if (limits.max !== undefined && chosen.length > limits.max) {
    return { issue: chooseAtMost(limits.max) };
  }
  return { chosen };
}

/**
 * The choices a prefill selects in a list that does not search, and the issue a supplied value
 * that selects nothing prints, as a question that redraws matches its prefill.
 */
function prefilledChoices(
  list: NumberedList,
  entries: readonly ChoiceEntry[],
  facts: {
    readonly values: readonly unknown[];
    readonly supplied: boolean;
    readonly multiple: boolean;
    readonly max: number | undefined;
  },
): { readonly picked: Item[]; readonly issue: string | undefined } {
  const missing: unknown[] = [];
  const limited: unknown[] = [];
  const picked: Item[] = [];
  const unique = facts.values.filter(
    (value, index) => facts.values.findIndex((other) => Object.is(value, other)) === index,
  );
  for (const value of unique) {
    const match = entries
      .map(item)
      .find((choice) => choice !== undefined && Object.is(choice.value, value));
    const numbered =
      match === undefined
        ? undefined
        : list.numbered.find((choice) => Object.is(choice.value, match.value));
    if (numbered === undefined) {
      if (facts.supplied) {
        missing.push(value);
      }
    } else if (!facts.multiple) {
      picked.splice(0, picked.length, numbered);
    } else if (facts.max !== undefined && picked.length >= facts.max) {
      if (facts.supplied) {
        limited.push(value);
      }
    } else {
      picked.push(numbered);
    }
  }
  return { issue: prefillIssue(missing, limited, facts.max), picked };
}

/** The number each choice takes in `list`, from 1. */
function numbersFor(list: NumberedList, chosen: readonly Item[]): number[] {
  return chosen.map((choice) => list.numbered.indexOf(choice) + 1);
}

/** What both line forms of a list use to accept the chosen values or print the issue. */
type Answering = (
  chosen: readonly Item[],
  again: () => Promise<void>,
) => Promise<{ readonly value: unknown } | undefined>;

/**
 * Asks a select or multiselect line by line: its message, its numbered list, and the row it asks
 * on, where Enter alone takes the prefill. A search asks for a term first, prints the matches as a
 * numbered list, and then takes a line of numbers or a new term. A rejected answer prints its
 * sentence and the asking row again, not the list.
 */
async function askListLines<Options, Args>(
  context: PromptContext<Options, Args>,
  settings: ListSettings<Options, Args>,
  facts: {
    readonly multiple: boolean;
    readonly search: boolean;
    readonly supplied: boolean;
    readonly values: readonly unknown[];
    readonly region: Region;
  },
): Promise<unknown> {
  const { multiple, region } = facts;
  const limits = { max: settings.max, min: settings.min ?? 0, multiple };
  return askLineByLine(context, { message: settings.message, region }, async (line) => {
    const answer: Answering = async (chosen, again) => {
      const checked = await validateChosen(context, settings, { chosen, multiple });
      if ('issue' in checked) {
        await line.print({ issue: checked.issue, kind: 'issue' });
        await again();
        return undefined;
      }
      return { value: multiple ? checked.outputs : checked.outputs[0] };
    };
    await line.print({ kind: 'title', message: settings.message });
    if (facts.search) {
      return searchLines(settings, line, { answer, facts, limits });
    }
    const entries = settings.choices ?? [];
    const list = numberedList(entries);
    await line.print({ choices: list.rows, kind: 'list' });
    const prefill = prefilledChoices(list, entries, { ...facts, max: settings.max });
    if (prefill.issue !== undefined) {
      await line.print({ issue: prefill.issue, kind: 'issue' });
    }
    const fallback = multiple ? [] : list.numbered.slice(0, 1);
    const defaults = numbersFor(list, prefill.picked.length > 0 ? prefill.picked : fallback);
    const askingRow = () =>
      line.print({
        hint: defaults.length === 0 ? undefined : defaults.join(','),
        kind: multiple ? 'numbers' : 'number',
      });
    line.reasking(askingRow);
    await askingRow();
    while (true) {
      const typed = await line.read();
      const picked = chosenBy(
        typed.trim() === '' ? defaults : (numbersIn(typed) ?? [Number.NaN]),
        list,
        limits,
      );
      if ('issue' in picked) {
        await line.print({ issue: picked.issue, kind: 'issue' });
        await askingRow();
        continue;
      }
      const answered = await answer(picked.chosen, askingRow);
      if (answered !== undefined) {
        return answered.value;
      }
    }
  });
}

/**
 * The default a search asked line by line offers at its refine row: the choices the prefill
 * selects, as the form without search matches them. Under `choices` they are found among every
 * choice, and under a `source` among the choices its calls have answered so far.
 */
interface SearchDefault {
  readonly picked: readonly Item[];
  /** The issue a supplied value that selects none of the choices prints, under `choices` alone. */
  readonly issue: string | undefined;
}

/**
 * The hint the refine row shows for `picked`: its labels joined with `,`, `none` at a multiselect
 * that may be left empty and has no default, and `undefined` at a question that must be answered
 * and has none, whose row shows no brackets.
 */
function searchHint(picked: readonly Item[], limits: Limits): string | undefined {
  if (picked.length > 0) {
    return picked.map((choice) => choice.row.label).join(',');
  }
  return limits.multiple && limits.min === 0 ? 'none' : undefined;
}

/**
 * The search form of a select or multiselect asked line by line: `Search: `, the matches for the
 * term as a numbered list, and `Enter a number, or text to search again [us-east]: `, where a line
 * of numbers chooses from the list just printed, Enter alone takes the default in brackets, and
 * any other line is a new term. With no default in brackets, Enter alone is the empty term. A
 * source is called once for each term, and the next call and the question's end abort the call
 * before.
 */
async function searchLines<Options, Args>(
  settings: ListSettings<Options, Args>,
  line: LineAsking,
  using: {
    readonly answer: Answering;
    readonly limits: Limits;
    readonly facts: { readonly supplied: boolean; readonly values: readonly unknown[] };
  },
): Promise<unknown> {
  const { limits } = using;
  /** Every choice a source has answered, in the order its calls answered them. */
  const answered: ChoiceEntry[] = [];
  const defaultAmong = (entries: readonly ChoiceEntry[], supplied: boolean): SearchDefault =>
    prefilledChoices(numberedList(entries), entries, {
      max: limits.max,
      multiple: limits.multiple,
      supplied,
      values: using.facts.values,
    });
  const fixed =
    settings.source === undefined
      ? defaultAmong(settings.choices ?? [], using.facts.supplied)
      : undefined;
  const offered = () => fixed?.picked ?? defaultAmong(answered, false).picked;
  let call: AbortController | undefined = undefined;
  const stop = () => {
    call?.abort();
  };
  const stopped = new Promise<never>((_resolve, reject) => {
    line.signal.addEventListener(
      'abort',
      () => {
        stop();
        reject(line.signal.reason);
      },
      { once: true },
    );
  });
  void stopped.catch(() => {});
  /** The matches for one term: one call of the source, or the choices whose label holds it. */
  const matches = async (term: string): Promise<readonly ChoiceEntry[]> => {
    if (settings.source === undefined) {
      const choices = settings.choices ?? [];
      return term === ''
        ? choices
        : choices.filter((entry) =>
            item(entry)?.row.label.toLowerCase().includes(term.toLowerCase()),
          );
    }
    stop();
    call = new AbortController();
    const called = settings.source(term, { signal: call.signal });
    const found = Array.isArray(called)
      ? called
      : await Promise.race([Promise.resolve(called), stopped]);
    answered.push(...found);
    return found;
  };
  const searchRow = () => line.print({ hint: undefined, kind: 'search' });
  const refineRow = () => line.print({ hint: searchHint(offered(), limits), kind: 'refine' });
  try {
    if (fixed?.issue !== undefined) {
      await line.print({ issue: fixed.issue, kind: 'issue' });
    }
    line.reasking(searchRow);
    await searchRow();
    let term = await line.read();
    while (true) {
      const list = numberedList(await matches(term));
      line.signal.throwIfAborted();
      await line.print({ choices: list.rows, kind: 'list' });
      if (list.numbered.length === 0) {
        await line.print({ issue: noSelectableChoice, kind: 'issue' });
        line.reasking(searchRow);
        await searchRow();
        term = await line.read();
        continue;
      }
      line.reasking(refineRow);
      await refineRow();
      while (true) {
        const typed = await line.read();
        const picked = typed === '' ? offeredChoice(offered(), limits) : undefined;
        if (picked !== undefined) {
          if ('issue' in picked) {
            await line.print({ issue: picked.issue, kind: 'issue' });
            await refineRow();
            continue;
          }
          const chosen = await using.answer(picked.chosen, refineRow);
          if (chosen !== undefined) {
            return chosen.value;
          }
          continue;
        }
        const numbers = numbersIn(typed);
        // A line of numbers chooses, and any other line is a new term, Enter alone with no default.
        if (numbers === undefined || numbers.length === 0) {
          term = typed;
          break;
        }
        const numbered = chosenBy(numbers, list, limits);
        if ('issue' in numbered) {
          await line.print({ issue: numbered.issue, kind: 'issue' });
          await refineRow();
          continue;
        }
        const chosen = await using.answer(numbered.chosen, refineRow);
        if (chosen !== undefined) {
          return chosen.value;
        }
      }
    }
  } finally {
    stop();
  }
}

/**
 * What Enter alone at a search's refine row chooses: the default it offers, which a multiselect's
 * `min` may refuse, the empty selection at a multiselect that may be left empty, or `undefined`
 * when the row offers none, so Enter alone is the empty term.
 */
function offeredChoice(
  picked: readonly Item[],
  limits: Limits,
): { readonly chosen: readonly Item[] } | { readonly issue: string } | undefined {
  if (searchHint(picked, limits) === undefined) {
    return undefined;
  }
  if (limits.multiple && picked.length < limits.min) {
    return { issue: chooseAtLeast(limits.min) };
  }
  return { chosen: picked };
}

export { askList };
