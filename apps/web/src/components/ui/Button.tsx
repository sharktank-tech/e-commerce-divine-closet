"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

type Props = {
  href?: string;
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
  disabled?: boolean;
};

const variants = {
  primary: "bg-ink text-divine-50 hover:bg-ink-soft disabled:hover:bg-ink",
  secondary: "bg-divine-600 text-white hover:bg-divine-700",
  outline: "border border-ink/20 text-ink hover:border-ink hover:bg-ink/5",
  ghost: "text-ink hover:bg-ink/5",
  danger: "bg-red-600 text-white hover:bg-red-700",
};

const sizes = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-5 py-2.5 text-sm",
  lg: "px-7 py-3.5 text-base",
};

export function Button({
  href,
  children,
  onClick,
  type = "button",
  variant = "primary",
  size = "md",
  className,
  disabled,
}: Props) {
  const cls = cn(
    "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
    variants[variant],
    sizes[size],
    className
  );

  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}
