/**
 * The context a test calls one view's functions with: a whole view's `render`, or a row view's
 * `head`, `row`, and `tail`. The builder has no measure of its own, so the test states every member
 * its view reads, and a declared view's own function runs, because no view registry is read.
 */
import type { RowView, View, ViewContext } from '@loomcli/core';

import { unstated, unstatedMeasure } from './unstated-members.js';
import type { OptionalMembers } from './unstated-members.js';
import { unstatedStyle } from './unstated-style.js';

/** What a test states to build a view context: each member its view reads. */
type ViewValues = OptionalMembers<ViewContext>;

/**
 * Builds the context a view or a row view takes from the values the test states. The builder
 * never reads the view's data, so a view over any data type is accepted. A stated
 * `columns: undefined` is a destination that is not a terminal.
 *
 * ```ts
 * const context = viewContext(heading, { columns: 20, width: (text) => text.length });
 * heading.render('Notes', context);
 * ```
 */
function viewContext(view: View<never> | RowView<never>, values: ViewValues): ViewContext {
  return {
    ...values,
    get background() {
      return 'background' in values ? values.background : unstated('viewContext', 'background');
    },
    get columns() {
      return 'columns' in values ? values.columns : unstated('viewContext', 'columns');
    },
    expandTabs: values.expandTabs ?? unstatedMeasure('expandTabs'),
    plain: values.plain ?? unstatedMeasure('plain'),
    style: values.style ?? unstatedStyle(),
    width: values.width ?? unstatedMeasure('width'),
    wrap: values.wrap ?? unstatedMeasure('wrap'),
  };
}

export { viewContext };
export type { ViewValues };
