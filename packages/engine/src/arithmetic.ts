/**
 * The arithmetic an estimator does in their head, done in the cell instead.
 *
 * A quantity is almost never a number somebody knows. It is 120 feet by 4 feet
 * by 8 inches, or 42 footings at 1.2 cubic yards, or a takeoff of 3,180 less
 * the 240 that is already in place. Estimators do that arithmetic somewhere —
 * on a calculator, in a spreadsheet, on the back of the drawing — and then type
 * the answer. What gets typed is a number with no account of itself, and the
 * commonest estimating error in the world is a decimal point in the wrong place
 * in a calculation nobody can see.
 *
 * So the expression is the input, and it is kept. Two properties make that safe
 * to build on:
 *
 *   * **Nothing is executed.** This is a tokenizer and a recursive-descent
 *     parser over a grammar with five operators and parentheses. `eval` on an
 *     estimator's text would be a remote code path in a browser, and a
 *     `Function` constructor is the same thing wearing a hat.
 *
 *   * **A refusal is a message, never a wrong number.** Every failure says
 *     where it is and what was expected. An expression that cannot be read
 *     produces no quantity at all rather than a partial one — a calculator that
 *     silently drops the tail of `120 * 4 +` would be worse than no calculator.
 *
 * Units of measure are deliberately absent. This evaluates numbers; what they
 * measure is the line's unit, and inferring feet from an expression would be
 * the platform guessing at the one thing the estimator has already stated.
 */

/** What went wrong, and where in the expression it went wrong. */
export interface ArithmeticError {
  message: string;
  /** Zero-based offset into the expression, for pointing at the problem. */
  position: number;
}

export type ArithmeticResult =
  | { ok: true; value: number; expression: string }
  | { ok: false; error: ArithmeticError };

type Token =
  | { kind: 'number'; value: number; at: number }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '^' | '%'; at: number }
  | { kind: 'lparen'; at: number }
  | { kind: 'rparen'; at: number };

/** The characters an expression may contain, for a cheap early rejection. */
const ALLOWED = /^[0-9+\-*/^%().,\s×÷']*$/;

/**
 * Read an expression into tokens.
 *
 * Three conveniences, each because estimators type them: `×` and `÷` from a
 * phone keyboard, thousands separators in `3,180`, and a foot mark in `120'`
 * which is dropped rather than interpreted — the line already carries its unit.
 */
function tokenize(input: string): Token[] | ArithmeticError {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const c = input[i]!;

    if (/\s/.test(c)) { i += 1; continue; }
    // A foot mark after a number is punctuation here, not an operator.
    if (c === "'") { i += 1; continue; }

    if (/[0-9.]/.test(c)) {
      let j = i;
      let digits = '';
      let dots = 0;
      while (j < input.length) {
        const d = input[j]!;
        if (/[0-9]/.test(d)) { digits += d; j += 1; continue; }
        if (d === '.') { dots += 1; digits += d; j += 1; continue; }
        // A comma between digits is a thousands separator; anywhere else it ends the number.
        if (d === ',' && /[0-9]/.test(input[j + 1] ?? '')) { j += 1; continue; }
        break;
      }
      if (dots > 1) {
        return { message: 'That number has more than one decimal point', position: i };
      }
      const value = Number(digits);
      if (!Number.isFinite(value)) {
        return { message: `"${digits}" is not a number`, position: i };
      }
      tokens.push({ kind: 'number', value, at: i });
      i = j;
      continue;
    }

    if (c === '(') { tokens.push({ kind: 'lparen', at: i }); i += 1; continue; }
    if (c === ')') { tokens.push({ kind: 'rparen', at: i }); i += 1; continue; }

    const op = c === '×' ? '*' : c === '÷' ? '/' : c;
    if (op === '+' || op === '-' || op === '*' || op === '/' || op === '^' || op === '%') {
      tokens.push({ kind: 'op', value: op, at: i });
      i += 1;
      continue;
    }

    return { message: `"${c}" is not something this can work out`, position: i };
  }

  return tokens;
}

/**
 * Evaluate an expression.
 *
 * Grammar, loosest binding first:
 *
 *     expression := term (('+' | '-') term)*
 *     term       := power (('*' | '/' | '%') power)*
 *     power      := unary ('^' power)?            -- right associative
 *     unary      := ('-' | '+')? primary
 *     primary    := number | '(' expression ')'
 *
 * `%` is a remainder rather than a percentage. A percentage sign after a number
 * would mean "of what?", and the only honest answer on an estimate line is a
 * question the estimator has to answer with the multiplication they meant.
 */
