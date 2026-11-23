/** The layout the `jsonLayout` options select: one line, or nested members indented. */
export interface JsonLayout {
  readonly compact: boolean;
  readonly indent: number;
}

/**
 * Every command prints its result here, so one document renders alike wherever it is printed.
 * Objects and arrays print indented by the layout's spaces, or on one line when it is compact;
 * scalars have no members to indent, so they stay compact.
 */
export function formatJson(value: unknown, layout: JsonLayout): string {
  return JSON.stringify(value, undefined, layout.compact ? undefined : layout.indent);
}
