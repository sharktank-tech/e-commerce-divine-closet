/** A confirmação exige estado financeiro explícito; respostas incompletas não confirmam. */
export function classificarPagamento(dados: { pendente?: boolean; order?: { paymentStatus?: string; status?: string } }): "pago" | "pendente" | "encerrado" {
  if (["FAILED", "REFUNDED"].includes(dados.order?.paymentStatus ?? "") || dados.order?.status === "CANCELLED") return "encerrado";
  if (dados.pendente || dados.order?.paymentStatus !== "PAID") return "pendente";
  return "pago";
}
