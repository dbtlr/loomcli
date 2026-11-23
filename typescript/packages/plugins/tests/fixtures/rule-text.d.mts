/**
 * A failure as a rule table reads it: a declaration fault's sentence followed by its correction, one
 * fix after another when it lists several, and any other failure's message.
 */
export declare function ruleText(failure: {
  readonly message: string;
  readonly sentence?: string | undefined;
  readonly correction?: string | readonly string[] | undefined;
}): string;
