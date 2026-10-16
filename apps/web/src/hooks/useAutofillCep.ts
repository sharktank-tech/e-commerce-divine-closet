"use client";

import { useState } from "react";
import { buscarEnderecoPorCep, type EnderecoCep } from "@/lib/cep";

type CamposEndereco = Record<keyof EnderecoCep, string>;

// Preenchimento automático de endereço a partir do CEP. Preenche só os
// campos vazios (nunca sobrescreve o que o usuário digitou); número e
// complemento não vêm no CEP e ficam vazios para digitação manual.
export function useAutofillCep(
  ler: () => CamposEndereco,
  aplicar: (patch: Partial<CamposEndereco>) => void
) {
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [erroCep, setErroCep] = useState("");
  const [cepOk, setCepOk] = useState(false);

  async function preencherCep(cep: string) {
    const digitos = cep.replace(/\D/g, "");
    if (digitos.length !== 8) return;
    setBuscandoCep(true);
    setErroCep("");
    setCepOk(false);
    try {
      const endereco = await buscarEnderecoPorCep(digitos);
      if (!endereco) {
        setErroCep("CEP não encontrado. Confira os dígitos ou preencha manualmente.");
        return;
      }
      const atual = ler();
      const patch: Partial<CamposEndereco> = {};
      (Object.keys(endereco) as Array<keyof EnderecoCep>).forEach((k) => {
        if (!atual[k]?.trim() && endereco[k]?.trim()) patch[k] = endereco[k];
      });
      if (Object.keys(patch).length > 0) {
        aplicar(patch);
        setCepOk(true);
      }
    } catch {
      setErroCep("Não foi possível buscar o CEP. Preencha o endereço manualmente.");
    } finally {
      setBuscandoCep(false);
    }
  }

  return { buscandoCep, erroCep, cepOk, preencherCep };
}
