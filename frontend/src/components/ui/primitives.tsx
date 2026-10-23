import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ComponentProps,
  TextareaHTMLAttributes,
} from "react";

/**
 * Locally owned, shadcn/ui-style primitives.
 * data-slot and variant attributes provide one consistent design system
 * without putting styling or third-party behavior in the business pages.
 */
type Variant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "default" | "sm" | "lg" | "icon";

export function Button({
  className = "",
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button data-slot="button" data-variant={variant} data-size={size} className={`ui-button ${className}`.trim()} type={type} {...props} />;
}

export function Card({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <article data-slot="card" className={`ui-card ${className}`.trim()} {...props} />;
}

export function CardHeader({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-header" className={`ui-card-header ${className}`.trim()} {...props} />;
}

export function CardContent({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-content" className={`ui-card-content ${className}`.trim()} {...props} />;
}

export function Badge({ className = "", variant = "secondary", ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return <span data-slot="badge" data-variant={variant} className={`ui-badge ${className}`.trim()} {...props} />;
}

export function Input({ className = "", type = "text", ...props }: ComponentProps<"input">) {
  return <input data-slot="input" className={`ui-input ${className}`.trim()} type={type} {...props} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea data-slot="textarea" className={`ui-textarea ${className}`.trim()} {...props} />;
}
