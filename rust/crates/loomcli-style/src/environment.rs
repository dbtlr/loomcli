//! The environment facts the decision functions read, supplied by the caller rather than read from
//! the process, so a test states them.

use std::collections::{BTreeMap, HashMap};
use std::hash::BuildHasher;

/// A read-only view of captured environment variables, read case-sensitively.
pub trait Environment {
    /// The value of a variable, or `None` when it is unset. An empty value is set.
    fn var(&self, name: &str) -> Option<&str>;
}

impl<S: BuildHasher> Environment for HashMap<String, String, S> {
    fn var(&self, name: &str) -> Option<&str> {
        self.get(name).map(String::as_str)
    }
}

impl Environment for BTreeMap<String, String> {
    fn var(&self, name: &str) -> Option<&str> {
        self.get(name).map(String::as_str)
    }
}

impl<K: AsRef<str>, V: AsRef<str>> Environment for [(K, V)] {
    fn var(&self, name: &str) -> Option<&str> {
        self.iter()
            .rev()
            .find(|(key, _)| key.as_ref() == name)
            .map(|(_, value)| value.as_ref())
    }
}

impl<K: AsRef<str>, V: AsRef<str>, const N: usize> Environment for [(K, V); N] {
    fn var(&self, name: &str) -> Option<&str> {
        self.as_slice().var(name)
    }
}

impl<K: AsRef<str>, V: AsRef<str>> Environment for Vec<(K, V)> {
    fn var(&self, name: &str) -> Option<&str> {
        self.as_slice().var(name)
    }
}

impl<E: Environment + ?Sized> Environment for &E {
    fn var(&self, name: &str) -> Option<&str> {
        (**self).var(name)
    }
}
