import type { ReactNode } from 'react';

export function PageHeading({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
      {subtitle ? <p className="mt-1 opacity-70">{subtitle}</p> : null}
    </div>
  );
}
