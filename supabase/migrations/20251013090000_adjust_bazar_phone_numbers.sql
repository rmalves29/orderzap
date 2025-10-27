-- Corrige telefones de pedidos/carrinhos manuais aplicando a regra regional do nono dígito
-- e disponibiliza função utilitária para futuras correções.

CREATE OR REPLACE FUNCTION public.normalize_bazar_phone(phone text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_clean text;
  v_has_country boolean;
  v_ddd text;
  v_number text;
  v_ddd_int integer;
BEGIN
  IF phone IS NULL THEN
    RETURN NULL;
  END IF;

  v_clean := regexp_replace(phone, '\\D', '', 'g');
  v_has_country := v_clean LIKE '55%';

  IF v_has_country THEN
    v_clean := substr(v_clean, 3);
  END IF;

  IF length(v_clean) < 10 THEN
    RETURN v_clean;
  END IF;

  v_ddd := substr(v_clean, 1, 2);
  v_number := substr(v_clean, 3);

  BEGIN
    v_ddd_int := v_ddd::integer;
  EXCEPTION WHEN others THEN
    RETURN v_clean;
  END;

  IF v_ddd_int < 11 OR v_ddd_int > 99 THEN
    RETURN v_clean;
  END IF;

  IF v_ddd_int <= 30 THEN
    IF length(v_number) = 8 THEN
      v_number := '9' || v_number;
    END IF;
  ELSE
    IF length(v_number) = 9 AND substr(v_number, 1, 1) = '9' THEN
      v_number := substr(v_number, 2);
    END IF;
  END IF;

  RETURN v_ddd || v_number;
END;
$$;

-- Atualiza pedidos e carrinhos existentes ligados ao fluxo manual/bazar
UPDATE public.orders
SET customer_phone = public.normalize_bazar_phone(customer_phone),
    event_type = 'BAZAR'
WHERE event_type IN ('MANUAL', 'BAZAR');

UPDATE public.carts
SET customer_phone = public.normalize_bazar_phone(customer_phone),
    event_type = 'BAZAR'
WHERE event_type IN ('MANUAL', 'BAZAR');
