//! The validator catalog of Loom CLI.
//!
//! Each factory returns a configurable validator that implements `loomcli_core::Validator`: it
//! judges one raw string, returns a typed value or one issue with its code, and publishes the JSON
//! Schema of the value its token stands for. A factory argument that can never work is a
//! declaration fault at the call, which panics at the author's line with the whole Developer
//! Diagnostic under the package's own rules (`@loomcli/validators/...`).
//!
//! The catalog is `text`, `integer`, `number`, `port`, `one_of`, `url`, `uuid`, `date`,
//! `date_time`, `time`, `duration`, `path`, `bytes`, `host`, `ip`, `cidr`, `key_value`, and `email`.
//! [`create_validator`] builds a validator from a parse function, [`pipe`] follows a validator with
//! steps, and [`issue_code`] declares the typed codes a rejection carries. Every sentence the
//! catalog prints has a code under [`codes`], so a failure view rewords one sentence by reading its
//! code from an issue.

mod address;
mod bounds;
mod calendar;
mod custom;
mod ecma;
mod fault;
mod grammar;
mod issues;
mod js;
mod layout;
mod messages;
mod network;
mod numbers;
mod path;
mod pipe;
mod sizes;
mod span;
mod strings;
mod temporal;
mod text;
mod uri;

pub mod codes;

pub use custom::{Custom, create_validator};
pub use issues::{IssueCode, issue_code};
pub use network::{Cidr, CidrBlock, Host, Ip, IpVersion, cidr, host, ip};
pub use numbers::{Integer, Number, Port, integer, number, port};
pub use path::{Path, PathAccess, PathKind, path};
pub use pipe::{Piped, pipe};
pub use sizes::{Bytes, Duration, bytes, duration};
pub use strings::{
    Email, KeyValue, KeyValuePair, OneOf, Url, Uuid, email, key_value, one_of, url, uuid,
};
pub use temporal::{Date, DateTime, Time, date, date_time, time};
pub use text::{Text, text};
