-- Repair mojibake titles in historical evidence whose source document was deleted.
CREATE FUNCTION "_knowtrace_repair_utf8_evidence_title"(value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  repaired TEXT;
BEGIN
  repaired := convert_from(convert_to(value, 'LATIN1'), 'UTF8');
  RETURN repaired;
EXCEPTION
  WHEN character_not_in_repertoire OR untranslatable_character OR invalid_text_representation THEN
    RETURN value;
END;
$$;

UPDATE "Evidence"
SET "title" = "_knowtrace_repair_utf8_evidence_title"("title")
WHERE "title" <> "_knowtrace_repair_utf8_evidence_title"("title");

DROP FUNCTION "_knowtrace_repair_utf8_evidence_title"(TEXT);
