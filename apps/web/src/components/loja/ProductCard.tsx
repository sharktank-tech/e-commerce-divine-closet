import Link from "next/link";
import { formatBRL, toNumber } from "@/lib/utils";
import { ProductSlideshow } from "./ProductSlideshow";

type Product = {
  id: string;
  name: string;
  slug: string;
  price: string | number | { toString(): string } | null;
  comparePrice?: string | number | { toString(): string } | null;
  images: string[];
  stock: number;
  featured?: boolean;
  category?: { name: string; slug: string };
};

export function ProductCard({ product }: { product: Product }) {
  const priceNum = Number(product.price);
  const compareNum = product.comparePrice != null ? Number(product.comparePrice) : null;
  const onSale = compareNum != null && compareNum > priceNum;

  return (
    <Link
      href={`/produtos/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-ink/10 bg-white transition-shadow hover:shadow-lg"
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-primary-100">
        <ProductSlideshow images={product.images} name={product.name} />

        {onSale && (
          <span className="absolute left-3 top-3 rounded-full bg-red-600 px-2.5 py-1 text-[10px] font-bold uppercase text-white">
            Oferta
          </span>
        )}
        {product.stock === 0 && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm font-semibold text-ink">
            Esgotado
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        {product.category && (
          <span className="text-[11px] uppercase tracking-wider text-primary-700">
            {product.category.name}
          </span>
        )}
        <h3 className="font-medium leading-snug text-ink group-hover:underline">
          {product.name}
        </h3>
        <div className="mt-auto flex items-baseline gap-2 pt-2">
          <span className="text-lg font-semibold text-ink">{formatBRL(priceNum)}</span>
          {onSale && compareNum != null && (
            <span className="text-sm text-ink-mute line-through">
              {formatBRL(compareNum)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
