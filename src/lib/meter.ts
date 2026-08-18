/**
 * Percentage-to-arc math for `Meter` (`src/components/ui/Meter.tsx`),
 * extracted so it can be unit tested without rendering the SVG.
 */
export function computeMeterArc(value: number, radius: number): { circumference: number; offset: number } {
  const clamped = Math.max(0, Math.min(100, value));
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  return { circumference, offset };
}
