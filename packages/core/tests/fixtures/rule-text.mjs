/**
 * A failure as a rule table reads it: a declaration fault's sentence followed by its correction, one
 * fix after another when it lists several, and any other failure's message.
 */
export function ruleText(failure) {
  if (failure.sentence === undefined) {
    return failure.message;
  }
  const correction = failure.correction === undefined ? [] : [failure.correction].flat();
  return [failure.sentence, ...correction].join(' ');
}
