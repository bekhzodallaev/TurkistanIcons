'use client';

import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { FiMoon, FiSun } from 'react-icons/fi';
import { Button } from '@/components/ui/button';

// Toggles between light and dark. Resolves "system" to its actual value so the
// first click flips to the opposite of what the user currently sees.
export function ThemeToggle() {
  const t = useTranslations('Nav');
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid a hydration mismatch: the resolved theme is only known on the client.
  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={t('toggleTheme')}
      title={t('toggleTheme')}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {mounted ? (
        isDark ? (
          <FiSun aria-hidden />
        ) : (
          <FiMoon aria-hidden />
        )
      ) : (
        // Placeholder keeps layout stable before the theme is known.
        <span className="block h-4 w-4" />
      )}
    </Button>
  );
}
