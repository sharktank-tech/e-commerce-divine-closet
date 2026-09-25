import type { Metadata } from "next";
import { institutional } from "@/config/defaults";

export const metadata: Metadata = {
  title: "Perguntas frequentes",
};

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-primary">
        Perguntas frequentes
      </h1>
      <div className="mt-8 space-y-4">
        {institutional.faq.map((item) => (
          <details
            key={item.q}
            className="group rounded-xl border border-ink/10 bg-white p-5"
          >
            <summary className="cursor-pointer font-medium text-ink marker:hidden">
              {item.q}
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-ink-mute">{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
