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
export type ArithmeticResult = {
    ok: true;
    value: number;
    expression: string;
} | {
    ok: false;
    error: ArithmeticError;
};
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
export declare function evaluateQuantity(input: string): ArithmeticResult;
/**
 * Whether a string is worth evaluating rather than reading as a plain number.
 *
 * A field that recalculated on every keystroke would fight the person typing;
 * a field that only ever took plain numbers would not be a calculator. This is
 * the line between them.
 */
export declare function looksCalculated(input: string): boolean;
