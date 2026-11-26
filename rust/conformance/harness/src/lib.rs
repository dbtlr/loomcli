//! The conformance harness: runs every shared case against the Rust example binaries and
//! compares stdout, stderr, the exit code, and produced files with the captured reference results.
//!
//! The case rules are documented in the repository's `conformance/README.md`.

#![allow(clippy::must_use_candidate)]

pub mod accepted;
pub mod behind;
pub mod cases;
pub mod compare;
pub mod diff;
pub mod exec;
pub mod growth;
pub mod report;
pub mod runner;
pub mod sandbox;
