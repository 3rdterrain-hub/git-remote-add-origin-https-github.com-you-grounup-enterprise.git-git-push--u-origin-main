import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
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
      {...props}
    />
  ),
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
