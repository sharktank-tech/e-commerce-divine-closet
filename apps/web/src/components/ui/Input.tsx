"use client";

import { cn } from "@/lib/utils";

type Props = {
  label: string;
  name?: string;
  type?: string;
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  error?: string;
  className?: string;
  textarea?: boolean;
  rows?: number;
  disabled?: boolean;
  autoComplete?: string;
  step?: string;
  min?: string;
  maxLength?: number;
};

export function Input({
  label,
  name,
  type = "text",
  value,
  onChange,
  placeholder,
  required,
  error,
  className,
  textarea,
  rows = 4,
  disabled,
  autoComplete,
  step,
  min,
  maxLength,
}: Props) {
  const base = cn(
    "w-full rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm text-ink placeholder:text-ink-mute/60 outline-none transition-colors focus:border-ink/50 disabled:bg-primary-50",
    error && "border-red-400",
    className
  );

  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-mute">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {textarea ? (
        <textarea
          name={name}
          rows={rows}
          value={value}
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange?.(e.target.value)}
          className={cn(base, "min-h-[96px] resize-y")}
        />
      ) : (
        <input
          name={name}
          type={type}
          value={value}
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete={autoComplete}
          step={step}
          min={min}
          maxLength={maxLength}
          onChange={(e) => onChange?.(e.target.value)}
          className={base}
        />
      )}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}
