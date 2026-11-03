import type { Metadata } from "next";
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-xl px-4 py-12">{children}</main>;
}
