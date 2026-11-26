-- Rehearsal on the session-local fixtures created by the preflight test.
BEGIN;

DO $$
DECLARE
  rehearsal record;
  actual_state text;
BEGIN
  FOR rehearsal IN
    SELECT * FROM (VALUES
      ('ALTER TABLE pg_temp."Product" ALTER COLUMN custo_peca_centavos SET NOT NULL', '23502'),
      ('ALTER TABLE pg_temp."Product" ALTER COLUMN custo_embalagem_centavos SET NOT NULL', '23502'),
      ('ALTER TABLE pg_temp."lotes_compra" ADD UNIQUE (nome)', '23505'),
      ('ALTER TABLE pg_temp."materiais_embalagem" ADD UNIQUE (nome)', '23505'),
      ('ALTER TABLE pg_temp."lotes_compra" ADD FOREIGN KEY (categoria_id) REFERENCES pg_temp."Category" (id)', '23503'),
      ('ALTER TABLE pg_temp."Product" ADD FOREIGN KEY (lote_id) REFERENCES pg_temp."lotes_compra" (id)', '23503')
    ) AS checks(ddl, expected_state)
  LOOP
    actual_state := NULL;
    BEGIN
      EXECUTE rehearsal.ddl;
    EXCEPTION
      WHEN integrity_constraint_violation THEN
        GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE;
    END;

    IF actual_state IS DISTINCT FROM rehearsal.expected_state THEN
      RAISE EXCEPTION 'Expected SQLSTATE %, got % for %',
        rehearsal.expected_state, actual_state, rehearsal.ddl;
    END IF;
  END LOOP;
END $$;

-- Remove deliberately invalid fixture rows, keeping valid and nullable links.
DELETE FROM pg_temp."Product"
 WHERE custo_peca_centavos IS NULL OR custo_embalagem_centavos IS NULL;
DELETE FROM pg_temp."lotes_compra" WHERE id = 2;
DELETE FROM pg_temp."materiais_embalagem" WHERE nome = 'Material A';

ALTER TABLE pg_temp."lotes_compra"
  ADD UNIQUE (nome),
  ADD FOREIGN KEY (categoria_id) REFERENCES pg_temp."Category" (id);
ALTER TABLE pg_temp."materiais_embalagem" ADD UNIQUE (nome);
ALTER TABLE pg_temp."Product"
  ALTER COLUMN custo_peca_centavos SET NOT NULL,
  ALTER COLUMN custo_embalagem_centavos SET NOT NULL,
  ADD FOREIGN KEY (lote_id) REFERENCES pg_temp."lotes_compra" (id);

INSERT INTO pg_temp."Product" VALUES (0, 100, NULL, 1);
INSERT INTO pg_temp."materiais_embalagem" VALUES ('Material A');

ROLLBACK;
