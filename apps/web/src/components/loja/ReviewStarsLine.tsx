import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { summarizeReviews } from "@/lib/avaliacoes";
import { Avaliacoes } from "./Avaliacoes";

// Linha de estrelas junto ao título (SSR).
export async function ReviewStarsLine({ productId }: { productId: string }) {
  let summary = { total: 0, media: 0 };
  try {
    const rows = await prisma.review.findMany({
      where: { productId, status: "APROVADA", deletedAt: null },
      select: { rating: true, caimento: true, fotos: { select: { id: true } } },
      take: 500,
    });
    const s = summarizeReviews(
      rows.map((r) => ({ rating: r.rating, caimento: r.caimento, fotos: r.fotos }))
    );
    summary = { total: s.total, media: s.media };
  } catch {
    // silencioso: seção some se falhar
  }

  if (summary.total === 0) return null;

  return (
    <Link href="#avaliacoes" className="mt-2 inline-flex items-center gap-1.5 text-sm">
      <span className="font-bold text-ink">★ {summary.media.toFixed(1)}</span>
      <span className="text-ink-mute underline">({summary.total} avaliações)</span>
    </Link>
  );
}

// Resumo para a seção completa (reaproveita a mesma agregação).
export async function getReviewSummary(productId: string) {
  try {
    const rows = await prisma.review.findMany({
      where: { productId, status: "APROVADA", deletedAt: null },
      select: { rating: true, caimento: true, fotos: { select: { id: true } } },
      take: 500,
    });
    return summarizeReviews(
      rows.map((r) => ({ rating: r.rating, caimento: r.caimento, fotos: r.fotos }))
    );
  } catch {
    return summarizeReviews([]);
  }
}

// Seção completa (o componente cliente oculta-se sozinho quando vazio).
export async function AvaliacoesSection({
  productId,
  productSlug,
}: {
  productId: string;
  productSlug: string;
}) {
  const summary = await getReviewSummary(productId);
  return <Avaliacoes productId={productId} productSlug={productSlug} initialSummary={summary} />;
}
