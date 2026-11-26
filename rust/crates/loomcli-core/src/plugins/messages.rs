//! The sentences of core's plugin machinery, as a log event reads them.

/// The sentence the log event of a provider's close that fails without failing the run carries.
pub(super) const PROVIDER_CLOSE_FAILED: &str = "A provider's close failed.";
