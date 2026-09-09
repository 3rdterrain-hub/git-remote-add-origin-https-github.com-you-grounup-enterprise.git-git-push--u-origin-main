/**
 * Typing in a number box replaces the number that was there.
 *
 * Every numeric field in this application is a controlled input showing the
 * value on the record, and a value on the record is usually `0`. Clicking one
 * and typing `5` put the caret next to that zero and left `05` — or `50`,
 * depending on where the click landed. Reported as "when I type a value in any
 * box I want to see the typed value not 0 first", which is the same complaint
 * from the other side: the first thing typed should be the whole of what the
 * box says.
 *
 * So a numeric box selects what it holds the moment it is entered, by mouse or
 * by tab, and the first keystroke replaces it. This is what a spreadsheet does,
 * and an estimator moving down a column of quantities has spent their career in
 * one.
 *
 * The mouse needs one extra step. Focus arrives on `mousedown`, but the caret
 * is placed on `mouseup`, which lands *after* the selection and collapses it.
 * Preventing that default is what keeps the selection — but only on the click
 * that brought focus in, because preventing it always would break dragging to
 * select part of a number, and correcting the third digit of a rate is a normal
 * thing to want to do.
 */
import { useRef, type FocusEvent, type MouseEvent } from 'react';

export interface SelectOnFocusHandlers<T extends HTMLInputElement> {
  onFocus: (e: FocusEvent<T>) => void;
  onMouseDown: (e: MouseEvent<T>) => void;
  onMouseUp: (e: MouseEvent<T>) => void;
}

export function useSelectOnFocus<T extends HTMLInputElement>(): SelectOnFocusHandlers<T> {
  /* Whether the click that is arriving found the field already focused. */
  const alreadyIn = useRef(false);

  return {
    onFocus: (e) => {
      const el = e.currentTarget;
      /*
       * `select` is not implemented on every input type in every browser — a
       * date or color input throws — and a box that throws when it is clicked
       * is worse than one that does not select.
       */
      try { el.select?.(); } catch { /* the field keeps its caret */ }
    },
    onMouseDown: (e) => {
      alreadyIn.current =
        typeof document !== 'undefined' && document.activeElement === e.currentTarget;
    },
    onMouseUp: (e) => {
      if (!alreadyIn.current) e.preventDefault();
    },
  };
}

/**
 * Whether a field holds a number, and so should select what it holds.
 *
 * Read off the two attributes that already say so, rather than a prop every
 * caller would have to remember: `type="number"` and the decimal or numeric
 * keypad. A field can still say `selectOnFocus` either way — the quantity cell
 * takes `1200 / 27` and is `inputMode="text"` for it, and still wants this.
 */
export function isNumericField(
  type: string | undefined, inputMode: string | undefined,
): boolean {
  return type === 'number' || inputMode === 'decimal' || inputMode === 'numeric';
}
