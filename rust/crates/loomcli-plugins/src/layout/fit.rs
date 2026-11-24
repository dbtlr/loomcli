//! The table's fit: column widths that shrink by levelling from the top.

/// The width of each column when no column is wider than `level`, unless its floor is.
fn widths_at(natural: &[usize], floors: &[usize], level: usize) -> Vec<usize> {
    natural
        .iter()
        .zip(floors)
        .map(|(width, floor)| (*floor).max((*width).min(level)))
        .collect()
}

/// The largest whole level at which the columns still fit `available`, found by bisection. The
/// floors fit at level 0, and the natural widths do not fit at the widest of them.
fn largest_level(natural: &[usize], floors: &[usize], available: usize) -> usize {
    let mut low = 0;
    let mut high = natural.iter().copied().max().unwrap_or(0);
    while high - low > 1 {
        let middle = (low + high) / 2;
        if widths_at(natural, floors, middle).iter().sum::<usize>() <= available {
            low = middle;
        } else {
            high = middle;
        }
    }
    low
}

/// The widths of columns that must give up room, by levelling from the top. It finds the largest
/// whole level at which every column at `max(floor, min(natural, level))` still fits `available`,
/// and gives the columns that sit exactly at that level and are naturally wider one leftover column
/// each, from the left. The widths total `available` exactly. The caller guarantees that the floors
/// fit and that the natural widths do not.
pub(crate) fn level_widths(natural: &[usize], floors: &[usize], available: usize) -> Vec<usize> {
    let level = largest_level(natural, floors, available);
    let widths = widths_at(natural, floors, level);
    let mut remainder = available.saturating_sub(widths.iter().sum());
    widths
        .iter()
        .zip(natural)
        .map(|(width, natural)| {
            if remainder > 0 && *width == level && *natural > level {
                remainder -= 1;
                width + 1
            } else {
                *width
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::level_widths;

    // table-fit.test.ts: the levelling formula on `levelWidths` itself.

    #[test]
    fn levelling_from_the_top_gives_the_documented_widths() {
        assert_eq!(level_widths(&[40, 20, 6], &[5, 5, 6], 46), [20, 20, 6]);
        assert_eq!(level_widths(&[40, 20, 6], &[5, 5, 6], 40), [17, 17, 6]);
        assert_eq!(level_widths(&[40, 20, 6], &[5, 5, 6], 39), [17, 16, 6]);
    }

    #[test]
    fn the_remainder_skips_a_column_at_l_by_its_natural_width_and_one_held_above_l_by_its_floor() {
        assert_eq!(level_widths(&[5, 10, 10], &[1, 1, 1], 16), [5, 6, 5]);
        assert_eq!(level_widths(&[40, 20, 20], &[30, 1, 1], 61), [30, 16, 15]);
    }

    #[test]
    fn the_remainder_goes_one_column_each_from_the_left_to_the_tied_columns() {
        assert_eq!(level_widths(&[30, 30, 30], &[5, 6, 5], 80), [27, 27, 26]);
    }
}
