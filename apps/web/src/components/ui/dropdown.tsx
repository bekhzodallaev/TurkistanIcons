'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FiChevronDown } from 'react-icons/fi';

export type DropdownOption = {
  value: string;
  label: string;
  /** Optional leading visual (e.g. a flag image or an icon). */
  icon?: ReactNode;
};

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

// Accessible custom select. Unlike a native <select>, it can render rich
// option content (flags, icons) in both the trigger and the menu.
export function Dropdown({
  value,
  options,
  onChange,
  disabled,
  'aria-label': ariaLabel,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
      >
        {selected?.icon}
        <span>{selected?.label}</span>
        <FiChevronDown
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open ? (
        <ul
          role="listbox"
          className="absolute right-0 z-10 mt-1 min-w-full overflow-hidden rounded-md border border-black/10 bg-white shadow-lg dark:bg-neutral-900"
        >
          {options.map((option) => (
            <li key={option.value} role="option" aria-selected={option.value === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-black/5 dark:hover:bg-white/10 ${
                  option.value === value ? 'font-medium' : ''
                }`}
              >
                {option.icon}
                <span>{option.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
