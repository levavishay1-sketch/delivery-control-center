import { Zap } from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import { TONE_STYLES, type StatusTone } from "@/components/ui/StatusBadge";
import { WORK_ITEM_TYPE_TONES, type WorkItemTypeValue } from "@/lib/colors/workItemType";

export type IconBadgeTone = StatusTone | WorkItemTypeValue | "accent";

const SIZE_CLASSES = {
  sm: { badge: "h-7 w-7", icon: "h-3.5 w-3.5" },
  md: { badge: "h-9 w-9", icon: "h-[18px] w-[18px]" },
  lg: { badge: "h-12 w-12", icon: "h-6 w-6" },
} as const;

function resolveTone(tone: IconBadgeTone): { icon: ComponentType<{ className?: string }>; gradientVar: string; glowVar: string } {
  if (tone === "accent") return { icon: Zap, gradientVar: "--gradient-accent", glowVar: "--shadow-glow-accent" };
  if (tone in WORK_ITEM_TYPE_TONES) return WORK_ITEM_TYPE_TONES[tone as WorkItemTypeValue];
  const status = TONE_STYLES[tone as StatusTone];
  return { icon: status.icon, gradientVar: `--gradient-${tone}`, glowVar: `--shadow-glow-${tone}` };
}

/**
 * A circular, gradient-filled badge carrying a status tone, a work-item-type
 * tone, or the single accent color — one reusable pattern (design-system
 * spec's "shared components mirror structurally, with no locale-specific
 * variant" requirement extends to tone variants the same way). Every tone's
 * gradient/glow is a shade of ONE hue, never a second color.
 */
export function IconBadge({
  tone,
  icon,
  size = "md",
  glow = true,
  className = "",
}: {
  tone: IconBadgeTone;
  /** Overrides the tone's default icon. */
  icon?: ComponentType<{ className?: string }>;
  size?: keyof typeof SIZE_CLASSES;
  glow?: boolean;
  className?: string;
}) {
  const resolved = resolveTone(tone);
  const Icon = icon ?? resolved.icon;
  const { badge, icon: iconSize } = SIZE_CLASSES[size];

  const style: CSSProperties = {
    backgroundImage: `var(${resolved.gradientVar})`,
    boxShadow: glow ? `var(${resolved.glowVar})` : undefined,
  };

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full ${badge} ${className}`}
      style={style}
    >
      <Icon className={`${iconSize} text-white`} />
    </span>
  );
}
