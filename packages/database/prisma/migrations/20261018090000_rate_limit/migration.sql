-- Rate-limit por chave (reenvio de link guest): contador em janelas fixas,
-- persistido em Postgres (vale entre instâncias serverless). PK composta
-- (chave, janelaInicio); nenhuma limpeza necessária (janelas antigas não são
-- mais consultadas).
CREATE TABLE "RateLimit" (
    "chave" VARCHAR(120) NOT NULL,
    "janelaInicio" TIMESTAMP(3) NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("chave","janelaInicio")
);
