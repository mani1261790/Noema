ALTER TABLE cms_members ADD COLUMN display_name TEXT;
ALTER TABLE cms_members ADD COLUMN public_id TEXT;

UPDATE cms_members
SET public_id = lower(hex(randomblob(16)))
WHERE public_id IS NULL;

CREATE UNIQUE INDEX cms_members_public_id_idx
  ON cms_members (public_id)
  WHERE public_id IS NOT NULL;

CREATE TRIGGER cms_members_assign_public_id
AFTER INSERT ON cms_members
WHEN NEW.public_id IS NULL
BEGIN
  UPDATE cms_members
  SET public_id = lower(hex(randomblob(16)))
  WHERE subject = NEW.subject;
END;

CREATE TRIGGER cms_members_validate_display_name_insert
BEFORE INSERT ON cms_members
WHEN NEW.display_name IS NOT NULL
  AND (
    length(trim(NEW.display_name)) < 1
    OR length(trim(NEW.display_name)) > 80
    OR instr(NEW.display_name, char(10)) > 0
    OR instr(NEW.display_name, char(13)) > 0
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid_cms_display_name');
END;

CREATE TRIGGER cms_members_validate_display_name_update
BEFORE UPDATE OF display_name ON cms_members
WHEN NEW.display_name IS NOT NULL
  AND (
    length(trim(NEW.display_name)) < 1
    OR length(trim(NEW.display_name)) > 80
    OR instr(NEW.display_name, char(10)) > 0
    OR instr(NEW.display_name, char(13)) > 0
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid_cms_display_name');
END;
