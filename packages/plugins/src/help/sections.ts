import type { ViewContext } from '@loomcli/core';

import { column } from './cells.js';
import type { Row } from './cells.js';

/** One member a section lists: its default heading, its authored section, and what it shows. */
interface SectionMember<Shown> {
  fallback: string;
  path: readonly string[] | undefined;
  row: Shown;
}

interface Section<Shown> {
  rows: Shown[];
  subsections: Map<string, Shown[]>;
}

/** One outer section in page order: its heading, its direct rows, and its ordered subsections. */
interface OrderedSection<Shown> {
  readonly heading: string;
  readonly rows: readonly Shown[];
  readonly subsections: readonly { readonly heading: string; readonly rows: readonly Shown[] }[];
}

interface Order {
  inner: Map<string, Set<string>>;
  outer: Set<string>;
}

/** Matching and printing use the same uppercase headings; stored extension values stay untouched. */
function headings(path: readonly string[] | undefined) {
  const [outer, inner] = path ?? [];
  return { inner: inner?.toUpperCase(), outer: outer?.toUpperCase() };
}

function append<Shown>(section: Section<Shown>, inner: string | undefined, row: Shown): void {
  if (inner === undefined) {
    section.rows.push(row);
    return;
  }
  const nested = section.subsections.get(inner) ?? [];
  section.subsections.set(inner, nested);
  nested.push(row);
}

/** Group visible rows by the uppercase headings the reader sees, without changing their order. */
function collect<Shown>(rows: readonly SectionMember<Shown>[]): Map<string, Section<Shown>> {
  const sections = new Map<string, Section<Shown>>();
  for (const member of rows) {
    const { inner, outer } = headings(member.path);
    const heading = outer ?? member.fallback;
    const section = sections.get(heading) ?? { rows: [], subsections: new Map<string, Shown[]>() };
    sections.set(heading, section);
    append(section, inner, member.row);
  }
  return sections;
}

/** A missing inner section contributes no priority, even when its outer heading is visible. */
function existingPath<Shown>(
  sections: ReadonlyMap<string, Section<Shown>>,
  raw: readonly string[],
) {
  const { inner, outer } = headings(raw);
  const section = outer === undefined ? undefined : sections.get(outer);
  if (
    outer === undefined ||
    section === undefined ||
    (inner !== undefined && !section.subsections.has(inner))
  ) {
    return undefined;
  }
  return { inner, outer };
}

function rank(order: Order, path: { inner: string | undefined; outer: string }): void {
  order.outer.add(path.outer);
  if (path.inner !== undefined) {
    const listed = order.inner.get(path.outer) ?? new Set<string>();
    order.inner.set(path.outer, listed);
    listed.add(path.inner);
  }
}

/** Listed paths must exist before either of their headings contributes ordering priority. */
function ordering<Shown>(
  sections: ReadonlyMap<string, Section<Shown>>,
  paths: readonly (readonly string[])[],
) {
  const order: Order = { inner: new Map(), outer: new Set() };
  for (const raw of paths) {
    const path = existingPath(sections, raw);
    if (path !== undefined) {
      rank(order, path);
    }
  }
  return order;
}

/** The subsections of one outer section, listed headings before the remaining ones. */
function subsections<Shown>(
  section: Section<Shown>,
  order: ReadonlySet<string> | undefined,
): OrderedSection<Shown>['subsections'] {
  const names = new Set([...(order ?? []), ...section.subsections.keys()]);
  return [...names].flatMap((heading) => {
    const rows = section.subsections.get(heading);
    return rows === undefined ? [] : [{ heading, rows }];
  });
}

/**
 * The members grouped into outer sections in page order, listed headings before the remaining
 * visible headings, each with its direct rows and its subsections in the same order rule. Help
 * prints them as blocks, and the man page as `.SH` and `.SS` sections.
 */
function orderedSections<Shown>(
  order: readonly (readonly string[])[] | undefined,
  rows: readonly SectionMember<Shown>[],
): OrderedSection<Shown>[] {
  const sections = collect(rows);
  const priorities = ordering(sections, order ?? []);
  const names = new Set([...priorities.outer, ...sections.keys()]);
  return [...names].flatMap((heading) => {
    const section = sections.get(heading);
    return section === undefined
      ? []
      : [
          {
            heading,
            rows: section.rows,
            subsections: subsections(section, priorities.inner.get(heading)),
          },
        ];
  });
}

/** Direct members and each subsection measure their own columns within one outer block. */
function block(section: OrderedSection<Row>, context: ViewContext): string[] {
  const lines = [
    context.style.dim(context.style.escape(section.heading)),
    ...column(section.rows, context),
  ];
  for (const { heading, rows } of section.subsections) {
    lines.push(
      `  ${context.style.dim(context.style.escape(heading))}`,
      ...column(rows, context).map((line) => `  ${line}`),
    );
  }
  return lines;
}

/** Each outer section is one block, with listed headings before the remaining visible headings. */
function sectionBlocks(
  {
    order,
    rows,
  }: { order: readonly (readonly string[])[] | undefined; rows: readonly SectionMember<Row>[] },
  context: ViewContext,
): string[][] {
  return orderedSections(order, rows).map((section) => block(section, context));
}

export type { OrderedSection, SectionMember };
export { orderedSections, sectionBlocks };
