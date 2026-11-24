//! The table view: rows as aligned columns that fit the destination's width.
//!
//! [`table`] returns a whole view over the collected rows, `View<[R]>`, so the same value reaches a
//! `RowViews` record and the second argument of `out.render`. Nothing is installed: the value is a
//! bare pack view. The view measures every row before it writes its first line, which buys a
//! column as wide as its widest cell and a fit to the screen. One header line styled `dim`, then
//! one line per row, two spaces between columns, no borders, and no padding after the last column.
//! When the natural width exceeds the context's `columns`, the columns shrink by levelling from the
//! top and their cells wrap; when even the columns' floors cannot fit, the rows print in the
//! records layout, one block per row.

use std::fmt;
use std::sync::Arc;

use loomcli_core::style::{escape, split_lines};
use loomcli_core::{Error, IntoRendered, View, ViewContext};
use serde::Serialize;
use serde_json::Value;

pub use loomcli_core::style::Alignment;

use crate::layout::block::{RecordEntry, record_block};
use crate::layout::data::{data_value, text_value};
use crate::layout::fit::level_widths;
use crate::layout::{data_text, field, own_keys, padded, terminal_wrap, unit_width};

/// The two spaces between one column and the next.
const GAP: &str = "  ";

/// A column's cell function: the field's serialized value, the row, and the context.
type FormatFn<R> = Arc<dyn Fn(&Value, &R, &ViewContext) -> Result<String, Error> + Send + Sync>;

/// One column: the field it reads, its header, its alignment, and an optional `format` that
/// renders its cells.
#[must_use]
pub struct Column<R> {
    key: String,
    header: Option<String>,
    align: Alignment,
    format: Option<FormatFn<R>>,
}

impl<R> Column<R> {
    /// A column reading the field `key` of each row's serialized form, headed by the key as written,
    /// left-aligned, with each cell the value's `String(value)` escaped and styled `primary`.
    pub fn new(key: &str) -> Self {
        Self {
            key: key.to_owned(),
            header: None,
            align: Alignment::Left,
            format: None,
        }
    }

    /// Sets the header, marked text its author owns, which the view styles `dim` and does not
    /// escape.
    pub fn header(self, header: impl Into<String>) -> Self {
        Self {
            header: Some(header.into()),
            ..self
        }
    }

    /// Sets the alignment; `Left` unless set.
    pub fn align(self, align: Alignment) -> Self {
        Self { align, ..self }
    }

    /// Renders each cell of the column from the field's serialized value (`Value::Null` for a
    /// field the row does not carry), the row, and the context. The result is marked text its
    /// author owns, which the view neither escapes nor styles; an `Err` fails the view.
    pub fn format<T: IntoRendered>(
        self,
        format: impl Fn(&Value, &R, &ViewContext) -> T + Send + Sync + 'static,
    ) -> Self {
        Self {
            format: Some(Arc::new(move |value, row, context| {
                format(value, row, context).into_rendered()
            })),
            ..self
        }
    }
}

impl<R> Clone for Column<R> {
    fn clone(&self) -> Self {
        Self {
            key: self.key.clone(),
            header: self.header.clone(),
            align: self.align,
            format: self.format.clone(),
        }
    }
}

impl<R> fmt::Debug for Column<R> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Column")
            .field("key", &self.key)
            .field("header", &self.header)
            .field("align", &self.align)
            .field("format", &self.format.is_some())
            .finish()
    }
}

impl<R> From<&str> for Column<R> {
    /// A bare key: `Column::new(key)`.
    fn from(key: &str) -> Self {
        Self::new(key)
    }
}

/// The table's configuration: an ordered column list, or every own key of the rows in first-seen
/// order when no list is given.
#[must_use]
pub struct TableConfig<R> {
    columns: Option<Vec<Column<R>>>,
}

impl<R> TableConfig<R> {
    /// No column list: every own key that appears in the rows is a column, in first-seen order,
    /// headed by the key as written.
    pub fn new() -> Self {
        Self { columns: None }
    }

    /// The columns, in order. A key may appear twice, as two columns over one field.
    pub fn columns(self, columns: Vec<Column<R>>) -> Self {
        Self {
            columns: Some(columns),
        }
    }
}

impl<R> Default for TableConfig<R> {
    fn default() -> Self {
        Self::new()
    }
}

impl<R> Clone for TableConfig<R> {
    fn clone(&self) -> Self {
        Self {
            columns: self.columns.clone(),
        }
    }
}

impl<R> fmt::Debug for TableConfig<R> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TableConfig")
            .field("columns", &self.columns)
            .finish()
    }
}

impl<R> From<Vec<Column<R>>> for TableConfig<R> {
    /// A configuration with this column list.
    fn from(columns: Vec<Column<R>>) -> Self {
        Self::new().columns(columns)
    }
}

/// One column as the render reads it: its alignment, its header, and how a cell renders.
struct Prepared<'c, R> {
    align: Alignment,
    key: String,
    header: String,
    format: Option<&'c FormatFn<R>>,
}

