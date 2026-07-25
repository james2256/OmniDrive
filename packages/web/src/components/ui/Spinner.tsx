import { LoaderCircle } from 'lucide-react';

/** Single spinner variant — replaces the 3 duplicated spinner patterns. */
export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={`animate-spin ${className}`} aria-hidden />;
}
