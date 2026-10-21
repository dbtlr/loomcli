---
description: "The pack views: table, records, list, heading, rule, prose, and box, each a configured factory that returns a bare view."
---

# Pack views

This page documents the pack views: table, records, list, heading, rule, prose, and box. Each is a configured factory that returns a bare view, which an author registers under `views` or passes to `out.render`.

## Table

The table is `@loomcli/plugins/table`. Its factory `table<Row>(config?)` takes a column list and returns a whole view over the collected rows, `View<readonly Row[]>`, so the same value reaches a `views` record under `rows<Row>` and the second argument of `out.render`. Nothing is installed: there is no plugin factory at the subpath, no option, no lifecycle hook, and no graph fact, and what the call returns is a bare pack view under [Row views](../core/results.md#row-views). The view measures every row before it writes its first line, which is what buys a column as wide as its widest cell and a fit to the screen, so a sequence rendered through it is buffered whatever its source. It takes one reading of the context's [`columns`](../core/styles.md#width-padding-and-multiline-lanes) for the whole render. [ADR-0086](../decisions/0086-renders-fit-the-destinations-live-columns-and-tables-shrink-to-fit.md) records the fit.

```ts
// @loomcli/plugins/table
function table<Row>(config?: TableConfig<Row>): View<readonly Row[]>;

interface TableConfig<Row> {
  columns?: readonly Column<Row>[];
}
type Column<Row> = (keyof Row & string) | ColumnEntry<Row>;
type ColumnEntry<Row> = {
  [Key in keyof Row & string]: {
    key: Key;
    header?: string;
    align?: 'left' | 'right' | 'center';
    format?: (value: Row[Key], row: Readonly<Row>, context: ViewContext) => string;
  };
}[keyof Row & string];
```

```ts
import { Command } from '@loomcli/core';
import { table } from '@loomcli/plugins/table';

import { countFiles } from '../actions/count-files.js';

interface Row {
  count: number;
  source: string;
}

export const count = new Command('count')
  .argument('files', { required: true, variadic: true })
  .rows<Row>({
    views: {
      table: table({
        columns: [
          { key: 'count', header: 'COUNT', align: 'right' },
          { key: 'source', header: 'SOURCE' },
        ],
      }),
    },
  })
  .action(countFiles);
```

```text
COUNT  SOURCE
    6  one.txt
    2  two words.txt
    8  total
```

- **Configuration.** `columns` is an ordered list whose entries are a bare key or `{ key, header?, align?, format? }`, where a bare key is `{ key }` and the list order is the column order. A key may appear twice, which is two columns over one field, each with its own header, alignment, and format. With `columns` omitted, every own key that appears in the rows is a column in first-seen order with the key as its header. The configuration is plain data the returned view holds: the factory publishes no fact and no descriptor, and an application that wants another layout names another view.
- **Form.** One header line, then one line per row in source order. A header cell is the entry's `header` or the key spelled as written, styled `dim`. Two spaces separate one column from the next. There are no borders and no rule lines, and the last column of a line carries no padding, so a left- or center-aligned last cell ends its line and a right-aligned one keeps only the padding before it. A row whose cells wrap takes several lines, under **Fit**. Every line ends with `\n`, and the view owns every newline it writes.
- **Cells.** A default cell is `String(value)` passed through `style.escape` and styled `primary`, and `null` and `undefined` print as the empty string rather than as their spellings. A `format` entry replaces the default cell and returns marked text its author owns, which the view neither escapes nor styles, the view-function rule of [Rendered output](../core/output.md#rendered-output); a default cell is escaped by the view because the value is data.
- **Width.** When the table fits, each column is padded with core's `pad` to the widest of its header and every cell in that column, each measured with `context.width`, so a styled cell and a wide character land in the same column as a plain narrow one. A table fits when `columns` is `undefined` or its natural width, the padded columns plus the two-space gaps, is at most `columns`. Alignment is `left` unless the entry names `right` or `center`. A cell is never truncated, whatever the destination reports as its width, and no alignment is inferred from a value's type: a number left-aligns until a column asks for `right`.
- **Tabs.** When `columns` is defined, each tab in a cell or a header, a `format` cell and a styled or `nowrap` one included, expands to spaces with [`expandTabs`](../core/styles.md#width-padding-and-multiline-lanes) before the table measures, fits, or wraps it, counted from the start of its own input line within the cell. The spaces count toward the column's natural width and its floor as any space does, so a line shows on screen as wide as the table measured it and holds no tab. Off a terminal a tab stays as written.
- **Fit.** When the natural width exceeds `columns`, the columns shrink by levelling from the top. A column's floor is the widest unit `wrap` keeps whole in any of its cells or its header, measured with `context.width`: a word, with an input line's leading spaces on its first word and its trailing spaces on its last, or a `pad` frame or a `nowrap` frame, within one input line. The floor and `wrap` read the same units, so a column at its floor wraps every unit onto a line that fits. Levelling is stated exactly. Find the largest whole level L at which the sum over columns of max(floor, min(natural, L)), plus the gaps, is at most `columns`. Each column's width is max(floor, min(natural, L)). Any remainder goes one column each, from the left, to the columns at exactly L whose natural width exceeds L. The fitted widths and gaps then total exactly `columns` whenever any column narrowed, and the two-space gap stays and counts toward the fit. Columns of natural widths 40, 20, and 6, with floors of 6 or less, end at 20, 20, and 6 with 46 columns left for cells, at 17, 17, and 6 with 40 left, and at 17, 16, and 6 with 39 left, where L is 16 and the remainder of one goes to the first column.
- **Wrapped cells.** Text in a narrowed column wraps inside the column with [`wrap`'s rules](../core/styles.md#width-padding-and-multiline-lanes), so rows grow taller and every value stays complete. A header counts toward its column's natural width and its floor, and it wraps like a cell, styled `dim` on every line. Every line of a wrapped cell keeps its column's alignment, because `pad` aligns per line. A cell's `format` output is what the view measures and wraps. A row is as tall as its tallest cell. Each line of a row ends at its rightmost cell that has text at that height, and that cell carries no padding, by the last column's rule: a left-aligned cell ends the line, a center-aligned one keeps only the spaces before it, and a right-aligned one keeps the padding before it. A shorter cell to the left of that cell adds a blank line padded to its column's width, and the columns after it, with the gaps before them, are left off, so no line ends in a gap or in padding. At 30 columns, a table with a `NAME` column and a `NOTE` column of long text renders as:

  ```text
  NAME   NOTE
  build  compiles every package
         and bundles the
         examples
  check  runs the formatter, the
         linter, and the type
         checker
  ```

- **Records fallback.** When a table with rows cannot fit with every column at its floor, it renders as the [records layout](#records), one block per row and no header line. Each label is the entry's header text, or the key spelled as written, styled `dim` and padded to the widest label. Each value is the cell as the table would render it, a default cell or `format` output with the same styling, wrapped at the width left after the label column and its gap. The fallback's row blocks match the records view's row blocks for the same labels and left-aligned values. The fallback has no tail and highlights no identifier. A right- or center-aligned value aligns within its own widest wrapped line, no value line carries trailing padding, and a blank line inside a value carries no alignment and no indent. A line whose value is empty ends at its label, with no padding or gap after it, and a line whose label and value are both empty is an empty line. A blank line separates one block from the next, with none before the first and none after the last. Overflow happens only where a unit `wrap` keeps whole, or a label, exceeds the space, and the terminal soft-wraps it.
- **Off a terminal.** With `columns` undefined, a pipe or an invocation by name for instance, the output is byte for byte the natural-width output, tabs included. Every cell is one line there, so every line reaches the last column, an empty last cell included. A `format` cell that returns several lines keeps its natural-width bytes there: the layout that treats each line of a cell as a row line applies only when `columns` is defined.
- **Empty.** An empty sequence never takes the records fallback. With no rows, the natural width is the headers' alone. With a `columns` list configured, it prints the header line alone, at the fitted widths, levelled and wrapped like any header row, so a filtered run still reports the shape it searched. When even the header floors exceed `columns`, every column sits at its floor and the line overflows. An empty sequence with no `columns` prints nothing, because no key is known.
- **Typing.** `columns` is typed from `Row`, and each entry's `format` receives `Row[Key]` narrowed from that entry's own literal key. Inside a `views` record, and as the second argument of `out.render` over an array, the row type flows in by contextual typing, so a key that is not a key of `Row` is a compile error on that string. Hoisted into a constant the row type does not flow in, so the factory states it, `table<Row>({…})`, or its cell callbacks go unchecked, the rule [Row views](../core/results.md#row-views) states for every pack view.

## Records

The records list is `@loomcli/plugins/records`. Its factory `records<Row>(config)` takes an identifier and an optional field list and returns a row view, `RowView<Row>`, so a record prints as its source yields it and no row waits on the rows behind it. Like the table it installs nothing and returns a bare pack view. `identifier` is required: it names the key whose value identifies the record, which the view styles apart so an operator scanning a long list finds the record it names. The view takes a fresh reading of the context's [`columns`](../core/styles.md#width-padding-and-multiline-lanes) for each row, so a record that arrives after a resize wraps at the new width. [ADR-0086](../decisions/0086-renders-fit-the-destinations-live-columns-and-tables-shrink-to-fit.md) records the wrapping.

```ts
// @loomcli/plugins/records
function records<Row>(config: RecordsConfig<Row>): RowView<Row>;

interface RecordsConfig<Row> {
  identifier: keyof Row & string;
  fields?: readonly Field<Row>[];
}
type Field<Row> = (keyof Row & string) | FieldEntry<Row>;
type FieldEntry<Row> = {
  [Key in keyof Row & string]: {
    key: Key;
    format?: (value: Row[Key], row: Readonly<Row>, context: ViewContext) => string;
  };
}[keyof Row & string];
```

```ts
import { Command } from '@loomcli/core';
import { records } from '@loomcli/plugins/records';

import { listMembers } from '../actions/list-members.js';

interface Member {
  key: string;
  kind: string;
}

export const members = new Command('members')
  .rows<Member>({ views: { records: records({ identifier: 'key' }) } })
  .action(listMembers);
```

```text
key   user
kind  object with 3 keys

key   tags
kind  array with 2 items

2 records
```

- **Configuration.** `fields` is an ordered list whose entries are a bare key or `{ key, format? }`, where a bare key is `{ key }` and the list order is the field order. A field carries no `header` and no `align`: the key is the label a records list prints, and the value column is one lane, so neither has a second spelling to choose. With `fields` omitted, every own key that appears in the record is a field in first-seen order. `identifier` names a key of `Row` and adds no line of its own: it selects the value the view highlights among the fields it prints, so a `fields` list that omits the identifier's key prints no line for it and highlights nothing.
- **Form.** One field per block of lines: the key padded left to the key column's width, styled `dim`, then two spaces, then the value. On a terminal a line whose value is empty, one whose first line resolves to no character, ends at its key, with no padding and no gap after it, and a line whose key and value are both empty is an empty line. Off a terminal the key keeps its padding and the gap there. One blank line separates one record from the next, with none before the first record and none after the last. There are no rule lines. Every line ends with `\n`, and the view owns every newline it writes.
- **Width.** With `fields` declared, the key column is as wide as the widest key in the list, so every record aligns against the same column. Under the all-keys default the key column is as wide as the widest key of that record alone, because a row view sees one row and cannot measure the rows behind it. Keys are measured with `context.width` and padded with core's `pad`, and a key is never truncated.
- **Wrapping.** This is the records layout: a label column, a two-space gap, a value that wraps, and a blank line between records. The table view renders its rows in the same layout when its columns cannot fit, as [Table](#table) states, so one layout serves both. On a terminal each value's tabs expand to spaces with [`expandTabs`](../core/styles.md#width-padding-and-multiline-lanes), counted from the start of each input line of the value, so the key column moves no tab stop and no line holds a tab. Then each value wraps with [`wrap`'s rules](../core/styles.md#width-padding-and-multiline-lanes) at `columns` minus the key column's width minus the two-space gap, and every continuation line of a value, authored or wrapped, starts with spaces as wide as the key column and the gap, so the values stay in one column. A blank line inside a value, one that resolves to no character whatever style frames it holds, carries no indent and stays empty. When no column is left for the value, the value is not wrapped. A unit `wrap` keeps whole stays whole. Each row takes its own reading of `columns`: a record printed before a resize keeps its layout, and the next record wraps at the new width. Off a terminal, with `columns` undefined, the output is the natural-width bytes, a value with authored line breaks or tabs included. At 30 columns, a record whose `kind` value is long renders as:

  ```text
  key   tags
  kind  array of 12 strings,
        none empty or longer
        than 40 characters
  ```

- **Cells.** A default value is `String(value)` passed through `style.escape` and styled `primary`, except the identifier's value, which is styled `highlight`. `null` and `undefined` print as the empty string, so the key stands alone on its line, with nothing after it on a terminal, as **Form** states. A `format` entry replaces the default and returns marked text its author owns, which the view neither escapes nor styles, the identifier's field included.
- **Head and tail.** `head` prints nothing, because a records list has no column headings to open with. `tail` prints one blank line and then the summary line `<count> records`, styled `dim`, with its own newline, where `count` is the number of rows `row` was called with. One record reads `1 record`, and an empty sequence prints `0 records` with no blank line before it, because no record printed.
- **Typing.** `identifier` and `fields` are typed from `Row`, and each entry's `format` receives `Row[Key]` narrowed from that entry's own literal key. The contextual-typing rule is the table's: inside a `views` record, and as the second argument of `out.render` over an array, a generator, or an async generator, a key that is not a key of `Row` is a compile error on that string, and hoisted the factory states its row type, `records<Row>({…})`, or its cell callbacks go unchecked.

## List

The list is `@loomcli/plugins/list`. Its factory `list<Item>(config?)` returns a whole view over the collected items, `View<readonly Item[]>`, so the same value reaches a `views` record under `rows<Item>` and the second argument of `out.render`. Like the table it installs nothing and returns a bare pack view under [Row views](../core/results.md#row-views). It is a whole view because an ordered list right-aligns its numbers against the widest one among its siblings, which a row view cannot know, so a sequence rendered through it is buffered whatever its source. It takes one reading of the context's [`columns`](../core/styles.md#width-padding-and-multiline-lanes) for the whole render. [ADR-0088](../decisions/0088-pack-views-lay-out-lists-headings-rules-prose-and-boxes.md) records the list.

```ts
// @loomcli/plugins/list
function list<Item>(config?: ListConfig<Item>): View<readonly Item[]>;

interface ListConfig<Item> {
  ordered?: boolean;
  format?: (item: Item, index: number, context: ViewContext) => string;
  children?: (item: Item) => readonly Item[] | undefined;
}
```

```ts
import { Command } from '@loomcli/core';
import { list } from '@loomcli/plugins/list';

import { listServices } from '../actions/list-services.js';

interface Service {
  name: string;
  parts?: readonly Service[];
}

export const services = new Command('services')
  .rows<Service>({
    views: { list: list({ children: (service) => service.parts, format: (service) => service.name }) },
  })
  .action(listServices);
```

```text
● api-gateway
● billing
  ● invoices
  ● refunds
● search
```

- **Configuration.** `ordered` numbers the items, and an omitted or `false` `ordered` gives them bullets. `format` renders one item's text from the item, its index among its siblings counting from 0, and the context. `children` names an item's nested items, and an item whose `children` returns `undefined` or an empty list has none. Every key is optional, so `list()` over `string[]` needs no configuration. The configuration is plain data the returned view holds, under [Row views](../core/results.md#row-views).
- **Form.** One block per item in source order: the marker, one space, then the item's text, then its nested items. A bullet is `glyph.bullet`. An ordered marker is the item's position among its siblings counting from 1 and a `.`, right-aligned with `pad` to the widest marker among those siblings, so ` 9.` right-aligns with `10.`. Markers are `dim`. A nested list starts at its parent's text column, so it indents by the parent's padded marker width and one space, and a nested ordered list counts from 1 again. `ordered` applies at every depth. No blank line separates two items. Every line ends with `\n`, and the view owns every newline it writes.
- **Text.** A default item's text is `String(item)` passed through `style.escape` and styled `primary`, and `null` and `undefined` print as the empty string, the table's cell rule. A `format` result replaces the default and is marked text its author owns, which the view neither escapes nor styles. An item whose text is empty writes its marker alone, with no space after it, and a text that ends in a line break gains no empty line, the rule of [Views over a string](#views-over-a-string).
- **Continuation lines.** Every line of an item's text after its first, authored or wrapped, starts at the item's text column, so it hangs under the text and not under the marker, on a terminal and off one. A blank line inside an item's text, one that resolves to no character, carries no indent and stays empty, the records rule.
- **Wrapping.** On a terminal each item's text expands its tabs with [`expandTabs`](../core/styles.md#width-padding-and-multiline-lanes), counted from the start of each input line of the text, then wraps with [`wrap`'s rules](../core/styles.md#width-padding-and-multiline-lanes) at `columns` minus its text column, and at 1 when that leaves less, and each line is split with `splitLines`, so a style or a hyperlink never runs into the indent. A unit `wrap` keeps whole stays whole and overflows. Off a terminal, with `columns` undefined, the text is not wrapped and its tabs stay as written. At 30 columns a bulleted item whose text is long renders as:

  ```text
  ● refunds, whose retry policy
    lands with this deploy
  ```

- **Empty.** An empty sequence prints nothing.
- **Typing.** `format` and `children` are typed from `Item`. Inside a `views` record, and as the second argument of `out.render` over an array, the item type flows in, so a callback that reads a member `Item` lacks is a compile error. Hoisted into its own constant, the factory states it, `list<Service>({…})`, or its callbacks go unchecked.

## Views over a string

The heading, the rule, prose, and the box are views over a string: each factory returns `View<string>`, so an action writes `out.render(text, prose())`, and a `result<string>()` names one in its `views` record. A box that frames another view takes that view's data type instead, under [Box](#box). Like the table each installs nothing and returns a bare pack view, and each takes one reading of the context's [`columns`](../core/styles.md#width-padding-and-multiline-lanes) per render. [ADR-0088](../decisions/0088-pack-views-lay-out-lists-headings-rules-prose-and-boxes.md) records the four.

- **Marked text.** The string is marked text its author owns, as a [lane view](../core/output.md)'s message is, so a styled word inside it keeps its style and the view does not escape it. Raw data goes through `style.escape` first, the rule of [Rendered output](../core/output.md#rendered-output).
- **Lines.** Each view writes whole lines: every line it writes ends with `\n`, a text that ends in a line break gains no empty line, and the view owns every newline it writes. No view writes a blank line above or below itself, so the spacing between two renders is the action's.
- **Empty.** A text that resolves to no character, the empty string or a style or `nowrap` frame around nothing, renders the empty string, except under the rule, where it draws a bare line.
- **Off a terminal.** With `columns` undefined nothing wraps, tabs stay as written except where a box pads a line, and nothing is cut. Only the rule needs a width there, under [Rule](#rule).

## Heading

The heading is `@loomcli/plugins/heading`. Its factory `heading(config?)` returns `View<string>`, a section heading over its text at one of two levels, as the [help page](help-page.md#the-help-page) has two, with a form of its own. The heading is wayfinding, not content, so both levels are `dim`, and an underline tells level 1 from level 2.

```ts
// @loomcli/plugins/heading
function heading(config?: HeadingConfig): View<string>;

interface HeadingConfig {
  level?: 1 | 2;
}
```

```ts
import { heading } from '@loomcli/plugins/heading';

await out.render('Deployment summary', heading());
await out.render('Services', heading({ level: 2 }));
```

```text
Deployment summary
──────────────────
Services
```

- **Configuration.** `level` defaults to 1.
- **Form.** The text, styled `dim`, then, at level 1, one line of `glyph.line` as wide as the widest line of the text, measured with `context.width`, also `dim`. Level 2 is the text alone. Neither level indents, and the text keeps its author's styling inside the `dim` frame.
- **Wrapping.** On a terminal the text expands its tabs, wraps at `columns`, and is split with `splitLines`, and the underline matches the widest wrapped line, so it is wider than `columns` only when a unit `wrap` keeps whole is. Off a terminal the text is not wrapped, and the underline matches its widest line as written.

## Rule

The rule is `@loomcli/plugins/rule`. Its factory `rule()` returns `View<string>`, a horizontal line across the destination that carries its text as a label, so `out.render('', rule())` draws a bare line and `out.render('Checks', rule())` a labelled one.

```ts
// @loomcli/plugins/rule
function rule(): View<string>;
```

```ts
import { rule } from '@loomcli/plugins/rule';

await out.render('Checks', rule());
await out.render('', rule());
```

At 60 columns they print:

```text
── Checks ──────────────────────────────────────────────────
────────────────────────────────────────────────────────────
```

- **Width.** The rule is `columns` wide on a terminal and 80 wide off one. The 80 is the rule's own length, the one view whose form needs a width where none is known, and the context still carries no fallback width under [Width, padding, and multiline lanes](../core/styles.md#width-padding-and-multiline-lanes).
- **Bare.** A text that resolves to no character draws `glyph.line` repeated to the rule's width, styled `dim`, and one `\n`.
- **Labelled.** Any other text is the label: two `glyph.line` and a space, `dim`, then the label, its tabs expanded first on a terminal, then a space and `glyph.line` repeated to the rule's width, `dim`. The label keeps its author's styling and adds none. A label too long for one line wraps on a terminal at the rule's width minus five, and at 1 when that leaves less, the three columns before it and at least one space and one line after it, and is split with `splitLines`. Its lines after the first, authored or wrapped, start three spaces in, under the label, a blank line among them, one that resolves to no character, carries no indent and stays empty, the records rule, except the last, which carries the line after it, and only its last line carries the line after it, at least one `glyph.line` long, so the rule overflows only where a unit `wrap` keeps whole does. Off a terminal the label is not wrapped, and an authored line break in it takes the same layout.

## Prose

Prose is `@loomcli/plugins/prose`. Its factory `prose()` returns `View<string>`, paragraphs wrapped to the destination. It is the wrapped counterpart of `print`, which writes its text as it is under [ADR-0086](../decisions/0086-renders-fit-the-destinations-live-columns-and-tables-shrink-to-fit.md).

```ts
// @loomcli/plugins/prose
function prose(): View<string>;
```

```ts
import { prose } from '@loomcli/plugins/prose';

await out.render(
  'Three services rolled out to the staging cluster. One health check is still warming up.',
  prose(),
);
```

At 34 columns it prints:

```text
Three services rolled out to the
staging cluster. One health check
is still warming up.
```

- **Form.** The text as its author wrote it, with no styling added. Authored line breaks and blank lines stay, so a blank line separates two paragraphs.
- **Wrapping.** On a terminal the text expands its tabs, wraps at `columns` with [`wrap`'s rules](../core/styles.md#width-padding-and-multiline-lanes), and is split with `splitLines`: an input line's leading spaces stay on its first line, and its continuation lines start at column 0. Off a terminal a non-empty text prints as written, with `\n` added when it does not end in a line break.

## Box

The box is `@loomcli/plugins/box`. Its factory `box(config?)` frames text, or the output of another view, in a border with an optional title. With no `content` it returns `View<string>` and frames its text. With `content` it returns a view over the content's data, renders the content inside the frame, and narrows the content's `columns` by the frame, so a table framed in a box shrinks to fit inside it, or falls back to the records layout, under [Table](#table).

```ts
// @loomcli/plugins/box
function box<Data = string>(
  ...config: [Data] extends [string] ? [config?: BoxConfig<Data>] : [config: BoxConfig<Data>]
): View<Data>;

type BoxConfig<Data> = { title?: string } & ([Data] extends [string]
  ? { content?: View<Data> }
  : { content: View<Data> });
```

```ts
import { Command } from '@loomcli/core';
import { box } from '@loomcli/plugins/box';
import { table } from '@loomcli/plugins/table';

import { listPools } from '../actions/list-pools.js';

interface Pool {
  pool: string;
  instances: number;
  status: string;
}

await out.render('All three services passed their health checks.', box({ title: 'Totals' }));

export const pools = new Command('pools')
  .rows<Pool>({ views: { boxed: box({ content: table(), title: 'Pools' }), table: table() } })
  .action(listPools);
```

```text
╭─ Totals ───────────────────────────────────────╮
│ All three services passed their health checks. │
╰────────────────────────────────────────────────╯
╭─ Pools ───────────────────╮
│ pool   instances  status  │
│ blue   4          ready   │
│ green  4          warming │
╰───────────────────────────╯
```

- **Configuration.** `title` is marked text its author owns, as a table's authored `header` is. `content` is a bare view or a declared view's value; inside a box nothing resolves an override for it, because the box calls the view it was given, the rule a bare view follows under `out.render`.
- **Form.** A top border, one line per content line, and a bottom border, every border piece `dim`. The top border is `glyph.lineDownRightArc`, then `glyph.line` across, then `glyph.lineDownLeftArc`, and with a title it reads `glyph.lineDownRightArc`, `glyph.line`, a space, the title styled `primary` and `bold`, a space, then `glyph.line` to the corner. A content line is `glyph.lineVertical` and a space, the line padded with `pad` to the inner width, then a space and `glyph.lineVertical`. The bottom border is `glyph.lineUpRightArc`, `glyph.line` across, and `glyph.lineUpLeftArc`. The inner width is the widest content line, measured with `context.width`, or the title's width and two when that is wider, so the title always sits in the top border with at least one `glyph.line` after it.
- **Text content.** With no `content` the box frames its text. On a terminal the text expands its tabs, wraps at `columns` minus 4, and at 1 when that leaves less, and is split with `splitLines`, so the box is as wide as its text and never wider than `columns` unless a unit `wrap` keeps whole, or the title, is. Off a terminal the text is not wrapped, and the box is as wide as its widest line.
- **View content.** With `content` the box calls the content's view function with its data and a context that matches its own except for `columns`, which is `columns` minus 4, and 1 when that leaves less, on a terminal and stays `undefined` off one. The content's text is split with `splitLines`, so its trailing newline adds no line, and on a terminal its tabs expand before the box measures it. A content line wider than the space the box offers, which a content view that ignores `columns` writes, widens the box past `columns`, and nothing is cut.
- **Tabs.** Off a terminal a tab in a content line expands inside the line's `pad` frame, counted from the line's start, so the right border stays in its column.
- **Empty.** A text box over a text that resolves to no character, and a box whose content renders such a text, print nothing.
- **Typing.** `Data` is inferred from `content`, or from the context the box is written in, and is `string` when neither supplies it. Only a box whose `Data` is a string may leave out its configuration or its `content`. Inside a `views` record the record's data type flows through the box into the content's factory, so `box({ content: table({ columns: ['nope'] }) })` under `rows<Pool>` is a compile error on `'nope'`, and a box with no `content` under a result whose value is not a string is a compile error: `box()` misses its required configuration, and `box({ title })` names the missing `content`. Hoisted, the content's factory states its type, `box({ content: table<Pool>() })`.

## When author code fails

The `format` and `children` callbacks of the pack views are author code. A callback that throws makes its view throw, and the run takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path), the output-view row. An author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). The pack views add no outcome of their own.
