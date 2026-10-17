import { describe, expect, it } from "vitest";
import {
  TRANSPORTADORAS,
  linkRastreio,
  mensagemSemRastreio,
  rotuloTransportadora,
  siteRastreioTransportadora,
  validarUrlRastreio,
} from "@/lib/rastreio";

describe("validarUrlRastreio", () => {
  it("aceita HTTPS em host da allowlist", () => {
    expect(validarUrlRastreio("https://rastreamento.correios.com.br/app/index.php?objetos=AB123")).toMatch(
      /^https:\/\/rastreamento\.correios\.com\.br\//
    );
    expect(validarUrlRastreio("https://www.melhorenvio.com.br/tracking/abc")).toBeTruthy();
  });

  it("aceita subdomínio de host permitido", () => {
    expect(validarUrlRastreio("https://api.loggi.com/rastreio/x")).toBeTruthy();
  });

  it("recusa HTTP (não HTTPS)", () => {
    expect(validarUrlRastreio("http://www.jadlog.com.br/track")).toBeNull();
  });

  it("recusa host fora da allowlist", () => {
    expect(validarUrlRastreio("https://evil.example.com/rastreio")).toBeNull();
    expect(validarUrlRastreio("https://correios.com.br.evil.com/x")).toBeNull();
  });

  it("recusa credenciais na URL e protocolos perigosos", () => {
    expect(validarUrlRastreio("https://user:pass@www.loggi.com/x")).toBeNull();
    expect(validarUrlRastreio("javascript:alert(1)")).toBeNull();
    expect(validarUrlRastreio("data:text/html,x")).toBeNull();
  });

  it("recusa malformada, vazia ou gigante", () => {
    expect(validarUrlRastreio("não é url")).toBeNull();
    expect(validarUrlRastreio("")).toBeNull();
    expect(validarUrlRastreio(null)).toBeNull();
    expect(validarUrlRastreio(`https://www.azul.com.br/${"a".repeat(3000)}`)).toBeNull();
  });
});

describe("transportadora conhecida", () => {
  it("rotulo: id conhecido vira nome; texto livre vira texto; vazio → null", () => {
    expect(rotuloTransportadora("correios")).toBe("Correios");
    expect(rotuloTransportadora("Transportadora X")).toBe("Transportadora X");
    expect(rotuloTransportadora(null)).toBeNull();
    expect(rotuloTransportadora("   ")).toBeNull();
  });

  it("site: só para transportadora reconhecida (nenhum link inventado)", () => {
    for (const t of TRANSPORTADORAS) {
      expect(siteRastreioTransportadora(t.id)).toMatch(/^https:\/\//);
    }
    expect(siteRastreioTransportadora("transportadora-desconhecida")).toBeNull();
    expect(siteRastreioTransportadora(null)).toBeNull();
  });
});

describe("linkRastreio (prioridades)", () => {
  it("URL validada do admin vence o site oficial", () => {
    const link = linkRastreio({
      trackingCarrier: "correios",
      trackingUrl: "https://www.jadlog.com.br/track?c=1",
    });
    expect(link).toBe("https://www.jadlog.com.br/track?c=1");
  });

  it("URL inválida do admin → cai para o site da transportadora conhecida", () => {
    expect(
      linkRastreio({ trackingCarrier: "correios", trackingUrl: "http://fora.com/x" })
    ).toBe(siteRastreioTransportadora("correios"));
  });

  it("sem transportadora e sem URL válida → null (sem botão)", () => {
    expect(linkRastreio({})).toBeNull();
    expect(linkRastreio({ trackingUrl: "https://evil.com/x" })).toBeNull();
    expect(linkRastreio({ trackingCarrier: "desconhecida" })).toBeNull();
  });
});

describe("mensagemSemRastreio (nunca afirma envio)", () => {
  it("SHIPPED/DELIVERED sem código: não diz que foi enviado", () => {
    expect(mensagemSemRastreio("SHIPPED")).toMatch(/ainda não informado/i);
    expect(mensagemSemRastreio("SHIPPED")).not.toMatch(/enviad/i);
  });

  it("estágios iniciais: postagem é futura", () => {
    for (const s of ["PENDING", "PAID", "PROCESSING"]) {
      expect(mensagemSemRastreio(s)).toMatch(/após a postagem/i);
      expect(mensagemSemRastreio(s)).not.toMatch(/já (foi )?enviad/i);
    }
  });

  it("cancelado/estornado: sem rastreamento", () => {
    expect(mensagemSemRastreio("CANCELLED")).toMatch(/cancelado/i);
    expect(mensagemSemRastreio("REFUNDED")).toMatch(/estornado/i);
  });
});
