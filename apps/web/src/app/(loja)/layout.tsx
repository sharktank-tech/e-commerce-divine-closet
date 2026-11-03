import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CartProvider } from "@/components/loja/CartProvider";
import { ConsentBanner } from "@/components/loja/ConsentBanner";
import { WhatsAppButton } from "@/components/loja/WhatsAppButton";

export default function LojaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <CartProvider>
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        <ConsentBanner />
        <WhatsAppButton />
      </CartProvider>
    </div>
  );
}
