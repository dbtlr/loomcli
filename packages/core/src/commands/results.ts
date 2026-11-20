import type { ResultView, DeclaredResult } from '../output/types.js';
import type { ViewEntry, ResultCall } from './state.js';

/** The entries one `views` record holds, in record order, each with the media type it declares. */
export function viewEntries(record: Readonly<Record<string, ResultView>>): readonly ViewEntry[] {
  return Object.entries(record).map(([key, view]) => ({
    key,
    mediaType: view.mediaType ?? null,
    view,
  }));
}

/**
 * The finished result: the results lane's calls read as one declaration. A later `views()` call
 * replaces a key in place and appends a new one, so each name keeps the position the call that
 * first named it gave it. A `default` once named persists through later calls that name none, and
 * the first key answers until one is named. A default no view answers fails where the result
 * renders, as a views record that names no view does.
 */
export function buildResult(results: readonly ResultCall[]): DeclaredResult | undefined {
  const declaration = results.find((call) => call.kind !== 'views');
  if (!declaration) {
    return undefined;
  }
  const views = new Map<string, ResultView>();
  const mediaTypes = new Map<string, string | null>();
  let selected: string | undefined = undefined;
  for (const call of results) {
    for (const { key, mediaType, view } of call.entries) {
      views.set(key, view);
      mediaTypes.set(key, mediaType);
    }
    if (call.kind === 'views' && call.default !== undefined) {
      selected = call.default;
    }
  }
  const first = views.keys().next();
  const fallback = first.done === true ? '' : first.value;
  return { default: selected ?? fallback, kind: declaration.kind, mediaTypes, views };
}
