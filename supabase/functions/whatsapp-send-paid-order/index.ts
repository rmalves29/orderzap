import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type PaidOrderRequest = {
  tenant_id: string;
  order_id: number;
};

type CartItemRow = {
  qty: number;
  unit_price: number;
  products: {
    name?: string | null;
    code?: string | null;
  } | null;
};

function formatCurrency(value: number) {
  return `R$ ${value.toFixed(2)}`;
}

function buildOrderDetails(items: CartItemRow[] | null | undefined) {
  if (!items || items.length === 0) {
    return 'Itens confirmados.';
  }

  return items
    .map((item) => {
      const name = item.products?.name ?? 'Produto';
      const qty = item.qty ?? 1;
      const total = (item.unit_price ?? 0) * qty;
      return `• ${qty}x ${name} - ${formatCurrency(total)}`;
    })
    .join('\n');
}

function normalizePhoneBrazil(phone: string): string {
  let clean = phone.replace(/\D/g, '');

  if (clean.startsWith('55')) {
    clean = clean.substring(2);
  }

  if (clean.length < 10) {
    return `55${clean}`;
  }

  const ddd = parseInt(clean.substring(0, 2));
  let number = clean.substring(2);

  if (ddd > 30) {
    if (number.length === 9 && number.startsWith('9')) {
      number = number.substring(1);
    }
  } else {
    if (number.length === 8) {
      number = `9${number}`;
    }
  }

  return `55${ddd}${number}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: PaidOrderRequest = await req.json();
    const { tenant_id, order_id } = body;

    if (!tenant_id || !order_id) {
      return new Response(
        JSON.stringify({ error: 'tenant_id e order_id são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Variáveis SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes');
    }

    const whatsappApiUrl = Deno.env.get('WHATSAPP_MULTITENANT_URL') || 'https://backend-production-2599.up.railway.app';

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, tenant_id, customer_phone, customer_name, total_amount, cart_id, event_type, event_date')
      .eq('id', order_id)
      .eq('tenant_id', tenant_id)
      .maybeSingle();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: 'Pedido não encontrado' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!order.customer_phone) {
      return new Response(
        JSON.stringify({ error: 'Pedido sem telefone cadastrado' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let orderItems: CartItemRow[] = [];
    if (order.cart_id) {
      const { data: items } = await supabase
        .from('cart_items')
        .select('qty, unit_price, products(name, code)')
        .eq('cart_id', order.cart_id);

      orderItems = items || [];
    }

    const { data: template } = await supabase
      .from('whatsapp_templates')
      .select('content')
      .eq('tenant_id', tenant_id)
      .eq('type', 'PAID_ORDER')
      .maybeSingle();

    const defaultMessage = '🎉 *Pagamento Confirmado - Pedido #{{order_id}}*\n\nRecebemos o seu pagamento!\nValor: *{{total_amount}}*\n\nObrigado por comprar com a gente!';

    const orderDetails = buildOrderDetails(orderItems);
    const totalFormatted = formatCurrency(Number(order.total_amount || 0));
    const eventDateFormatted = order.event_date ? new Date(order.event_date).toLocaleDateString('pt-BR') : '';

    const message = (template?.content || defaultMessage)
      .replace(/{{order_id}}/g, order.id.toString())
      .replace(/{{total}}/g, totalFormatted)
      .replace(/{{total_amount}}/g, totalFormatted)
      .replace(/{{customer_name}}/g, order.customer_name || '')
      .replace(/{{customer_phone}}/g, order.customer_phone || '')
      .replace(/{{order_details}}/g, orderDetails)
      .replace(/{{event_type}}/g, order.event_type || '')
      .replace(/{{event_date}}/g, eventDateFormatted);

    const phoneFinal = normalizePhoneBrazil(order.customer_phone);

    const whatsappResponse = await fetch(`${whatsappApiUrl}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenant_id
      },
      body: JSON.stringify({
        phone: phoneFinal,
        message
      })
    });

    if (!whatsappResponse.ok) {
      const errorText = await whatsappResponse.text();
      throw new Error(`WhatsApp API error (${whatsappResponse.status}): ${errorText}`);
    }

    await supabase.from('whatsapp_messages').insert({
      tenant_id,
      phone: phoneFinal,
      message,
      type: 'order_paid',
      order_id: order.id,
      sent_at: new Date().toISOString(),
      processed: true
    });

    await supabase
      .from('orders')
      .update({ payment_confirmation_sent: true })
      .eq('id', order.id);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Erro whatsapp-send-paid-order:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
