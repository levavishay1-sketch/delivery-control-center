import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "destructive";
export type ButtonSize = "sm" | "md";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "text-white shadow-[0_6px_16px_-6px_color-mix(in_srgb,var(--color-accent)_55%,transparent)] hover:brightness-105",
  secondary: "border border-border-hairline bg-surface text-foreground hover:bg-surface-muted",
  destructive: "border border-status-critical/20 bg-status-critical-bg text-status-critical hover:brightness-95",
};

const VARIANT_STYLE: Partial<Record<ButtonVariant, React.CSSProperties>> = {
  primary: { backgroundImage: "var(--gradient-accent)" },
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "gap-1.5 rounded-md px-3 py-1.5 text-xs",
  md: "gap-2 rounded-md px-4 py-2 text-sm",
};

/**
 * Shared class string + inline style for the button visual treatment, so a
 * `Link` that needs to look like a button (no `asChild`/Slot primitive in
 * this codebase's dependency set) can apply the exact same styling as
 * `<Button>` instead of a hand-picked approximation.
 */
export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className = "") {
  return `inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`;
}

export function buttonStyle(variant: ButtonVariant = "secondary"): React.CSSProperties | undefined {
  return VARIANT_STYLE[variant];
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * The single shared button primitive (design-system spec's "Actions and
 * form fields use shared Button and form-field primitives" requirement) —
 * every mutation button in the product renders through this rather than
 * hand-picking its own color/border/radius.
 */
export function Button({ variant = "secondary", size = "md", className = "", type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses(variant, size, className)} style={buttonStyle(variant)} {...props} />;
}
