import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../lib/utils';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost';
type Size = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /**
   * Render the child element (e.g. an `<a>`) with button classes instead of a
   * `<button>`. Uses Radix Slot. When `asChild`, `loading` and `disabled` are
   * ignored (links have neither state).
   */
  asChild?: boolean;
}

const base = 'flex items-center gap-2 font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm';

const variants: Record<Variant, string> = {
  primary: 'text-white bg-primary hover:opacity-90',
  secondary: 'text-slate-700 bg-card border border-slate-400 hover:bg-slate-100',
  danger: 'text-white bg-red-600 hover:bg-red-700',
  // amber-700 (#B45309) = 5.02:1 contrast with white text — passes WCAG AA.
  // (amber-600 at 3.19:1 fails AA — do not downgrade.)
  warning: 'text-white bg-amber-700 hover:bg-amber-800',
  ghost: 'text-slate-600 hover:bg-slate-100 shadow-none',
};

const sizes: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'sm', loading, asChild = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        // links can't be disabled and don't have loading state — skip both when asChild
        disabled={asChild ? undefined : disabled || loading}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      >
        {/* Slot requires exactly ONE child — when asChild, pass only children
            (the <a> element). When not asChild, wrap spinner + children in a Fragment. */}
        {asChild ? children : (
          <>
            {loading && <Spinner size={14} />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
