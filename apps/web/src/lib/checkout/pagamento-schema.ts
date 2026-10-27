import { z } from "zod";

// A API aceita apenas token; nunca dados brutos do cartão.
export const pagamentoCheckoutSchema = z.object({
  method: z.enum(["card", "pix", "boleto"]).default("card"),
  cardToken: z.string().nullish(),
  installments: z.number().int().min(1).nullish(),
  paymentMethodId: z.string().nullish(),
}).strict();
