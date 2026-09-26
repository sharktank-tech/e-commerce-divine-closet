import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="font-display text-7xl font-bold text-primary-300">404</p>
      <h1 className="mt-4 font-display text-2xl font-bold text-ink">Página não encontrada</h1>
      <p className="mt-2 text-sm text-ink-mute">
        O endereço acessado não existe ou foi movido.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-full bg-ink px-6 py-3 text-sm font-semibold text-primary-50"
      >
        Voltar para a loja
      </Link>
    </div>
  );
}
