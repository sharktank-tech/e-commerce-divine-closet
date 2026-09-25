import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-ink/10 bg-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="font-display text-xl font-bold text-ink">
            Divine<span className="text-divine-600">Closet</span>
          </p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-mute">
            Moda que eleva o seu dia a dia. Peças selecionadas com cuidado,
            entrega para todo o Brasil e troca fácil em 30 dias.
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-soft">Loja</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-mute">
            <li><Link href="/produtos" className="hover:text-ink">Todos os produtos</Link></li>
            <li><Link href="/produtos?sort=price_asc" className="hover:text-ink">Ofertas</Link></li>
            <li><Link href="/carrinho" className="hover:text-ink">Carrinho</Link></li>
          </ul>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-soft">Ajuda</p>
          <ul className="mt-3 space-y-2 text-sm text-ink-mute">
            <li><Link href="/institucional" className="hover:text-ink">Sobre nós</Link></li>
            <li><Link href="/trocas" className="hover:text-ink">Trocas e devoluções</Link></li>
            <li><Link href="/faq" className="hover:text-ink">Perguntas frequentes</Link></li>
            <li><Link href="/privacidade" className="hover:text-ink">Privacidade</Link></li>
            <li><Link href="/contato" className="hover:text-ink">Contato</Link></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-ink/10 py-5 text-center text-xs text-ink-mute">
        © {new Date().getFullYear()} Divine Closet — Todos os direitos reservados.
        Pagamento em sandbox (modo dev).
      </div>
    </footer>
  );
}