impl<R> Prepared<'_, R> {
    /// One cell of the column for one row, from its serialized form for a `format` callback and
    /// its text reading for the default cell.
    fn cell(&self, row: &R, read: &Read, context: &ViewContext) -> Result<String, Error> {
        match self.format {
            Some(format) => format(
                field(&read.value, &self.key)
                    .as_ref()
                    .unwrap_or(&Value::Null),
                row,
                context,
            ),
            None => Ok(data_text(field(&read.text, &self.key).as_ref(), context)),
        }
    }
}

/// A row read twice: as a `format` callback receives it, and as its default cells print it.
struct Read {
    value: Value,
    text: Value,
}

impl Read {
    /// `row` through both readings.
    fn of<R: Serialize>(row: &R) -> Result<Self, Error> {
        Ok(Self {
            value: data_value(row)?,
            text: text_value(row)?,
        })
    }
}

/// The configured columns, or every own key in first-seen order across the rows.
fn prepare<'c, R>(configured: Option<&'c [Column<R>]>, reads: &[Read]) -> Vec<Prepared<'c, R>> {
    if let Some(columns) = configured {
        return columns
            .iter()
            .map(|column| Prepared {
                align: column.align,
                key: column.key.clone(),
                header: column.header.clone().unwrap_or_else(|| escape(&column.key)),
                format: column.format.as_ref(),
            })
            .collect();
    }
    let mut seen: Vec<String> = Vec::new();
    for read in reads {
        for key in own_keys(&read.value) {
            if !seen.contains(&key) {
                seen.push(key);
            }
        }
    }
    seen.into_iter()
        .map(|key| Prepared {
            align: Alignment::Left,
            header: escape(&key),
            key,
            format: None,
        })
        .collect()
}

/// The table as the layout reads it: each column's alignment, its header, and its cells.
struct Grid<'a> {
    aligns: Vec<Alignment>,
    headers: Vec<String>,
    cells: Vec<Vec<String>>,
    context: &'a ViewContext,
}

/// Each column's width when it is padded to the widest of its header and cells.
fn natural_widths(grid: &Grid<'_>) -> Vec<usize> {
    (0..grid.headers.len())
        .map(|index| {
            grid.cells
                .iter()
                .filter_map(|row| row.get(index))
                .chain(grid.headers.get(index))
                .map(|text| grid.context.width(text))
                .max()
                .unwrap_or(0)
        })
        .collect()
}

/// Each column's floor: the widest unit `wrap` keeps whole in its header or any cell.
fn floor_widths(grid: &Grid<'_>, natural: &[usize]) -> Vec<usize> {
    natural
        .iter()
        .enumerate()
        .map(|(index, natural)| {
            let widest = grid
                .cells
                .iter()
                .filter_map(|row| row.get(index))
                .chain(grid.headers.get(index))
                .map(|text| unit_width(text, grid.context))
                .max()
                .unwrap_or(0);
            widest.min(*natural)
        })
        .collect()
}

/// The column widths of a render, or `None` when the rows must print as record blocks. Off a
/// terminal, and on one the natural widths fit, each column is as wide as its widest text.
/// Otherwise the columns level down to their floors. When even the floors do not fit, a table with
/// rows falls back to records, and an empty one prints its header line at the floors.
fn fitted_widths(grid: &Grid<'_>) -> Option<Vec<usize>> {
    let natural = natural_widths(grid);
    let gaps = GAP.len() * natural.len().saturating_sub(1);
    let Some(target) = grid.context.columns.map(usize::from) else {
        return Some(natural);
    };
    if natural.iter().sum::<usize>() + gaps <= target {
        return Some(natural);
    }
    let floors = floor_widths(grid, &natural);
    if floors.iter().sum::<usize>() + gaps > target {
        return grid.cells.is_empty().then_some(floors);
    }
    Some(level_widths(&natural, &floors, target - gaps))
}

/// The lines of one cell. Off a terminal the cell is one unit, whatever its breaks. On a terminal
/// it wraps at its column's width, and each line is its own.
fn cell_lines(text: &str, context: &ViewContext, width: usize) -> Vec<String> {
    if context.columns.is_none() {
        return vec![text.to_owned()];
    }
    split_lines(&terminal_wrap(
        text,
        context,
        Some(i64::try_from(width).unwrap_or(i64::MAX)),
    ))
}

/// One cell line padded to its column width, except the line's rightmost cell, which adds no
/// spaces after its text.
fn render_cell(
    align: Alignment,
    text: &str,
    width: usize,
    last: bool,
    context: &ViewContext,
) -> String {
    if !last || align == Alignment::Right {
        return padded(text, width, align);
    }
    if align == Alignment::Left {
        return text.to_owned();
    }
    let leading = width.saturating_sub(context.width(text)) / 2;
    format!("{}{text}", padded("", leading, Alignment::Left))
}

