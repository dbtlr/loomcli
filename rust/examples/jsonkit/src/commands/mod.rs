//! jsonkit's Commands, each a module of its own.

mod debug;
mod fetch;
mod get;
mod keys;
mod paths;
mod select;
mod stats;

pub use debug::debug;
pub use fetch::fetch;
pub use get::get;
pub use keys::keys;
pub use paths::paths;
pub use select::select;
pub use stats::{max, stats};
