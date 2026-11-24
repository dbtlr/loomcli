//! A default cell, value, and item print `String(value)` of the data the author returned: an
//! integer with all its digits whatever its size, as a `bigint` does, a float as JavaScript writes
//! the double, `NaN` and the infinities by name, and an `f32` as its own shortest digits. A
//! `format` callback reads the serialized value: an `f32` as the double its digits name, a
//! non-finite number as `null`, and a 128-bit integer beyond 64 bits as its digits in a string.
//! No reference file covers this; the rule is `docs/plugins/pack-views.md`'s `String(value)`.

#![cfg(any(feature = "records", feature = "table", feature = "list"))]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod pack_support;

use std::future::Future;

use loomcli_core::Out;
use pack_support::{ViewRun, render_each};
#[cfg(any(feature = "records", feature = "table"))]
use serde::Serialize;

#[cfg(any(feature = "records", feature = "table"))]
#[derive(Clone, Serialize)]
struct Nested {
    depth: u8,
}

#[cfg(any(feature = "records", feature = "table"))]
/// A row holding each number JSON data cannot carry as written, and the compound values.
#[derive(Clone, Serialize)]
struct Sample {
    id: u64,
    offset: i64,
    sum: f64,
    large: f64,
    small: f64,
    zero: f64,
    ratio: f64,
    rise: f64,
    fall: f64,
    single: f32,
    wide: u128,
    values: Vec<Option<f64>>,
    nested: Nested,
}

#[cfg(any(feature = "records", feature = "table"))]
fn sample() -> Sample {
    Sample {
        id: 1_731_400_000_123_456_789,
        offset: -9_007_199_254_740_993,
        sum: 0.1 + 0.2,
        large: 1e21,
        small: 1e-7,
        zero: -0.0,
        ratio: f64::NAN,
        rise: f64::INFINITY,
        fall: f64::NEG_INFINITY,
        single: 0.1,
        wide: u128::MAX,
        values: vec![Some(1.5), None, Some(f64::NAN)],
        nested: Nested { depth: 1 },
    }
}

/// What `draw` prints through `out.render` on a pipe.
async fn piped<F, Fut>(draw: F) -> String
where
    F: Fn(Out) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = loomcli_core::Outcome> + Send + 'static,
{
    render_each(&ViewRun::new(&[None]), draw).await
}

#[cfg(feature = "records")]
#[tokio::test]
async fn a_default_record_value_prints_the_number_the_row_holds() {
    use loomcli_plugins::records::{RecordsConfig, records};
    let output = piped(|out| async move {
        out.render(vec![sample()], &records(RecordsConfig::new("id")))
            .await
    })
    .await;
    assert_eq!(
        output,
        "id      1731400000123456789\n\
         offset  -9007199254740993\n\
         sum     0.30000000000000004\n\
         large   1e+21\n\
         small   1e-7\n\
         zero    0\n\
         ratio   NaN\n\
         rise    Infinity\n\
         fall    -Infinity\n\
         single  0.1\n\
         wide    340282366920938463463374607431768211455\n\
         values  1.5,,NaN\n\
         nested  [object Object]\n\
         \n\
         1 record\n"
    );
}

#[cfg(feature = "records")]
#[tokio::test]
async fn a_record_format_reads_the_serialized_value() {
    use loomcli_plugins::records::{Field, RecordsConfig, records};
    use serde_json::Value;
    let shown =
        |key: &str| Field::new(key).format(|value: &Value, _: &Sample, _| value.to_string());
    let view = records(RecordsConfig::new("id").field_list(vec![
        shown("id"),
        shown("single"),
        shown("ratio"),
        shown("wide"),
        shown("values"),
    ]));
    let output = piped(move |out| {
        let view = view.clone();
        async move { out.render(vec![sample()], &view).await }
    })
    .await;
    assert_eq!(
        output,
        "id      1731400000123456789\n\
         single  0.1\n\
         ratio   null\n\
         wide    \"340282366920938463463374607431768211455\"\n\
         values  [1.5,null,null]\n\
         \n\
         1 record\n"
    );
}

#[cfg(feature = "table")]
#[tokio::test]
async fn a_default_table_cell_prints_the_number_the_row_holds() {
    use loomcli_plugins::table::{TableConfig, table};
    let rows = vec![sample()];
    let output = piped(move |out| {
        let rows = rows.clone();
        async move { out.render(&rows, &table(TableConfig::new())).await }
    })
    .await;
    let header = [
        "id                   offset             sum                  large  small  zero  ",
        "ratio  rise      fall       single  wide                                     ",
        "values    nested\n",
    ]
    .concat();
    let row = [
        "1731400000123456789  -9007199254740993  0.30000000000000004  1e+21  1e-7   0     ",
        "NaN    Infinity  -Infinity  0.1     340282366920938463463374607431768211455  ",
        "1.5,,NaN  [object Object]\n",
    ]
    .concat();
    assert_eq!(output, format!("{header}{row}"));
}

#[cfg(feature = "list")]
#[tokio::test]
async fn a_default_list_item_prints_the_float_the_item_holds() {
    use loomcli_plugins::list::{ListConfig, list};
    let output = piped(|out| async move {
        let items = vec![
            0.1 + 0.2,
            1e21,
            -0.0,
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
        ];
        out.render(&items, &list(ListConfig::new().ordered(true)))
            .await
    })
    .await;
    assert_eq!(
        output,
        "1. 0.30000000000000004\n2. 1e+21\n3. 0\n4. NaN\n5. Infinity\n6. -Infinity\n"
    );
}

#[cfg(feature = "list")]
#[tokio::test]
async fn a_default_list_item_prints_every_digit_of_an_integer() {
    use loomcli_plugins::list::{ListConfig, list};
    let output = piped(|out| async move {
        let items: Vec<i128> = vec![
            i128::from(u64::MAX),
            i128::from(i64::MIN),
            -9_007_199_254_740_993,
            i128::MIN,
        ];
        out.render(&items, &list(ListConfig::new().ordered(true)))
            .await
    })
    .await;
    assert_eq!(
        output,
        "1. 18446744073709551615\n\
         2. -9223372036854775808\n\
         3. -9007199254740993\n\
         4. -170141183460469231731687303715884105728\n"
    );
}

#[cfg(feature = "list")]
#[tokio::test]
async fn a_default_list_item_prints_an_f32_as_its_own_shortest_digits() {
    use loomcli_plugins::list::{ListConfig, list};
    let output = piped(|out| async move {
        let items: Vec<f32> = vec![0.1, 16_777_217.0, 1e-7, f32::MAX, f32::NAN];
        out.render(&items, &list(ListConfig::new().ordered(true)))
            .await
    })
    .await;
    assert_eq!(
        output,
        "1. 0.1\n2. 16777216\n3. 1e-7\n4. 3.4028235e+38\n5. NaN\n"
    );
}
