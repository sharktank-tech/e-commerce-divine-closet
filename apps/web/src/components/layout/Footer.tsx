import Link from "next/link";

export function Footer() {
  return (
    <footer className="bg-primary-950 text-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="flex items-center gap-2.5 font-display text-xl font-bold text-white">
            <img
              src="/logo.jpeg"
              alt="Divine Closet"
              className="h-9 w-9 rounded-full object-cover ring-2 ring-white/20"
            />
            <span>
              Divine<span className="text-accent-300">Closet</span>
            </span>
          </p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-primary-200">
            Moda que eleva o seu dia a dia. Peças selecionadas com cuidado,
            entrega para todo o Brasil e troca fácil em 30 dias.
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-300">Loja</p>
          <ul className="mt-3 space-y-2 text-sm text-primary-200">
            <li><Link href="/produtos" className="hover:text-white">Todos os produtos</Link></li>
            <li><Link href="/produtos?sort=price_asc" className="hover:text-white">Ofertas</Link></li>
            <li><Link href="/carrinho" className="hover:text-white">Carrinho</Link></li>
          </ul>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-300">Ajuda</p>
          <ul className="mt-3 space-y-2 text-sm text-primary-200">
            <li><Link href="/institucional" className="hover:text-white">Sobre nós</Link></li>
            <li><Link href="/trocas" className="hover:text-white">Trocas e devoluções</Link></li>
            <li><Link href="/faq" className="hover:text-white">Perguntas frequentes</Link></li>
            <li><Link href="/privacidade" className="hover:text-white">Privacidade</Link></li>
            <li><Link href="/contato" className="hover:text-white">Contato</Link></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10 py-5 text-center text-xs text-primary-300">
        © {new Date().getFullYear()} Divine Closet — Todos os direitos reservados.
        Pagamento em sandbox (modo dev).
      </div>
    </footer>
  );
}
