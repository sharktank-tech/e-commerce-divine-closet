-- CartItem.unitPrice: snapshot do preço no momento da adição ao carrinho.
-- Linhas legadas herdam o preço atual do produto.
ALTER TABLE "CartItem" ADD COLUMN "unitPrice" DECIMAL(10,2);
UPDATE "CartItem" SET "unitPrice" = "Product"."price" FROM "Product" WHERE "CartItem"."productId" = "Product"."id";
ALTER TABLE "CartItem" ALTER COLUMN "unitPrice" SET NOT NULL;
