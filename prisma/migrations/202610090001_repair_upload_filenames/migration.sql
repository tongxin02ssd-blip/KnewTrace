-- Repair UTF-8 upload names that were previously decoded as Latin-1 by the multipart parser.
-- Correct UTF-8 names and genuine Latin-1 names are left unchanged when conversion is invalid.
CREATE FUNCTION "_knowtrace_repair_utf8_filename"(value TEXT)
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

UPDATE "Document"
SET "fileName" = "_knowtrace_repair_utf8_filename"("fileName")
WHERE "fileName" <> "_knowtrace_repair_utf8_filename"("fileName");

-- Evidence titles are snapshots of the document name and must be repaired too.
UPDATE "Evidence" AS evidence
SET "title" = document."fileName"
FROM "Document" AS document
WHERE evidence."documentId" = document."id"
  AND evidence."sourceType" = 'KNOWLEDGE'
  AND evidence."title" <> document."fileName";

DROP FUNCTION "_knowtrace_repair_utf8_filename"(TEXT);
