/*
 * How a run's open progress lines share the terminal's height, under ADR-0172's The terminal's
 * height and ADR-0173's extension of it to task groups: each open line, a task included, keeps its
 * own row, the rows left are divided among the lines that have a log, and the rows the log rows
 * leave are divided among the trees that show finished tasks' end lines. Each tree draws as one
 * frame, which reads the height at each frame it builds and draws the smaller of each share and
 * the rows the others' latest frames leave, so the stack never grows taller than the terminal.
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

/** The rows one terminal holds, or `undefined` when its height is unknown or not above 0. */
function heightOf(terminal: Terminal): number | undefined {
  const rows = terminal.rows;
  return rows === undefined || !(rows > 0) ? undefined : rows;
}

/** What the shared height reads from one tree, its finished rows, and asks of it. */
interface TreeRows {
  /** The finished rows the tree has to show now: the end lines of the finished tasks it holds. */
  readonly need: () => number;
  /** Draws the tree's frame again, at its shares under the same rule. */
  readonly redraw: () => void;
}

/** The open lines and the trees that draw on one terminal, each in opening order. */
interface Registry {
  readonly terminal: Terminal;
  readonly seats: Seat[];
  readonly trees: TreePlace[];
}

/** The rows the other trees' latest frames drew for their finished rows. */
function othersFinished(registry: Registry, own: TreePlace): number {
  return registry.trees.reduce((sum, other) => (other === own ? sum : sum + other.drawn), 0);
}

/** One open line's place among the lines that draw on one terminal: a tree's root or a running task. */
class Seat {
  /** The log rows this line drew in its latest frame. */
  drawn = 0;
  readonly tree: TreePlace;
  readonly need: () => number;
  readonly #registry: Registry;

  constructor(registry: Registry, tree: TreePlace, need: () => number) {
    this.#registry = registry;
    this.tree = tree;
    this.need = need;
  }

  /**
   * The log rows this line draws at the frame its tree builds, of the `need` its log has: up to
   * `need` where the height is unknown, and otherwise the smaller of its share and what is left of
   * the rows after each line's own row, the log rows the other lines drew, and the finished rows the
   * other trees drew. It notes them as drawn.
   */
  fit(need: number): number {
    const rows = heightOf(this.#registry.terminal);
    if (rows === undefined) {
      this.drawn = need;
      return need;
    }
    const { seats } = this.#registry;
    const shares = logShares(
      rows - seats.length,
      seats.map((other) => (other === this ? need : other.need())),
    );
    const lines = seats.reduce((sum, other) => (other === this ? sum : sum + other.drawn), 0);
    const left = rows - seats.length - lines - othersFinished(this.#registry, this.tree);
    this.drawn = Math.max(0, Math.min(shares[seats.indexOf(this)] ?? 0, left));
    return this.drawn;
  }

  /** Takes this line out of the lines that share, at its end or its region's close. */
  leave(): void {
    const index = this.#registry.seats.indexOf(this);
    if (index !== -1) {
      this.#registry.seats.splice(index, 1);
    }
  }
}

/** One tree's place among the trees that draw on one terminal, and the lines it seats. */
class TreePlace {
  /** The finished rows this tree drew in its latest frame. */
  drawn = 0;
  readonly tree: TreeRows;
  readonly #registry: Registry;

  constructor(registry: Registry, tree: TreeRows) {
    this.#registry = registry;
    this.tree = tree;
  }

  /**
   * Seats a line of this tree that opens live. A line adds its own row before the others' next
   * frames, so when the stack has no row left for it, each other tree that draws log rows or
   * finished rows draws again first, in the order the roots opened, before this tree draws the
   * line's first frame.
   */
  seat(need: () => number): Seat {
    const registry = this.#registry;
    const opened = new Seat(registry, this, need);
    registry.seats.push(opened);
    const rows = heightOf(registry.terminal);
    const drawn =
      registry.seats.reduce((sum, seat) => sum + seat.drawn, 0) +
      registry.trees.reduce((sum, other) => sum + other.drawn, 0);
    if (rows !== undefined && registry.seats.length + drawn > rows) {
      const drawing = registry.trees.filter(
        (other) =>
          other !== this &&
          (other.drawn > 0 || registry.seats.some((seat) => seat.tree === other && seat.drawn > 0)),
      );
      for (const other of drawing) {
        other.tree.redraw();
      }
    }
    return opened;
  }

  /**
   * The finished rows this tree draws at the frame it builds, of the `need` it has, once its lines
   * have fitted their log rows: up to `need` where the height is unknown, and otherwise the smaller
   * of its share of the rows the log rows leave and what is left of the rows after each line's own
   * row, the log rows every line drew, and the finished rows the other trees drew. It notes them as
   * drawn.
   */
  fit(need: number): number {
    const rows = heightOf(this.#registry.terminal);
    if (rows === undefined) {
      this.drawn = need;
      return need;
    }
    const { trees, seats } = this.#registry;
    const budget = rows - seats.length;
    const logged = logShares(
      budget,
      seats.map((seat) => seat.need()),
    ).reduce((sum, share) => sum + share, 0);
    const shares = logShares(
      budget - logged,
      trees.map((other) => (other === this ? need : other.tree.need())),
    );
    const lines = seats.reduce((sum, seat) => sum + seat.drawn, 0);
    const left = budget - lines - othersFinished(this.#registry, this);
    this.drawn = Math.max(0, Math.min(shares[trees.indexOf(this)] ?? 0, left));
    return this.drawn;
  }

  /** Takes this tree out of the trees that share, at its root's end or its region's close. */
  leave(): void {
    const index = this.#registry.trees.indexOf(this);
    if (index !== -1) {
      this.#registry.trees.splice(index, 1);
    }
    for (const seat of this.#registry.seats.filter((open) => open.tree === this)) {
      seat.leave();
    }
  }
}

/** The open lines and trees of each terminal, held weakly by the run's stderr facts. */
const registries = new WeakMap<Terminal, Registry>();

/** A tree whose root opens live joins the trees that draw on its terminal, and takes its place. */
function joinTree(terminal: Terminal, tree: TreeRows): TreePlace {
  const registry = registries.get(terminal) ?? { seats: [], terminal, trees: [] };
  registries.set(terminal, registry);
  const placed = new TreePlace(registry, tree);
  registry.trees.push(placed);
  return placed;
}

export { logShares, joinTree };
export type { TreePlace, Seat };
