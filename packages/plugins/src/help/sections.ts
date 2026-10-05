import type { ViewContext } from '@loomcli/core';

import { column } from './cells.js';
import type { Row } from './cells.js';

interface SectionRow {
  fallback: string;
  path: readonly string[] | undefined;
  row: Row;
}

interface Section {
  rows: Row[];
  subsections: Map<string, Row[]>;
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

function append(section: Section, inner: string | undefined, row: Row): void {
  if (inner === undefined) {
    section.rows.push(row);
    return;
  }
  const nested = section.subsections.get(inner) ?? [];
  section.subsections.set(inner, nested);
  nested.push(row);
}

/** Group visible rows by the uppercase headings the reader sees, without changing their order. */
function collect(rows: readonly SectionRow[]): Map<string, Section> {
  const sections = new Map<string, Section>();
  for (const member of rows) {
    const { inner, outer } = headings(member.path);
    const heading = outer ?? member.fallback;
    const section = sections.get(heading) ?? { rows: [], subsections: new Map<string, Row[]>() };
    sections.set(heading, section);
    append(section, inner, member.row);
  }
  return sections;
}

/** A missing inner section contributes no priority, even when its outer heading is visible. */
function existingPath(sections: ReadonlyMap<string, Section>, raw: readonly string[]) {
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

function rank(order: Order, path: NonNullable<ReturnType<typeof existingPath>>): void {
  order.outer.add(path.outer);
  if (path.inner !== undefined) {
    const listed = order.inner.get(path.outer) ?? new Set<string>();
    order.inner.set(path.outer, listed);
    listed.add(path.inner);
  }
}

/** Listed paths must exist before either of their headings contributes ordering priority. */
function ordering(sections: ReadonlyMap<string, Section>, paths: readonly (readonly string[])[]) {
  const order: Order = { inner: new Map(), outer: new Set() };
  for (const raw of paths) {
    const path = existingPath(sections, raw);
    if (path !== undefined) {
      rank(order, path);
    }
  }
  return order;
}

function subsection(
  name: string,
  rows: readonly Row[] | undefined,
  context: ViewContext,
): string[] {
  return rows === undefined
    ? []
    : [
        `  ${context.style.dim(context.style.escape(name))}`,
        ...column(rows, context).map((line) => `  ${line}`),
      ];
}

/** Direct members and each subsection measure their own columns within one outer block. */
function block(
  {
    heading,
    section,
    order,
  }: { heading: string; section: Section; order: ReadonlySet<string> | undefined },
  context: ViewContext,
): string[] {
  const lines = [
    context.style.dim(context.style.escape(heading)),
    ...column(section.rows, context),
  ];
  const names = new Set([...(order ?? []), ...section.subsections.keys()]);
  for (const name of names) {
    lines.push(...subsection(name, section.subsections.get(name), context));
  }
  return lines;
}

/** Each outer section is one block, with listed headings before the remaining visible headings. */
function sectionBlocks(
  {
    order = [],
    rows,
  }: { order: readonly (readonly string[])[] | undefined; rows: readonly SectionRow[] },
  context: ViewContext,
): string[][] {
  const sections = collect(rows);
  const priorities = ordering(sections, order);
  const names = new Set([...priorities.outer, ...sections.keys()]);
  return [...names].flatMap((heading) => {
    const section = sections.get(heading);
    return section === undefined
      ? []
      : [block({ heading, order: priorities.inner.get(heading), section }, context)];
  });
}

export { sectionBlocks };
