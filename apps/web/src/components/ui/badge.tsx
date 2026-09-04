import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Badge colors carry meaning and are not decorative:
 * green = approved/complete, amber = needs a human, red = blocked, gray = neutral.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-charcoal-200 bg-charcoal-100 text-charcoal-700',
        outline: 'border-charcoal-300 bg-transparent text-charcoal-700',
        success: 'border-success-500/30 bg-success-50 text-success-700',
        warn: 'border-warn-600/30 bg-warn-50 text-warn-700',
        danger: 'border-danger-500/30 bg-danger-50 text-danger-700',
        info: 'border-info-600/30 bg-info-50 text-info-700',
        accent: 'border-yellow-600/30 bg-yellow-50 text-yellow-700',
        dark: 'border-charcoal-900 bg-charcoal-900 text-white',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
