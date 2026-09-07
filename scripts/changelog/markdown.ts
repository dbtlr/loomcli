import { fromMarkdown } from 'mdast-util-from-markdown';

type Heading = Extract<ReturnType<typeof fromMarkdown>['children'][number], { type: 'heading' }>;

function text(nodes: Heading['children']): string {
  return nodes
    .map((node) => {
      if ('value' in node) {
        return node.value;
      }
      if ('children' in node) {
        return text(node.children);
      }
      return '';
    })
    .join('');
}

export function headingText(heading: Heading) {
  return text(heading.children);
}

// A fragment must finish its blocks so later release headings remain structural headings.
export function requireClosedBlocks(source: string, label: string) {
  const boundary = fromMarkdown(`${source}\n\n## Release boundary\n`).children.at(-1);
  if (
    boundary?.type !== 'heading' ||
    boundary.depth !== 2 ||
    headingText(boundary) !== 'Release boundary'
  ) {
    throw new Error(`${label}: unclosed Markdown block would swallow later release entries.`);
  }
}
