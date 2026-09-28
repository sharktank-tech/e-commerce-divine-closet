import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { Catalogo } from "@/components/loja/Catalogo";

export const metadata: Metadata = {
  title: "Coleção",
  description: "Todos os produtos da Divine Closet",
};

export const revalidate = 30;

type Search = { [key: string]: string | string[] | undefined };

function str(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

export default async function ProdutosPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const keys = Object.keys(sp);

  // URL antiga de categoria filtrada -> 301 para a rota amigável /categoria/<slug>.
  // Só quando `categoria` é o único parâmetro e um slug simples (sem vírgula).
  const rawCat = str(sp.categoria);
  if (keys.length === 1 && keys[0] === "categoria" && rawCat && !rawCat.includes(",")) {
    permanentRedirect(`/categoria/${rawCat}`);
  }

  return (
    <Catalogo
      basePath="/produtos"
      initial={{
        q: str(sp.q),
        categoria: rawCat,
        sort: str(sp.sort) || "recent",
        page: Math.max(1, Number(str(sp.page) || 1)),
        precoMin: Number(str(sp.preco_min)) || 0,
        precoMax: Number(str(sp.preco_max)) || 0,
        soEstoque: str(sp.estoque) === "1",
      }}
    />
  );
}
