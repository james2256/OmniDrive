import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Styled text input — single source of truth for input styling.
 * Replaces ~15 duplicated input class strings across modals.
 */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'w-full px-3 py-1.5 bg-card border border-slate-400 rounded-xl text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary transition-shadow',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';
