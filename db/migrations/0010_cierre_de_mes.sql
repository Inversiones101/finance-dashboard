-- Cierre de mes. `settings.books_closed_through` = último mes cerrado ('YYYY-MM').
-- Un registro con fecha en un mes cerrado no se puede crear, borrar ni cambiar en lo que afecta
-- los números. Sí se permiten cambios operativos que no los alteran (marcar pagado un gasto
-- de septiembre cuando se paga en octubre, enlazar un movimiento con el banco).
-- Vive en la base para cubrir todos los caminos: pantallas, asistente, sincronización e importación.
CREATE OR REPLACE FUNCTION books_closed_through() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT value #>> '{}' FROM settings WHERE key = 'books_closed_through'
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_closed_month() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  closed text := books_closed_through();
  col text := TG_ARGV[0];
  new_d date;
  old_d date;
  same boolean := false;
BEGIN
  IF closed IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP <> 'DELETE' THEN EXECUTE format('SELECT ($1).%I', col) INTO new_d USING NEW; END IF;
  IF TG_OP <> 'INSERT' THEN EXECUTE format('SELECT ($1).%I', col) INTO old_d USING OLD; END IF;

  IF TG_OP = 'UPDATE' THEN
    -- ¿Cambió algo que mueva los números? Si no, es un cambio operativo y se permite.
    IF TG_TABLE_NAME = 'expenses' THEN
      same := NEW.expense_date = OLD.expense_date AND NEW.amount_cents = OLD.amount_cents AND NEW.category_id = OLD.category_id
              AND NEW.currency = OLD.currency AND NEW.funding_source = OLD.funding_source AND NEW.fx_rate_to_usd = OLD.fx_rate_to_usd;
    ELSIF TG_TABLE_NAME = 'revenues' THEN
      same := NEW.revenue_date = OLD.revenue_date AND NEW.gross_cents = OLD.gross_cents AND NEW.processor_fee_cents = OLD.processor_fee_cents
              AND NEW.affiliate_fee_cents = OLD.affiliate_fee_cents AND NEW.category_id = OLD.category_id
              AND NEW.product_id IS NOT DISTINCT FROM OLD.product_id AND NEW.currency = OLD.currency AND NEW.fx_rate_to_usd = OLD.fx_rate_to_usd;
    ELSIF TG_TABLE_NAME = 'cash_movements' THEN
      same := NEW.movement_date = OLD.movement_date AND NEW.amount_cents = OLD.amount_cents AND NEW.type = OLD.type AND NEW.account_id = OLD.account_id;
    ELSIF TG_TABLE_NAME = 'owner_ledger' THEN
      same := NEW.entry_date = OLD.entry_date AND NEW.amount_cents = OLD.amount_cents AND NEW.type = OLD.type;
    END IF;
    IF same THEN
      RETURN NEW;
    END IF;
  END IF;

  IF (new_d IS NOT NULL AND to_char(new_d, 'YYYY-MM') <= closed) OR (old_d IS NOT NULL AND to_char(old_d, 'YYYY-MM') <= closed) THEN
    RAISE EXCEPTION 'El mes % está cerrado: no se pueden registrar ni cambiar movimientos con esa fecha. Un Administrador puede reabrirlo en Reportes.',
      to_char(COALESCE(
        CASE WHEN new_d IS NOT NULL AND to_char(new_d, 'YYYY-MM') <= closed THEN new_d END,
        old_d), 'YYYY-MM')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;--> statement-breakpoint

CREATE TRIGGER revenues_closed_month BEFORE INSERT OR UPDATE OR DELETE ON revenues FOR EACH ROW EXECUTE FUNCTION guard_closed_month('revenue_date');--> statement-breakpoint
CREATE TRIGGER expenses_closed_month BEFORE INSERT OR UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION guard_closed_month('expense_date');--> statement-breakpoint
CREATE TRIGGER cash_movements_closed_month BEFORE INSERT OR UPDATE OR DELETE ON cash_movements FOR EACH ROW EXECUTE FUNCTION guard_closed_month('movement_date');--> statement-breakpoint
CREATE TRIGGER owner_ledger_closed_month BEFORE INSERT OR UPDATE OR DELETE ON owner_ledger FOR EACH ROW EXECUTE FUNCTION guard_closed_month('entry_date');
