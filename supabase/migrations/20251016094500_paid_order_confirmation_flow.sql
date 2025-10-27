-- Atualizar fluxo de confirmação de pedido pago
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS skip_paid_message BOOLEAN DEFAULT false;

-- Garantir que valores antigos fiquem padronizados
UPDATE public.orders
SET skip_paid_message = COALESCE(skip_paid_message, false)
WHERE skip_paid_message IS NULL;

CREATE OR REPLACE FUNCTION public.process_paid_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_supabase_url text;
  v_response http_response;
BEGIN
  IF NEW.is_paid = true AND (OLD.is_paid = false OR OLD.is_paid IS NULL) THEN

    IF COALESCE(NEW.skip_paid_message, false) THEN
      INSERT INTO whatsapp_messages (
        tenant_id,
        phone,
        message,
        type,
        order_id,
        created_at
      ) VALUES (
        NEW.tenant_id,
        NEW.customer_phone,
        'Envio de confirmação de pagamento ignorado pelo usuário',
        'system_log',
        NEW.id,
        now()
      );

      UPDATE public.orders
      SET payment_confirmation_sent = false
      WHERE id = NEW.id;

      RETURN NEW;
    END IF;

    v_supabase_url := 'https://hxtbsieodbtzgcvvkeqx.supabase.co';

    BEGIN
      SELECT * INTO v_response FROM http_post(
        v_supabase_url || '/functions/v1/whatsapp-send-paid-order',
        jsonb_build_object(
          'order_id', NEW.id,
          'tenant_id', NEW.tenant_id
        )::text,
        'application/json'
      );

      INSERT INTO whatsapp_messages (
        tenant_id,
        phone,
        message,
        type,
        order_id,
        created_at
      ) VALUES (
        NEW.tenant_id,
        NEW.customer_phone,
        'Edge function whatsapp-send-paid-order chamada - Status: ' || COALESCE(v_response.status::text, 'NULL'),
        'system_log',
        NEW.id,
        now()
      );

      IF v_response.status = 200 THEN
        UPDATE public.orders
        SET payment_confirmation_sent = true
        WHERE id = NEW.id;
      ELSE
        UPDATE public.orders
        SET payment_confirmation_sent = false
        WHERE id = NEW.id;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      INSERT INTO whatsapp_messages (
        tenant_id,
        phone,
        message,
        type,
        order_id,
        created_at
      ) VALUES (
        NEW.tenant_id,
        NEW.customer_phone,
        'ERRO ao chamar whatsapp-send-paid-order: ' || SQLERRM,
        'system_log',
        NEW.id,
        now()
      );

      UPDATE public.orders
      SET payment_confirmation_sent = false
      WHERE id = NEW.id;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- Garantir que o trigger utilize a versão atualizada da função
DROP TRIGGER IF EXISTS trigger_process_paid_order ON public.orders;
CREATE TRIGGER trigger_process_paid_order
AFTER UPDATE OF is_paid ON public.orders
FOR EACH ROW
WHEN (NEW.is_paid = true AND (OLD.is_paid = false OR OLD.is_paid IS NULL))
EXECUTE FUNCTION public.process_paid_order();

COMMIT;
