/**
 * Parse a short duration string (e.g. "15m", "30d", "3600s") into seconds.
 * Accepts a bare number (already seconds). Used to translate JWT_*_TTL env
 * values into Redis TTLs and the `expiresIn` (seconds) returned to clients.
 */
export function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(ttl.trim());
  if (!match) {
    const asNumber = Number(ttl);
    if (Number.isFinite(asNumber) && asNumber > 0) return Math.floor(asNumber);
    throw new Error(`Invalid TTL value: "${ttl}" (expected e.g. "15m", "30d", "3600s")`);
  }
  const value = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multipliers: Record<typeof unit, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * multipliers[unit];
}
