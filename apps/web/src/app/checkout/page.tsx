"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatBRL } from "@/lib/utils";
import { shipping as shippingConfig } from "@/config/defaults";

type CartData = {
  items: Array<{
    id: string;
    quantity: number;
    lineTotal: number;
    product: { name: string; price: string | number };
  }>;
  subtotal: number;
};

type MeUser = { email: string; name: string } | null;

const STEPS = ["Identificação", "Endereço", "Frete", "Pagamento"];

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [me, setMe] = useState<MeUser | undefined>(undefined);

  const [guest, setGuest] = useState({ email: "", name: "" });

  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{
    code: string;
    discount: number;
    freeShipping: boolean;
  } | null>(null);
  const [couponError, setCouponError] = useState("");

  const [method, setMethod] = useState<"card" | "pix" | "boleto">("card");
  const [frete, setFrete] = useState<{ price: number; eta: string } | null>(null);
  const [freteLoading, setFreteLoading] = useState(false);
  const [freteError, setFreteError] = useState("");

  const [form, setForm] = useState({
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
    zipCode: "",
    cardName: "",
    cardNumber: "",
    cardExpiry: "",
    cardCvv: "",
    notes: "",
  });

  useEffect(() => {
    fetch("/api/carrinho")
      .then((r) => r.json())
      .then((d) => {
        setCart(d);
        if (!d.items?.length) router.replace("/carrinho");
      })
      .finally(() => setLoading(false));

    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d) => setMe(d.user))
      .catch(() => setMe(null));
  }, [router]);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const subtotal = cart?.subtotal || 0;
  const couponFreeShipping = !!coupon?.freeShipping;
  const shipping =
    couponFreeShipping || subtotal >= shippingConfig.freeFrom
      ? 0
      : frete?.price ?? shippingConfig.fixed;
  const discount = coupon?.discount || 0;
  const total = Math.max(0, subtotal - discount) + shipping;

  function stepValid(n: number): boolean {
    if (n === 0) return !!me || (guest.email.includes("@") && guest.name.trim().length >= 2);
    if (n === 1)
      return (
        form.street.length >= 3 &&
        form.number.length >= 1 &&
        form.neighborhood.length >= 2 &&
        form.city.length >= 2 &&
        form.state.length === 2 &&
        form.zipCode.replace(/\D/g, "").length === 8
      );
    if (n === 2) return shipping === 0 || frete !== null;
    return true;
  }

  async function calcFrete() {
    setFreteError("");
    setFreteLoading(true);
    try {
      const cep = (form.zipCode || "").replace(/\D/g, "");
      const res = await fetch(`/api/frete?cep=${cep}&subtotal=${subtotal}`);
      const data = await res.json();
      if (!res.ok) {
        setFrete(null);
        setFreteError(data.error || "Erro ao calcular frete");
        return;
      }
      const d = data.delivery[0];
      setFrete({ price: d.price, eta: d.eta });
    } catch {
      setFreteError("Erro de conexão");
    } finally {
      setFreteLoading(false);
    }
  }

  async function applyCoupon() {
    setCouponError("");
    try {
      const res = await fetch("/api/cupom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponInput, subtotal }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCoupon(null);
        setCouponError(data.error || "Cupom inválido");
        return;
      }
      setCoupon({
        code: data.coupon.code,
        discount: data.discount,
        freeShipping: data.freeShipping,
      });
    } catch {
      setCouponError("Erro ao validar cupom");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const res = await fetch("/api/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: {
            street: form.street,
            number: form.number,
            complement: form.complement || null,
            neighborhood: form.neighborhood,
            city: form.city,
            state: form.state,
            zipCode: form.zipCode,
          },
          payment: {
            method,
            ...(method === "card"
              ? { card: { number: form.cardNumber, name: form.cardName } }
              : {}),
          },
          couponCode: coupon?.code || null,
          notes: form.notes || null,
          ...(me ? {} : { guest: { email: guest.email, name: guest.name || undefined } }),
        }),
      });

      const data = await res.json();

      if (res.ok && data.ok) {
        setStep(3);
        router.push(`/sucesso?pedido=${data.order.number}`);
        return;
      }

      if (res.status === 402 && data.order) {
        setError(data.error || "Pagamento recusado. Pedido cancelado.");
        return;
      }

      setError(data.error || "Erro ao finalizar pedido");
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center text-ink-mute">
        Carregando checkout...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold text-ink">Checkout</h1>

      <ol className="mt-6 flex flex-wrap gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 font-semibold ${
              i === step
                ? "bg-ink text-primary-50"
                : i < step
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-white text-ink-mute border border-ink/10"
            }`}
          >
            <span>{i < step ? "✓" : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <form onSubmit={submit} className="mt-8 grid gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {step === 0 && (
            <section className="rounded-xl border border-ink/10 bg-white p-6">
              <h2 className="font-display text-lg font-bold text-ink">Identificação</h2>
              {me ? (
                <div className="mt-4 flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3 text-sm">
                  <span>
                    Comprando como <strong>{me.name}</strong> ({me.email})
                  </span>
                  <Link href="/login" className="text-xs font-semibold underline">
                    Trocar de conta
                  </Link>
                </div>
              ) : (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Seu nome"
                    required
                    value={guest.name}
                    onChange={(v) => setGuest((g) => ({ ...g, name: v }))}
                  />
                  <Input
                    label="E-mail"
                    type="email"
                    required
                    value={guest.email}
                    onChange={(v) => setGuest((g) => ({ ...g, email: v }))}
                  />
                  <p className="sm:col-span-2 text-xs text-ink-mute">
                    Compre como convidado ou{" "}
                    <Link href="/login?next=/checkout" className="font-semibold underline">
                      entre na sua conta
                    </Link>{" "}
                    para acompanhar pedidos.
                  </p>
                </div>
              )}
            </section>
          )}

          {step === 1 && (
            <section className="rounded-xl border border-ink/10 bg-white p-6">
              <h2 className="font-display text-lg font-bold text-ink">Endereço de entrega</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-6">
                <div className="sm:col-span-4">
                  <Input label="Rua" required value={form.street} onChange={(v) => set("street", v)} />
                </div>
                <div className="sm:col-span-2">
                  <Input label="Número" required value={form.number} onChange={(v) => set("number", v)} />
                </div>
                <div className="sm:col-span-3">
                  <Input label="Complemento" value={form.complement} onChange={(v) => set("complement", v)} />
                </div>
                <div className="sm:col-span-3">
                  <Input label="Bairro" required value={form.neighborhood} onChange={(v) => set("neighborhood", v)} />
                </div>
                <div className="sm:col-span-3">
                  <Input label="Cidade" required value={form.city} onChange={(v) => set("city", v)} />
                </div>
                <div className="sm:col-span-1">
                  <Input label="UF" required maxLength={2} value={form.state} onChange={(v) => set("state", v.toUpperCase())} />
                </div>
                <div className="sm:col-span-2">
                  <Input label="CEP" required placeholder="00000-000" value={form.zipCode} onChange={(v) => set("zipCode", v)} />
                </div>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="rounded-xl border border-ink/10 bg-white p-6">
              <h2 className="font-display text-lg font-bold text-ink">Frete</h2>
              <p className="mt-1 text-xs text-ink-mute">
                Prazo e valor estimados para o CEP do endereço informado.
              </p>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div className="w-44">
                  <Input
                    label="CEP"
                    placeholder="00000-000"
                    value={form.zipCode}
                    onChange={(v) => set("zipCode", v)}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={calcFrete}
                  disabled={freteLoading || form.zipCode.replace(/\D/g, "").length !== 8}
                >
                  {freteLoading ? "Calculando..." : "Calcular frete"}
                </Button>
              </div>
              {freteError && <p className="mt-2 text-xs text-red-600">{freteError}</p>}
              {frete && (
                <div className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  Entrega padrão · {frete.eta} ·{" "}
                  {frete.price === 0 || shipping === 0 ? "Grátis" : formatBRL(frete.price)}
                </div>
              )}
              {shipping === 0 && (
                <p className="mt-3 text-xs text-ink-mute">
                  Este pedido tem frete grátis {couponFreeShipping ? "(cupom)" : "acima de " + formatBRL(shippingConfig.freeFrom)}.
                </p>
              )}
            </section>
          )}

          {step === 3 && (
            <>
              <section className="rounded-xl border border-ink/10 bg-white p-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-lg font-bold text-ink">Pagamento</h2>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold uppercase text-amber-800">
                    Sandbox / Mock
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  {(
                    [
                      ["card", "Cartão"],
                      ["pix", "Pix"],
                      ["boleto", "Boleto"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setMethod(id)}
                      className={`rounded-lg border px-3 py-2.5 text-sm font-semibold ${
                        method === id
                          ? "border-ink bg-ink text-primary-50"
                          : "border-ink/15 bg-white text-ink-soft"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {method === "card" && (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <p className="sm:col-span-2 text-xs text-ink-mute">
                      Use um cartão iniciado em <strong>4000</strong> para simular recusa.
                      Qualquer outro número aprova.
                    </p>
                    <div className="sm:col-span-2">
                      <Input label="Nome no cartão" required value={form.cardName} onChange={(v) => set("cardName", v)} />
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        label="Número do cartão"
                        required
                        placeholder="4242 4242 4242 4242"
                        value={form.cardNumber}
                        onChange={(v) => set("cardNumber", v)}
                      />
                    </div>
                    <Input label="Validade" required placeholder="MM/AA" value={form.cardExpiry} onChange={(v) => set("cardExpiry", v)} />
                    <Input label="CVV" required placeholder="123" value={form.cardCvv} onChange={(v) => set("cardCvv", v)} />
                  </div>
                )}

                {method === "pix" && (
                  <div className="mt-4 rounded-lg bg-primary-50 p-4 text-sm text-ink-soft">
                    O QR Code Pix será gerado após a confirmação (sandbox: aprovação
                    automática, sem transação real).
                  </div>
                )}

                {method === "boleto" && (
                  <div className="mt-4 rounded-lg bg-primary-50 p-4 text-sm text-ink-soft">
                    O boleto será enviado por e-mail após a confirmação (sandbox:
                    aprovação automática, sem emissão real).
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-ink/10 bg-white p-6">
                <h2 className="font-display text-lg font-bold text-ink">Observações</h2>
                <div className="mt-3">
                  <Input
                    label="Alguma instrução para a entrega?"
                    textarea
                    value={form.notes}
                    onChange={(v) => set("notes", v)}
                  />
                </div>
              </section>
            </>
          )}

          <div className="flex items-center justify-between">
            {step > 0 ? (
              <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)}>
                Voltar
              </Button>
            ) : (
              <span />
            )}
            {step < STEPS.length - 1 && (
              <Button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                disabled={!stepValid(step)}
              >
                Continuar
              </Button>
            )}
          </div>
        </div>

        <aside className="h-fit rounded-xl border border-ink/10 bg-white p-6">
          <h2 className="font-display text-lg font-bold text-ink">Seu pedido</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {(cart?.items || []).map((i) => (
              <li key={i.id} className="flex justify-between gap-3">
                <span className="text-ink-soft">
                  {i.quantity}× {i.product.name}
                </span>
                <span className="font-medium">{formatBRL(i.lineTotal)}</span>
              </li>
            ))}
          </ul>

          <dl className="mt-4 space-y-2 border-t border-ink/10 pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-mute">Subtotal</dt>
              <dd>{formatBRL(subtotal)}</dd>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-emerald-700">
                <dt>Cupom {coupon?.code}</dt>
                <dd>-{formatBRL(discount)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-mute">Frete</dt>
              <dd>{shipping === 0 ? "Grátis" : formatBRL(shipping)}</dd>
            </div>
            <div className="flex justify-between border-t border-ink/10 pt-3 text-base font-bold">
              <dt>Total</dt>
              <dd>{formatBRL(total)}</dd>
            </div>
          </dl>

          {!coupon ? (
            <div className="mt-4 space-y-2">
              <div className="flex gap-2">
                <input
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  placeholder="Cupom"
                  className="min-w-0 flex-1 rounded-lg border border-ink/15 px-3 py-2 text-sm uppercase"
                />
                <Button type="button" variant="outline" size="sm" onClick={applyCoupon}>
                  Aplicar
                </Button>
              </div>
              {couponError && <p className="text-xs text-red-600">{couponError}</p>}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setCoupon(null);
                setCouponInput("");
              }}
              className="mt-4 text-xs text-ink-mute underline"
            >
              Remover cupom {coupon.code}
            </button>
          )}

          {error && (
            <p className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>
          )}

          {step === STEPS.length - 1 && (
            <Button type="submit" className="mt-5 w-full" size="lg" disabled={submitting}>
              {submitting ? "Processando..." : `Pagar ${formatBRL(total)}`}
            </Button>
          )}
        </aside>
      </form>
    </div>
  );
}
