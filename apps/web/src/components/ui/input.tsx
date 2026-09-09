import * as React from 'react';
import { cn } from '@/lib/utils';
import { isNumericField, useSelectOnFocus } from '@/lib/select-on-focus';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * Select what the box holds when it is entered, so the first keystroke
   * replaces it rather than landing beside it.
   *
   * On by default for a numeric field, because a number box almost always
   * holds a whole value that is being replaced rather than edited. Off by
   * default for text, where the opposite is true. Either can be said outright.
   */
  selectOnFocus?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, selectOnFocus, onFocus, onMouseDown, onMouseUp, ...props }, ref) => {
    const select = useSelectOnFocus<HTMLInputElement>();
    const selects = selectOnFocus ?? isNumericField(type, props.inputMode);

    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          'flex h-10 w-full rounded-md border border-charcoal-300 bg-white px-3 py-2 text-sm text-charcoal-900',
          'placeholder:text-charcoal-400 focus-visible:border-yellow-500 focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:bg-charcoal-100 disabled:opacity-70',
          'aria-invalid:border-danger-500',
          className,
        )}
        /*
         * The caller's own handler still runs. Selecting is something the box
         * does on the way in, not instead of what the screen asked for.
         */
        onFocus={(e) => { if (selects) select.onFocus(e); onFocus?.(e); }}
        onMouseDown={(e) => { if (selects) select.onMouseDown(e); onMouseDown?.(e); }}
        onMouseUp={(e) => { if (selects) select.onMouseUp(e); onMouseUp?.(e); }}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-20 w-full rounded-md border border-charcoal-300 bg-white px-3 py-2 text-sm text-charcoal-900',
        'placeholder:text-charcoal-400 focus-visible:border-yellow-500 focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Input, Textarea };
