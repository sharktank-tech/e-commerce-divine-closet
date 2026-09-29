import type { Prisma } from "@prisma/client";
import { estadoEstoque, type EstadoEstoque } from "./estoque";

// Allow-list pública de produtos: nenhum campo de custo, margem, lucro ou lote.
// Todas as leituras públicas (páginas, API pública, wishlist, carrinho exibido)
// devem usar estes selects/shapes. O admin continua com acesso completo.

export const publicSizeTableSelect = {
  id: true,
  name: true,
  unit: true,
  columns: true,
  rows: true,
  note: true,
} as const satisfies Prisma.SizeTableSelect;

export const publicCategorySelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  image: true,
  sizeTable: { select: publicSizeTableSelect },
} as const satisfies Prisma.CategorySelect;

export const publicVariationSelect = {
  id: true,
  size: true,
  color: true,
  stock: true,
  sku: true,
} as const satisfies Prisma.ProductVariationSelect;

export const publicProductCardSelect = {
  id: true,
  name: true,
  slug: true,
  price: true,
  comparePrice: true,
  discountPercent: true,
  images: true,
  featured: true,
  stock: true,
  category: { select: { id: true, name: true, slug: true } },
} as const satisfies Prisma.ProductSelect;

export const publicProductDetailSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  composicao: true,
  instrucoesLavagem: true,
  comprimento: true,
  modeloAltura: true,
  modeloVeste: true,
  caimento: true,
  ocasiao: true,
  metaTitle: true,
  metaDescription: true,
  price: true,
  comparePrice: true,
  discountPercent: true,
  sku: true,
  stock: true,
  isActive: true,
  featured: true,
  images: true,
  imageColors: true,
  imageAlts: true,
  sizes: true,
  colors: true,
  categoryId: true,
  tabelaMedidasId: true,
  relacionados: true,
  createdAt: true,
  updatedAt: true,
  category: { select: publicCategorySelect },
  variations: { select: publicVariationSelect },
  tabelaMedidas: { select: publicSizeTableSelect },
} as const satisfies Prisma.ProductSelect;

export type PublicPrice = string | number | { toString(): string } | null;

export type PublicCardProduct = {
  id: string;
  name: string;
  slug: string;
  price: PublicPrice;
  comparePrice?: PublicPrice;
  images: string[];
  featured?: boolean;
  category?: { name: string; slug: string };
  estadoEstoque: EstadoEstoque;
  stock?: number;
};

export type PublicVariation = {
  size: string;
  color: string | null;
  sku?: string | null;
  estado: EstadoEstoque;
  stock?: number;
};

function shapeStock(stock: number): { estado: EstadoEstoque; stock?: number } {
  const estado = estadoEstoque(stock);
  if (estado === "baixo") return { estado, stock: Math.max(0, Math.floor(stock)) };
  if (estado === "esgotado") return { estado, stock: 0 };
  return { estado };
}

export function toPublicCardProduct<
  P extends {
    id: string;
    name: string;
    slug: string;
    price: PublicPrice;
    comparePrice?: PublicPrice;
    images: string[];
    featured?: boolean;
    stock: number;
    category?: { name: string; slug: string } | null;
  },
>(p: P): PublicCardProduct {
  const { estado, stock } = shapeStock(p.stock);
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    price: p.price,
    comparePrice: p.comparePrice,
    images: p.images,
    featured: p.featured,
    category: p.category ? { name: p.category.name, slug: p.category.slug } : undefined,
    estadoEstoque: estado,
    ...(stock !== undefined ? { stock } : {}),
  };
}

export function toPublicVariations<
  V extends { size: string; color?: string | null; sku?: string | null; stock: number },
>(variations: V[]): PublicVariation[] {
  return variations.map((v) => {
    const { estado, stock } = shapeStock(v.stock);
    return {
      size: v.size,
      color: v.color ?? null,
      sku: v.sku ?? null,
      estado,
      ...(stock !== undefined ? { stock } : {}),
    };
  });
}
