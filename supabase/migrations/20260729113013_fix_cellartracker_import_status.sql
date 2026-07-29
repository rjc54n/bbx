CREATE OR REPLACE FUNCTION private.set_cellartracker_import_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.source_type = 'cellartracker_inventory'
       AND NEW.status = 'validated'
       AND NEW.error_row_count > 0 THEN
        NEW.status := 'failed';
        NEW.failure_summary := format('%s invalid source row%s.', NEW.error_row_count,
            CASE WHEN NEW.error_row_count = 1 THEN '' ELSE 's' END);
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.set_cellartracker_import_status()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER set_cellartracker_import_status
    BEFORE INSERT OR UPDATE OF status, error_row_count
    ON public.cellar_imports
    FOR EACH ROW
    EXECUTE FUNCTION private.set_cellartracker_import_status();

UPDATE public.cellar_imports
SET status = 'failed',
    failure_summary = format('%s invalid source row%s.', error_row_count,
        CASE WHEN error_row_count = 1 THEN '' ELSE 's' END)
WHERE source_type = 'cellartracker_inventory'
  AND status = 'validated'
  AND error_row_count > 0;
