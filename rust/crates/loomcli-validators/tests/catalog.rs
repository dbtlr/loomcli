//! Ports the surface cases of `catalog.test.ts`: every factory publishes an input schema that
//! opens with the draft 2020-12 `$schema` dialect and then its type, in the documented key order, and the catalog's published patterns stay the
//! reference's text.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::type_complexity
)]

mod support;

use loomcli_validators::{
    IpVersion, bytes, cidr, date, date_time, duration, email, host, integer, ip, key_value, number,
    one_of, path, port, text, time, url, uuid,
};
use support::{published, published_value};

#[test]
fn every_factory_publishes_an_input_schema_that_opens_with_the_dialect_then_a_type() {
    let schemas = [
        published_value(&text()),
        published_value(&integer()),
        published_value(&number()),
        published_value(&port()),
        published_value(&one_of(["a"])),
        published_value(&url()),
        published_value(&uuid()),
        published_value(&date()),
        published_value(&date_time()),
        published_value(&time()),
        published_value(&duration()),
        published_value(&path()),
        published_value(&bytes()),
        published_value(&host()),
        published_value(&ip()),
        published_value(&cidr()),
        published_value(&key_value()),
        published_value(&email()),
    ];
    assert_eq!(schemas.len(), 18);
    for schema in schemas {
        let object = schema.as_object().unwrap();
        let keys: Vec<&String> = object.keys().collect();
        assert_eq!(keys[0], "$schema", "{schema}");
        assert_eq!(
            object["$schema"], "https://json-schema.org/draft/2020-12/schema",
            "{schema}"
        );
        assert_eq!(keys[1], "type", "{schema}");
    }
}

#[test]
fn a_published_schema_prints_in_the_documented_key_order() {
    assert_eq!(
        published(&text().max_length(8).pattern("^a", "Expected a leading a.")),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","minLength":1,"maxLength":8,"pattern":"^a"}"#
    );
    assert_eq!(
        published(&integer().min(1).max(9)),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"integer","minimum":1,"maximum":9}"#
    );
    assert_eq!(
        published(&one_of(["b", "a"])),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","enum":["b","a"]}"#
    );
    assert_eq!(
        published(&ip().version(IpVersion::V6)),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","format":"ipv6"}"#
    );
    assert_eq!(
        published(&date().layouts(["%d/%m/%Y"])),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","anyOf":[{"format":"date"},{"pattern":"^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$"}]}"#
    );
    assert_eq!(
        published(&date_time().layouts(["%d.%m.%Y %H:%M"])),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","anyOf":[{"pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\\.[0-9]+)?)?(?:[Zz]|[+-][0-9]{2}(?::?[0-9]{2})?)?$"},{"pattern":"^[0-9]{1,2}\\.[0-9]{1,2}\\.[0-9]{4} [0-9]{1,2}:[0-9]{1,2}$"}]}"#
    );
    assert_eq!(
        published(&duration()),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","pattern":"^\\s*(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:\\s*(?:minutes|seconds|minute|second|hours|weeks|days|hour|msec|week|day|min|sec|hr|ms|d|h|m|s|w)(?:\\s*(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)\\s*(?:minutes|seconds|minute|second|hours|weeks|days|hour|msec|week|day|min|sec|hr|ms|d|h|m|s|w))*)?\\s*$"}"#
    );
    assert_eq!(
        published(&bytes()),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","pattern":"^\\s*(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)\\s*(?:KiB|MiB|GiB|TiB|PiB|Ki|Mi|Gi|Ti|Pi|[kK]B|MB|GB|TB|PB|B)?\\s*$"}"#
    );
    assert_eq!(
        published(&email()),
        r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","pattern":"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$"}"#
    );
}

#[test]
fn a_validator_is_value_stateless_so_one_serves_many_inputs() {
    let validator = integer().min(1);
    for _ in 0..3 {
        assert_eq!(support::accepted(&validator, "5"), 5);
        assert!(support::verdict(&validator, "0").is_err());
    }
}
