/*
 * How a run's open progress lines share the terminal's height, under ADR-0172's The terminal's
 * height: each line keeps its own row, and the rows left are divided among the lines that have a
 * log. A line reads the height at each frame it builds and draws the smaller of its share and the
 * rows the other lines' latest frames leave, so the stack never grows taller than the terminal.
 */

/**
 * Each line's share of `budget` log rows, in opening order: equal shares, none above its need, the
 * rows a line does not need going to the others, and a remainder that cannot be divided equally
 * going one row each to the lines that opened first. A budget of 0 or less gives every line none.
 */
function logShares(budget: number, needs: readonly number[]): number[] {
  const shares = needs.map(() => 0);
  let left = budget;
  let wanting = needs.flatMap((need, index) => (need > 0 ? [index] : []));
  while (left > 0 && wanting.length > 0) {
    const each = Math.floor(left / wanting.length);
    if (each === 0) {
      // Fewer rows are left than lines that want one, so the lines that opened first take them.
      for (const index of wanting.slice(0, left)) {
        shares[index] = (shares[index] ?? 0) + 1;
      }
      return shares;
    }
    for (const index of wanting) {
      const share = shares[index] ?? 0;
      const given = Math.min(each, (needs[index] ?? 0) - share);
      shares[index] = share + given;
      left -= given;
    }
    wanting = wanting.filter((index) => (shares[index] ?? 0) < (needs[index] ?? 0));
  }
  return shares;
}

/** The terminal facts a line reads its height from: the run's stderr. */
interface Terminal {
  readonly rows: number | undefined;
}

/** What the shared height reads from one line and asks of it. */
interface SharingLine {
  /** The rows the line's log has to show now, at most its `logRows`. */
  readonly need: () => number;
  /** Draws the line's frame again, at its share under the same rule. */
  readonly redraw: () => void;
}

/** One open line's place among the lines that draw on one terminal. */
class Seat {
  /** The log rows this line drew in its latest frame. */
  drawn = 0;
  readonly line: SharingLine;
  readonly #terminal: Terminal;
  readonly #seats: Seat[];

  constructor(terminal: Terminal, seats: Seat[], line: SharingLine) {
    this.#terminal = terminal;
    this.#seats = seats;
    this.line = line;
  }

  /**
   * The log rows this line draws at the frame it builds, of the `need` its log has: up to `need`
   * where the height is unknown, and otherwise the smaller of its share and what is left of the
   * rows after each line's own row and the log rows the other lines drew. It notes them as drawn.
   */
  fit(need: number): number {
    const rows = this.#terminal.rows;
    if (rows === undefined || !(rows > 0)) {
      this.drawn = need;
      return need;
    }
    const seats = this.#seats;
    const shares = logShares(
      rows - seats.length,
      seats.map((other) => (other === this ? need : other.line.need())),
    );
    const others = seats.reduce((sum, other) => (other === this ? sum : sum + other.drawn), 0);
    const left = rows - seats.length - others;
    this.drawn = Math.max(0, Math.min(shares[seats.indexOf(this)] ?? 0, left));
    return this.drawn;
  }

  /** Takes this line out of the lines that share, at its end or its region's close. */
  leave(): void {
    const index = this.#seats.indexOf(this);
    if (index !== -1) {
      this.#seats.splice(index, 1);
    }
  }
}

/** The open lines of each terminal, in opening order, held weakly by the run's stderr facts. */
const seated = new WeakMap<Terminal, Seat[]>();

/**
 * Seats a line that opens live among the lines on the same terminal. A line adds its own row before
 * the others' next frames, so when the stack has no row left for it, each line that draws log rows
 * draws again first, in opening order, before the new line draws its first frame.
 */
function seat(terminal: Terminal, line: SharingLine): Seat {
  const seats = seated.get(terminal) ?? [];
  seated.set(terminal, seats);
  const opened = new Seat(terminal, seats, line);
  const earlier = [...seats];
  seats.push(opened);
  const rows = terminal.rows;
  const height = seats.length + earlier.reduce((sum, other) => sum + other.drawn, 0);
  if (rows !== undefined && rows > 0 && height > rows) {
    for (const other of earlier.filter((drawing) => drawing.drawn > 0)) {
      other.line.redraw();
    }
  }
  return opened;
}

export { logShares, seat };
export type { Seat };
