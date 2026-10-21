import type { Rule } from 'eslint';

import { authoringCallOf } from '../declarations.js';
import { ruleUrl } from '../docs.js';

/**
 * Reports an authoring call on a declaration whose result nothing uses. Declarations are
 * immutable, so such a statement builds a new declaration and drops it.
 */
const discardedDeclaration: Rule.RuleModule = {
  create(context) {
    const { sourceCode } = context;
    return {
      ExpressionStatement(node) {
        const call = authoringCallOf(sourceCode, node.expression);
        if (call) {
          context.report({ data: { method: call.method }, messageId: 'discarded', node });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        'Disallow an authoring call on a declaration whose result is discarded, because declarations are immutable.',
      url: ruleUrl('discarded-declaration'),
    },
    messages: {
      discarded:
        '`{{method}}()` returns a new declaration and does nothing on its own, because declarations are immutable. Assign the result or chain it.',
    },
    schema: [],
    type: 'problem',
  },
};

export { discardedDeclaration };
