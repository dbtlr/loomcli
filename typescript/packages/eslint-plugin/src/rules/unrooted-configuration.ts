import type { Rule } from 'eslint';
import type { Node } from 'estree';

import {
  isConfigurationCallee,
  literalString,
  positionalArguments,
  readProperty,
} from '../declarations.js';
import type { PropertyReading } from '../declarations.js';
import { ruleUrl } from '../docs.js';

/*
 * A configuration that reads the project scope walks up from its start directory, and with no
 * root marker the walk climbs past the project, so an enclosing project's file answers for it.
 * This rule reports a `configuration()` call whose settings object literal reads the project scope
 * and has no `root` key. A project with no obvious marker is legitimate, so the configurations turn
 * the rule on at `warn`. Settings it cannot read get no report, because a false report is worse
 * than a missed one.
 */

/**
 * Whether a `scopes` reading lists the project scope: absent, so both scopes are read, or an array
 * literal that holds the string `'project'`. Any other value is one the rule cannot read.
 */
function readsProject(scopes: PropertyReading): boolean {
  if (scopes.kind === 'absent') {
    return true;
  }
  return (
    scopes.kind === 'found' &&
    scopes.value.type === 'ArrayExpression' &&
    scopes.value.elements.some(
      (element) => element?.type !== 'SpreadElement' && literalString(element) === 'project',
    )
  );
}

/** Whether a call's settings object literal reads the project scope and names no root marker. */
function isUnrooted(settings: Node | undefined): boolean {
  if (settings?.type !== 'ObjectExpression') {
    return false;
  }
  return (
    readProperty(settings, 'root').kind === 'absent' &&
    readsProject(readProperty(settings, 'scopes'))
  );
}

/** Reports a configuration that reads the project scope with no root marker. */
const unrootedConfiguration: Rule.RuleModule = {
  create(context) {
    const { sourceCode } = context;
    return {
      CallExpression(node) {
        if (!isConfigurationCallee(sourceCode, node.callee)) {
          return;
        }
        const [settings] = positionalArguments(node) ?? [];
        if (isUnrooted(settings)) {
          context.report({ messageId: 'unrooted', node });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        'Advise a root marker on a configuration that reads the project scope, so its walk stops at the project.',
      url: ruleUrl('unrooted-configuration'),
    },
    messages: {
      unrooted:
        "This configuration reads the project scope with no root marker, so its walk climbs past the project. Name the file that marks the project's root, such as root: 'package.json', or set root: false.",
    },
    schema: [],
    type: 'suggestion',
  },
};

export { unrootedConfiguration };
