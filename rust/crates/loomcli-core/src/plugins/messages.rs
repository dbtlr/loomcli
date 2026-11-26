//! The sentences of core's plugin machinery.

use crate::failures::messages::{quoted, routed_subject};

use super::plugin::plugin_sentence;

pub(super) fn media_type_on_result(plugin: &str, media_type: &str, path: &[String]) -> String {
    format!(
        "{} assigned media type {} on {}, which declares a result.",
        plugin_sentence(plugin),
        quoted(media_type),
        routed_subject(path)
    )
}

/// The sentence the log event of a provider's close that fails without failing the run carries.
pub(super) const PROVIDER_CLOSE_FAILED: &str = "A provider's close failed.";
