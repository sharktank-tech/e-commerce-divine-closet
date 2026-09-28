import type { Metadata } from "next";
import { Catalogo } from "@/components/loja/Catalogo";

export const metadata: Metadata = {
  title: "Ofertas | Divine Closet",
  description:
    "Peças com desconto real na Divine Closet: confira as ofertas com entrega para todo o Brasil e troca em 30 dias.",
};

export const revalidate = 30;

type Search = { [key: string]: string | string[] | undefined };

function str(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

export default async function OfertasPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;

  return (
    <Catalogo
      basePath="/ofertas"
      title="Ofertas"
      emptyTitle="Sem ofertas no momento"
      emptyHint="Confira as novidades enquanto preparamos novas promoções."
      initial={{
        q: str(sp.q),
        categoria: str(sp.categoria),
        sort: str(sp.sort) || "desconto",
        page: Math.max(1, Number(str(sp.page) || 1)),
        precoMin: Number(str(sp.preco_min)) || 0,
        precoMax: Number(str(sp.preco_max)) || 0,
        soEstoque: str(sp.estoque) === "1",
        soOferta: true,
      }}
    />
  );
}
