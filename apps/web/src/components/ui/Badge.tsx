import { cn } from "@/lib/utils";

const tones: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  PAID: "bg-emerald-100 text-emerald-800",
  PROCESSING: "bg-blue-100 text-blue-800",
  SHIPPED: "bg-indigo-100 text-indigo-800",
  DELIVERED: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-700",
  REFUNDED: "bg-gray-200 text-gray-700",
  FAILED: "bg-red-100 text-red-700",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  HIDDEN: "bg-gray-200 text-gray-700",
};

export function Badge({
  children,
  status,
  className,
}: {
  children: React.ReactNode;
  status?: string;
  className?: string;
}) {
  const tone = status ? tones[status] || "bg-divine-100 text-divine-800" : "bg-divine-100 text-divine-800";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        tone,
        className
      )}
    >
      {children}
    </span>
  );
}
