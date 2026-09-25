import type { Metadata } from "next";
import { institutional } from "@/config/defaults";

export const metadata: Metadata = {
  title: "Privacidade",
};

export default function PrivacidadePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-primary">
        Política de privacidade
      </h1>
      <p className="mt-6 whitespace-pre-line leading-relaxed text-ink-soft">
        {institutional.privacy}
      </p>
    </div>
  );
}
