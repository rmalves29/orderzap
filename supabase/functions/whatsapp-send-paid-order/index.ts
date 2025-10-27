import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'; 

const corsHeaders = {
 'Acesso-controle-permitir-origem': '*', 
 'Access-Control-Allow-Headers': 'autorização, x-client-info, apikey, tipo de conteúdo', 
};

tipo PaidOrderRequest = { 
 tenant_id: cadeia de caracteres; 
 order_id: número; 
};

digite CartItemRow = { 
 qtd: número; 
 unit_price: número; 
 produtos: { 
 nome?: string | nulo; 
 código?: string | nulo; 
 } | nulo; 
};

function formatCurrency(valor: número) { 
 return 'R$ ${value.toFixed(2)}'; 
}

função buildOrderDetails(items: CartItemRow[] | nulo | indefinido) { 
 if (!items || items.comprimento === 0) { 
    return 'Itens confirmados.';
  }

 Itens de devolução 
    .map((item) => {
 Nome = item.Produtos?.No nome?? 'Pregador'; 
 const qtd = item.Qtd ?? 1; 
 const total = (item.unit_price ?? 0) * quantidade; 
 return '• ${qty}x ${name} - ${formatCurrency(total)}'; 
    })
    .join('\n');
}

function normalizePhoneBrazil(phone: string): string { 
 let clean = telefone.substituir(/\D/g, ''); 

 se (limpo.startsWith('55')) { 
 limpo = limpo.substring(2); 
  }

 se (limpo.comprimento < 10) { 
 return '55${clean}'; 
  }

 const ddd = parseInt(clean.substring(0, 2)); 
 let number = clean.substring(2); 

 if(ddd>30) { 
 se (número.comprimento === 9 && número.startsWith('9')) { 
 número = número.substring(1); 
    }
  } mais {
 se (número.comprimento === 8) { 
 número = '9${número}'; 
    }
  }

 return '55${ddd}${número}'; 
}

Deno.serve(async(req) => { 
 if (req.method === 'OPÇÕES') { 
 return new Response(null, { headers: corsHeaders }); 
  }

  tentar {
   const body: PaidOrderRequest = await req.json(); 
 const { tenant_id, order_id } = corpo; 

 if (!tenant_id || !order_id) { 
 return new Response( 
        JSON.stringify({ error: 'tenant_id e order_id são obrigatórios' }),
 { status: 400, cabeçalhos: { ... corsHeaders, 'Tipo de conteúdo': 'aplicativo/json' } } 
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
 .from('pedidos') 
      .select('id, tenant_id, customer_phone, customer_name, total_amount, cart_id, event_type, event_date')
 Não é uma questãoEQ('id', order_id) 
      .eq('tenant_id', tenant_id)
 .talvezSingle(); 

 if (orderError || !order) { 
 return new Response( 
        JSON.stringify({ error: 'Pedido não encontrado' }),
 { status: 404, cabeçalhos: { ... corsHeaders, 'Tipo de conteúdo': 'aplicativo/json' } } 
      );
    }

 if (!order.customer_phone) { 
 return new Response( 
        JSON.stringify({ error: 'Pedido sem telefone cadastrado' }),
 { status: 400, cabeçalhos: { ... corsHeaders, 'Tipo de conteúdo': 'aplicativo/json' } } 
      );
    }

 let orderItems: CartItemRow[] = []; 
 se (ordem.cart_id) { 
 const { data: items } = aguardar supabase 
        .from('cart_items')
 .select('qtd, unit_price, produtos(nome, código)') 
 Não é uma questãoeq('cart_id', ordem.cart_id); 

 orderItems = itens || []; 
    }

 const { data: template } = aguardar supabase 
      .from('whatsapp_templates')
 .select('conteúdo') 
      .eq('tenant_id', tenant_id)
 Não é uma questãoEQ('tipo', 'PAID_ORDER') 
 .talvezSingle(); 

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
 telefone: phoneFinal, 
 Mensagem 
 Tipo: 'order_paid', 
 order_id: ordem.identificação, 
 sent_at: new Date().toISOString(), 
 processado: verdadeiro 
    });

 aguarde a base 
 .from('pedidos') 
      .update({ payment_confirmation_sent: true })
 .eq('id', ordem.identificação); 

 return new Response( 
 JSON.stringify({ success: true }), 
 { status: 200, cabeçalhos: { ... corsHeaders, 'Tipo de conteúdo': 'aplicativo/json' } } 
    );
 } catch (erro) { 
 console.error('Erro whatsapp-send-paid-order:', erro); 
 return new Response( 
 JSON.stringify({ error: (erro como Erro).mensagem }), 
 { status: 500, cabeçalhos: { ... corsHeaders, 'Tipo de conteúdo': 'aplicativo/json' } } 
    );
  }
});
