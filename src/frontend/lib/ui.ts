// Shared class-string builders instead of a component library -- every
// button, card, and input across the app was a one-off copy-pasted
// Tailwind string with drifting radii/shadows/focus states. These keep
// plain <button>/<a>/<Link>/<input> elements (so routing, download
// attributes, etc. stay untouched) while giving them one consistent look.

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-slate-900 text-white shadow-sm hover:bg-slate-800 active:bg-slate-950",
  secondary: "border border-slate-300 bg-white text-slate-900 shadow-sm hover:bg-slate-50 active:bg-slate-100",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-base",
};

export function button(variant: ButtonVariant = "primary", size: ButtonSize = "md", className = ""): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`;
}

export function card(className = ""): string {
  return `rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`;
}

export function input(className = ""): string {
  return `w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 ${className}`;
}