export function evaluateQuantity(input: string): ArithmeticResult {
  const expression = input.trim();

  if (expression.length === 0) {
    return { ok: false, error: { message: 'Nothing to work out', position: 0 } };
  }
  if (expression.length > 200) {
    return {
      ok: false,
      error: { message: 'That is longer than a quantity calculation should be', position: 200 },
    };
  }
  if (!ALLOWED.test(expression)) {
    const at = [...expression].findIndex((c) => !ALLOWED.test(c));
    return {
      ok: false,
      error: {
        message: 'Only numbers, + − × ÷ and brackets belong in a quantity',
        position: Math.max(at, 0),
      },
    };
  }

  const tokens = tokenize(expression);
  if (!Array.isArray(tokens)) return { ok: false, error: tokens };
  if (tokens.length === 0) {
    return { ok: false, error: { message: 'Nothing to work out', position: 0 } };
  }

  let pos = 0;
  let failure: ArithmeticError | null = null;
  const fail = (message: string, at: number): number => {
    failure ??= { message, position: at };
    return 0;
  };
  const peek = (): Token | undefined => tokens[pos];

  const primary = (): number => {
    const t = peek();
    if (!t) return fail('The expression stops before it is finished', expression.length);
    if (t.kind === 'number') { pos += 1; return t.value; }
    if (t.kind === 'lparen') {
      pos += 1;
      const inner = expr();
      const close = peek();
      if (!close || close.kind !== 'rparen') {
        return fail('A bracket was opened and never closed', t.at);
      }
      pos += 1;
      return inner;
    }
    if (t.kind === 'rparen') return fail('A bracket was closed that was never opened', t.at);
    return fail(`An operator where a number was expected`, t.at);
  };

  const unary = (): number => {
    const t = peek();
    if (t?.kind === 'op' && (t.value === '-' || t.value === '+')) {
      pos += 1;
      const v = unary();
      return t.value === '-' ? -v : v;
    }
    return primary();
  };

  const power = (): number => {
    const base = unary();
    const t = peek();
    if (t?.kind === 'op' && t.value === '^') {
      pos += 1;
      const exponent = power();
      return base ** exponent;
    }
    return base;
  };

  const term = (): number => {
    let left = power();
    for (;;) {
      const t = peek();
      if (t?.kind !== 'op') break;
      if (t.value !== '*' && t.value !== '/' && t.value !== '%') break;
      pos += 1;
      const right = power();
      if (failure) return 0;
      if ((t.value === '/' || t.value === '%') && right === 0) {
        return fail('Dividing by zero has no answer', t.at);
      }
      left = t.value === '*' ? left * right
        : t.value === '/' ? left / right
        : left % right;
    }
    return left;
  };

  const expr = (): number => {
    let left = term();
    for (;;) {
      const t = peek();
      if (t?.kind !== 'op') break;
      if (t.value !== '+' && t.value !== '-') break;
      pos += 1;
      const right = term();
      if (failure) return 0;
      left = t.value === '+' ? left + right : left - right;
    }
    return left;
  };

  const value = expr();

  if (failure) return { ok: false, error: failure };
  if (pos < tokens.length) {
    const left = tokens[pos]!;
    // Naming the actual problem: a stray ')' is a bracket, not a leftover.
    return {
      ok: false,
      error: {
        message: left.kind === 'rparen'
          ? 'A bracket was closed that was never opened'
          : 'There is something left over at the end',
        position: left.at,
      },
    };
  }
  if (!Number.isFinite(value)) {
    return { ok: false, error: { message: 'That does not come to a number', position: 0 } };
  }
  if (value < 0) {
    return {
      ok: false,
      error: { message: 'A quantity cannot be negative', position: 0 },
    };
  }

  /*
   * Four decimals, which is what `estimate_line_items.measured_quantity` holds.
   * Rounding here rather than at the database means the number the estimator
   * sees is the number that is stored.
   */
  return { ok: true, value: Math.round(value * 10_000) / 10_000, expression };
}

/**
 * Whether a string is worth evaluating rather than reading as a plain number.
 *
 * A field that recalculated on every keystroke would fight the person typing;
 * a field that only ever took plain numbers would not be a calculator. This is
 * the line between them.
 */
export function looksCalculated(input: string): boolean {
  return /[+\-*/^%()×÷]/.test(input.trim().replace(/^[-+]/, ''));
}
