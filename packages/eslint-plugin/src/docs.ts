/** The reference page that describes each rule, which every rule's `meta.docs.url` points into. */
const referencePage = 'https://github.com/dbtlr/loomcli/blob/main/docs/libs/eslint-plugin.md';

/** The reference entry for one rule, whose heading anchor is the rule name. */
function ruleUrl(rule: string): string {
  return `${referencePage}#${rule}`;
}

export { ruleUrl };
