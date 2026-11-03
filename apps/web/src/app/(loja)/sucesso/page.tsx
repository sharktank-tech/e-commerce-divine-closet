import { PurchaseReceipt } from "@/components/loja/PurchaseReceipt";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Confirmação do pedido", robots: { index: false, follow: false } };

export default async function SucessoPage({
  searchParams,
}: {
  searchParams: Promise<{ pedido?: string }>;
}) {
  const { pedido } = await searchParams;
  return <PurchaseReceipt pedido={pedido} />;
}
