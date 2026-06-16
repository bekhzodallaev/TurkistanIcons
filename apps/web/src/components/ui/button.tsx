import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md';

const base =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50';

const variants: Record<Variant, string> = {
  primary: 'bg-emerald-600 text-white hover:bg-emerald-700',
  secondary: 'border border-black/15 bg-transparent hover:bg-black/5',
  ghost: 'bg-transparent hover:bg-black/5',
};

const sizes: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-sm',
  md: 'px-4 py-2 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}
