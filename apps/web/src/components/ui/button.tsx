import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Construction yellow is the single primary action color.
        default: 'bg-yellow-500 text-charcoal-900 hover:bg-yellow-400 active:bg-yellow-600 shadow-sm',
        dark: 'bg-charcoal-900 text-white hover:bg-charcoal-800 active:bg-charcoal-950 shadow-sm',
        outline: 'border border-charcoal-300 bg-white text-charcoal-900 hover:bg-charcoal-100',
        ghost: 'text-charcoal-700 hover:bg-charcoal-100 hover:text-charcoal-900',
        subtle: 'bg-charcoal-100 text-charcoal-900 hover:bg-charcoal-200',
        destructive: 'bg-danger-600 text-white hover:bg-danger-700 shadow-sm',
        success: 'bg-success-700 text-white hover:bg-success-600 shadow-sm',
        link: 'text-charcoal-900 underline-offset-4 hover:underline hover:text-yellow-700',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        default: 'h-10 px-4',
        lg: 'h-12 px-6 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
