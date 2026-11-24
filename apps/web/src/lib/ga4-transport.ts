import type { Ga4RefundEvent } from "@/lib/ga4-refund";

/**
 * Contrato de transporte fechado (hard-off).
 * Não importa nem chama fetch: nenhuma configuração pode enviar eventos.
 * O cliente GA4 real só poderá ser adicionado em PR separado, após
 * sincronização auditável do consentimento e validação em ambiente de teste.
 */
export type Ga4TransportResult =
  | { kind: "DISABLED" }
  | { kind: "ACCEPTED_UNVERIFIED" }
  | { kind: "REJECTED" }
  | { kind: "UNCERTAIN" };

export type Ga4TransportRequest = {
  clientId: string;
  event: Ga4RefundEvent;
};

export async function submitGa4Refund(
  _request: Ga4TransportRequest,
): Promise<Ga4TransportResult> {
  // Hard-off deliberado, inclusive quando segredos existirem no ambiente.
  return { kind: "DISABLED" };
}

/** Tradução explícita de semântica: 2xx NÃO prova processamento pelo GA4. */
export function interpretGa4HttpResult(
  httpStatus: number | null,
): Exclude<Ga4TransportResult, { kind: "DISABLED" }> {
  if (httpStatus === null) return { kind: "UNCERTAIN" };
  if (httpStatus >= 200 && httpStatus < 300) return { kind: "ACCEPTED_UNVERIFIED" };
  return { kind: "REJECTED" };
}