/// The rightmost column a line reaches. Off a terminal every cell is one line, so the line reaches
/// the last column. On a terminal it reaches the rightmost cell that has text at this height.
fn reach(cells: &[Vec<String>], at: usize, context: &ViewContext) -> Option<usize> {
    (0..cells.len()).rev().find(|index| {
        cells
            .get(*index)
            .and_then(|lines| lines.get(at))
            .is_some_and(|text| context.columns.is_none() || !context.plain(text).is_empty())
    })
}

/// One row of cells as lines, as tall as its tallest cell. Each line runs through the rightmost
/// column it reaches, which carries no padding; a shorter cell to its left adds a padded blank.
fn row_lines(
    cells: &[Vec<String>],
    aligns: &[Alignment],
    widths: &[usize],
    context: &ViewContext,
) -> Vec<String> {
    let height = cells.iter().map(Vec::len).max().unwrap_or(0);
    (0..height)
        .map(|at| {
            let Some(rightmost) = reach(cells, at, context) else {
                return String::new();
            };
            (0..=rightmost)
                .map(|index| {
                    let text = cells
                        .get(index)
                        .and_then(|lines| lines.get(at))
                        .map_or("", String::as_str);
                    render_cell(
                        aligns.get(index).copied().unwrap_or_default(),
                        text,
                        widths.get(index).copied().unwrap_or(0),
                        index == rightmost,
                        context,
                    )
                })
                .collect::<Vec<_>>()
                .join(GAP)
        })
        .collect()
}

/// The table as one line per cell line, with the header first, at the given column widths.
fn table_lines(grid: &Grid<'_>, widths: &[usize]) -> Vec<String> {
    let context = grid.context;
    let dim = context.style.dim();
    let width_of = |index: usize| widths.get(index).copied().unwrap_or(0);
    let header: Vec<Vec<String>> = grid
        .headers
        .iter()
        .enumerate()
        .map(|(index, text)| {
            cell_lines(text, context, width_of(index))
                .iter()
                .map(|line| dim.apply(line))
                .collect()
        })
        .collect();
    let body = grid.cells.iter().map(|row| {
        row.iter()
            .enumerate()
            .map(|(index, text)| cell_lines(text, context, width_of(index)))
            .collect::<Vec<_>>()
    });
    std::iter::once(header)
        .chain(body)
        .flat_map(|row| row_lines(&row, &grid.aligns, widths, context))
        .collect()
}

/// The rows as record blocks, for a table whose columns cannot fit at their floors.
fn fallback_blocks(grid: &Grid<'_>) -> String {
    grid.cells
        .iter()
        .map(|row| {
            let entries: Vec<RecordEntry> = grid
                .headers
                .iter()
                .enumerate()
                .map(|(index, label)| RecordEntry {
                    align: grid.aligns.get(index).copied().unwrap_or_default(),
                    label: label.clone(),
                    value: row.get(index).cloned().unwrap_or_default(),
                })
                .collect();
            record_block(&entries, grid.context)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The whole render: the rows serialized, their columns prepared, measured, fitted, and laid out.
fn render_table<R: Serialize>(
    configured: Option<&[Column<R>]>,
    rows: &[R],
    context: &ViewContext,
) -> Result<String, Error> {
    let reads = rows.iter().map(Read::of).collect::<Result<Vec<_>, _>>()?;
    let columns = prepare(configured, &reads);
    if columns.is_empty() {
        return Ok(String::new());
    }
    // On a terminal a tab becomes spaces from its cell's start, so fitting measures what shows.
    let laid = |text: &str| terminal_wrap(text, context, None);
    let mut cells = Vec::with_capacity(rows.len());
    for (row, read) in rows.iter().zip(&reads) {
        let mut line = Vec::with_capacity(columns.len());
        for column in &columns {
            line.push(laid(&column.cell(row, read, context)?));
        }
        cells.push(line);
    }
    let grid = Grid {
        aligns: columns.iter().map(|column| column.align).collect(),
        headers: columns.iter().map(|column| laid(&column.header)).collect(),
        cells,
        context,
    };
    Ok(match fitted_widths(&grid) {
        Some(widths) => format!("{}\n", table_lines(&grid, &widths).join("\n")),
        None => fallback_blocks(&grid),
    })
}

/// A whole view that renders rows as a table, with columns measured before the first line is
/// returned. A row's fields are read from its serialized form, a JSON object whose members keep
/// their declaration order. The returned value is a bare pack view and installs nothing.
///
/// `table(TableConfig::new())` makes every own key a column; `table(vec![...])` names the columns,
/// each a [`Column`] or a bare key through `"key".into()`.
pub fn table<R: Serialize + 'static>(config: impl Into<TableConfig<R>>) -> View<[R]> {
    let config = config.into();
    View::new(move |rows: &[R], context: &ViewContext| {
        render_table(config.columns.as_deref(), rows, context)
    })
}
