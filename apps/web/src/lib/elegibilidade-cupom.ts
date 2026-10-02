// Elegibilidade de cupom — mesma regra nas duas rotas que validam
// (/api/cupom e /api/pedidos). Cada rota mantém sua própria mensagem e
// status de erro; daqui sai só o motivo, puro e testável.
// Uso único = maxUses 1 com usedCount 1 (não há cupom de boas-vindas
// dedicado no sistema; só o e-mail de boas-vindas em lib/email.ts).

export type MotivoInelegivel =
  | "inexistente"
  | "inativo" // active=false ou soft-deletado
  | "nao_iniciado" // startsAt no futuro
  | "expirado" // endsAt no passado
  | "esgotado" // maxUses atingido (inclui uso único já utilizado)
  | "minimo"; // subtotal abaixo do mínimo

export type ResultadoElegibilidade =
  | { elegivel: true }
  | { elegivel: false; motivo: MotivoInelegivel };

export type CupomElegibilidade = {
  active: boolean;
  deletedAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  maxUses: number | null;
  usedCount: number;
  minSubtotal: unknown;
} | null;

export function elegibilidadeCupom(
  cupom: CupomElegibilidade,
  agora: Date,
  subtotalReais: number
): ResultadoElegibilidade {
  if (!cupom) return { elegivel: false, motivo: "inexistente" };
  if (!cupom.active || cupom.deletedAt) {
    return { elegivel: false, motivo: "inativo" };
  }
  if (cupom.startsAt && cupom.startsAt > agora) {
    return { elegivel: false, motivo: "nao_iniciado" };
  }
  if (cupom.endsAt && cupom.endsAt < agora) {
    return { elegivel: false, motivo: "expirado" };
  }
  if (cupom.maxUses != null && cupom.usedCount >= cupom.maxUses) {
    return { elegivel: false, motivo: "esgotado" };
  }
  if (
    cupom.minSubtotal != null &&
    subtotalReais < Number(String(cupom.minSubtotal))
  ) {
    return { elegivel: false, motivo: "minimo" };
  }
  return { elegivel: true };
}
