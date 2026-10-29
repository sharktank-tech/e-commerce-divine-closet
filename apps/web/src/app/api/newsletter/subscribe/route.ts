import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requestSubscription,
  newsletterLimit,
  GENERIC_NEWSLETTER,
} from "@/lib/marketing/newsletter";
import { CONSENT_VERSION } from "@/lib/marketing/tokens";
const schema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    consent: z.literal(true),
    consentVersion: z.literal(CONSENT_VERSION),
    source: z.enum(["footer", "newsletter"]).default("newsletter"),
    reactivate: z.boolean().default(false),
  })
  .strict();
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "Informe um e-mail válido e aceite o recebimento de novidades.",
      },
      { status: 400 },
    );
  try {
    if (await newsletterLimit(req, parsed.data.email))
      await requestSubscription(
        parsed.data.email,
        parsed.data.source,
        parsed.data.reactivate,
      );
    return NextResponse.json(GENERIC_NEWSLETTER, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Inscrição temporariamente indisponível." },
      { status: 503 },
    );
  }
}
