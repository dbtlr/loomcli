/** The caller-owned controller one fixture run supplies, shared with the modules that abort it. */
export const controller = new AbortController();

/** The reason a caller aborts with, which core carries as the `cause` of its own reason. */
export const callerReason = new Error('the caller stopped the run');
