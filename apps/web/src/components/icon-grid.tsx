import type { Icon } from '@/lib/types';
import { IconCard } from './icon-card';

export function IconGrid({ icons }: { icons: Icon[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-5 lg:grid-cols-6">
      {icons.map((icon) => (
        <IconCard key={icon.id} icon={icon} />
      ))}
    </div>
  );
}
