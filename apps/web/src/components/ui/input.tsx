import type { InputHTMLAttributes } from 'react';

const base =
  'w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm placeholder:opacity-50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className = '', type = 'text', ...props }: InputProps) {
  return <input type={type} className={`${base} ${className}`} {...props} />;
}
