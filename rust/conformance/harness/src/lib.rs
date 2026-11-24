//! The conformance harness: runs every corpus case against the Rust example binaries and
//! compares stdout, stderr, the exit code, and produced files with the captured reference results.
//!
//! The rules the harness follows are the rules of `conformance/capture.mjs` and
//! `conformance/README.md`; each module names the part it reproduces.

#![allow(clippy::must_use_candidate)]

pub mod accepted;
pub mod cases;
pub mod compare;
pub mod diff;
pub mod exec;
pub mod report;
pub mod runner;
pub mod sandbox;
