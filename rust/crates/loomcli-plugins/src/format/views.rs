//! Whole and row views that write JSON text.

use loomcli_core::{Error, RowView, View, ViewContext};
use serde::Serialize;

use crate::encode::{escape_controls, stringify, stringify_lines};

/// The text a view writes: escaped against the markup delimiters, then against the C1 controls, so
/// nothing a rendering policy would strip or read as a terminal control reaches it.
fn encoded(text: &str, context: &ViewContext) -> String {
    escape_controls(&context.style.escape(text))
}

/// One indented document and a newline.
fn line<T: Serialize + ?Sized>(
    value: &T,
    pretty: bool,
    context: &ViewContext,
) -> Result<String, Error> {
    let mut text = stringify(value, pretty)?;
    text.push('\n');
    Ok(encoded(&text, context))
}

/// One compact line per element when the value serializes as an array, and one line otherwise.
fn lines<T: Serialize + ?Sized>(value: &T, context: &ViewContext) -> Result<String, Error> {
    Ok(encoded(&stringify_lines(value)?, context))
}

/// A whole view that writes the data as one JSON document indented two spaces, with one trailing
/// newline, declared `application/json`. Under a rows result the data is the collected array.
pub fn json<D: Serialize + ?Sized + 'static>() -> View<D> {
    View::new(|data: &D, context: &ViewContext| line(data, true, context))
        .media_type("application/json")
}

/// [`json`] over what `map` returns for the data, declared `application/json` all the same.
pub fn json_mapped<D: ?Sized + 'static, M: Serialize>(
    map: impl Fn(&D) -> M + Send + Sync + 'static,
) -> View<D> {
    View::new(move |data: &D, context: &ViewContext| line(&map(data), true, context))
        .media_type("application/json")
}

/// A whole view that writes JSON Lines, declared `application/jsonl`: one compact line per element
/// when the data serializes as an array, and one such line otherwise. An empty array prints
/// nothing. Under a rows result the data is the collected array.
pub fn jsonl<D: Serialize + ?Sized + 'static>() -> View<D> {
    View::new(|data: &D, context: &ViewContext| lines(data, context))
        .media_type("application/jsonl")
}

/// [`jsonl`] over what `map` returns for the data, declared `application/jsonl` all the same.
pub fn jsonl_mapped<D: ?Sized + 'static, M: Serialize>(
    map: impl Fn(&D) -> M + Send + Sync + 'static,
) -> View<D> {
    View::new(move |data: &D, context: &ViewContext| lines(&map(data), context))
        .media_type("application/jsonl")
}

/// A row view that writes each row as one compact JSON line, declared `application/jsonl`.
/// It writes no head or tail and emits nothing for an empty source.
pub fn jsonl_rows<R: Serialize + 'static>() -> RowView<R> {
    RowView::new(|row: &R, _, context: &ViewContext| line(row, false, context))
        .media_type("application/jsonl")
}

/// Like [`jsonl_rows`], with a mapping function applied to each row before encoding.
/// A mapped array is written as one line.
pub fn jsonl_rows_mapped<R: 'static, M: Serialize>(
    map: impl Fn(&R) -> M + Send + Sync + 'static,
) -> RowView<R> {
    RowView::new(move |row: &R, _, context: &ViewContext| line(&map(row), false, context))
        .media_type("application/jsonl")
}
