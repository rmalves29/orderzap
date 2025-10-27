import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// Rotina reconstruída em 2025-10 após limpeza do repositório.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessMessageRequest {
  tenant_id: string;
  customer_phone: string;
  message: string;
  group_name?: string;
  group_display_name?: string;
  bot_phone?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: ProcessMessageRequest = await req.json();
    const { tenant_id, customer_phone, message, group_name, group_display_name, bot_phone } = body;

    console.log('\n🔄 ===== PROCESSANDO MENSAGEM WHATSAPP =====');
    console.log('🏢 Tenant:', tenant_id);
    console.log('📱 Telefone RECEBIDO (original):', customer_phone);
    console.log('💬 Mensagem:', message);
    if (group_name) {
      console.log('👥 Grupo WhatsApp ID:', group_name);
      if (group_display_name) {
        console.log('📝 Nome do Grupo:', group_display_name);
      }
    }
    if (bot_phone) {
      console.log('🤖 Bot Phone:', bot_phone);
    }

    // Verificar se é o número do bot (não processar vendas do próprio bot)
    if (bot_phone && customer_phone.includes(bot_phone)) {
      console.log('⚠️ Número do bot detectado - IGNORANDO processamento');
      return new Response(
        JSON.stringify({ message: 'Número do bot - não processado' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Detectar códigos de produtos (C seguido de números)
    const productCodeRegex = /C(\d+)/gi;
    const matches = message.matchAll(productCodeRegex);
    const codes: string[] = [];
    
    for (const match of matches) {
      codes.push(match[0].toUpperCase()); // C101, C202, etc
    }

    if (codes.length === 0) {
      console.log('❌ Nenhum código de produto detectado');
      return new Response(
        JSON.stringify({ message: 'Nenhum código de produto detectado' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Códigos detectados:', codes);

    const applyRegionalPhoneRules = (digits: string): string => {
      if (digits.length < 10) {
        return digits;
      }

      const dddString = digits.substring(0, 2);
      const number = digits.substring(2);
      const ddd = parseInt(dddString, 10);

      if (Number.isNaN(ddd) || ddd < 11 || ddd > 99) {
        return digits;
      }

      if (ddd <= 30) {
        if (number.length === 8) {
          console.log(`➕ DDD ${ddd} (<=30): adicionando 9º dígito`);
          return `${dddString}9${number}`;
        }
        return digits;
      }

      if (number.length === 9 && number.startsWith('9')) {
        console.log(`✂️ DDD ${ddd} (>=31): removendo 9º dígito`);
        return `${dddString}${number.substring(1)}`;
      }

      return digits;
    };

    // Função para normalizar telefone SOMENTE para envio no WhatsApp
    function normalizePhoneForWhatsApp(phone: string): string {
      // Remover tudo que não é número
      let clean = phone.replace(/\D/g, '');

      console.log(`🔍 Telefone original (limpo): ${clean} (${clean.length} dígitos)`);

      // Remover código do país (55) se tiver
      if (clean.startsWith('55')) {
        clean = clean.substring(2);
        console.log(`✂️ Removido DDI 55: ${clean}`);
      }

      // Validar tamanho
      if (clean.length < 10 || clean.length > 11) {
        console.warn(`⚠️ Telefone com tamanho inválido: ${clean.length} dígitos`);
        return '55' + clean;
      }

      const normalized = applyRegionalPhoneRules(clean);

      // Adicionar DDI 55
      return '55' + normalized;
    }

    // Função para normalizar telefone para armazenamento aplicando as mesmas regras regionais
    const normalizeForStorage = (phone: string): string => {
      let clean = phone.replace(/\D/g, '');

      // Remove DDI 55 se presente
      if (clean.startsWith('55')) {
        clean = clean.substring(2);
      }

      const normalized = applyRegionalPhoneRules(clean);

      if (normalized !== clean) {
        console.log('ℹ️ Telefone ajustado para armazenamento:', phone, '→', normalized);
      }

      return normalized;
    };

    const messageText = message.trim();
    const phoneForWhatsApp = normalizePhoneForWhatsApp(customer_phone);
    const phoneForStorage = normalizeForStorage(customer_phone);
    
    console.log('\n📞 ===== TELEFONES =====');
    console.log('📥 Original:', customer_phone);
    console.log('💾 Para armazenar (sem normalizar):', phoneForStorage);
    console.log('📤 Para enviar WhatsApp (normalizado):', phoneForWhatsApp);
    console.log('===== FIM =====\n');

    // Salvar/atualizar registro do grupo se for mensagem de grupo
    if (group_name && group_display_name) {
      try {
        const { error: groupError } = await supabase
          .from('customer_whatsapp_groups')
          .upsert({
            tenant_id,
            whatsapp_group_name: group_name,
            customer_phone: phoneForStorage,
            customer_name: null,
            group_display_name: group_display_name,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'tenant_id,whatsapp_group_name,customer_phone',
            ignoreDuplicates: false
          });
        
        if (groupError) {
          console.error('⚠️ Erro ao salvar grupo:', groupError);
        } else {
          console.log('✅ Grupo salvo/atualizado:', group_display_name);
        }
      } catch (error) {
        console.error('⚠️ Erro ao processar grupo:', error);
      }
    }

    // Data de hoje
    const today = new Date().toISOString().split('T')[0];

    // Processar cada código detectado
    const results = [];
    
    for (const code of codes) {
      console.log(`\n🔍 ===== PROCESSANDO CÓDIGO: ${code} =====`);

      // 1. Buscar produto no banco (case-insensitive)
      console.log(`🔎 Buscando produto com código: ${code}`);
      
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('*')
        .eq('tenant_id', tenant_id)
        .ilike('code', code) // Busca case-insensitive
        .eq('is_active', true)
        .maybeSingle();

      if (productError || !product) {
        console.error(`❌ Produto ${code} não encontrado:`, productError);
        results.push({ code, success: false, error: 'Produto não encontrado' });
        continue;
      }

      console.log(`✅ Produto encontrado: ${product.name}`);
      console.log(`   Preço: R$ ${product.price}`);
      console.log(`   Estoque: ${product.stock}`);

      const targetEventType = product.sale_type === 'LIVE' ? 'LIVE' : 'BAZAR';
      console.log(`   Tipo de evento do produto: ${targetEventType}`);

      // 2. Verificar estoque
      if (product.stock <= 0) {
        console.error(`❌ Produto ${code} sem estoque`);
        results.push({ code, success: false, error: 'Produto sem estoque' });
        continue;
      }

      // 3. Buscar pedido existente NÃO pago do mesmo dia
      // IMPORTANTE: reutilizar pedidos apenas do mesmo tipo de evento
      console.log('\n🔎 ===== BUSCANDO PEDIDO EXISTENTE =====');
      console.log('📋 Tenant ID:', tenant_id);
      console.log('📋 Telefone para buscar:', phoneForStorage);
      console.log('📋 Data:', today);
      console.log(`📋 Tipo aceito: ${targetEventType}`);
      console.log('📋 Status: não pago');
      
      const { data: existingOrders, error: orderSearchError } = await supabase
        .from('orders')
        .select('*')
        .eq('tenant_id', tenant_id)
        .eq('customer_phone', phoneForStorage)
        .eq('event_date', today)
        .eq('is_paid', false)
        .eq('event_type', targetEventType)
        .order('created_at', { ascending: false })
        .limit(1);

      if (orderSearchError) {
        console.error('❌ Erro ao buscar pedido:', orderSearchError);
        results.push({ code, success: false, error: 'Erro ao buscar pedido' });
        continue;
      }
      
      console.log('📊 Resultado da busca:', existingOrders?.length || 0, 'pedido(s) encontrado(s)');
      if (existingOrders && existingOrders.length > 0) {
        console.log('✅ Pedido existente #', existingOrders[0].id);
        console.log('   - Tipo:', existingOrders[0].event_type);
        console.log('   - Telefone no DB:', existingOrders[0].customer_phone);
        console.log('   - Total atual: R$', existingOrders[0].total_amount);
      }
      console.log('===== FIM BUSCA PEDIDO =====\n');

      const qty = 1; // Quantidade padrão
      const subtotal = product.price * qty;
      let orderId: number;
      let cartId: number | null = null;

      // 4. Usar pedido existente OU criar novo pedido respeitando o tipo do produto
      if (existingOrders && existingOrders.length > 0) {
        const existingOrder = existingOrders[0];
        orderId = existingOrder.id;
        cartId = existingOrder.cart_id;

        console.log(`✅ Pedido existente encontrado: #${orderId}`);
        console.log(`   Tipo: ${existingOrder.event_type}`);
        console.log(`   Total atual: R$ ${existingOrder.total_amount}`);

        // Atualizar total do pedido
        const newTotal = parseFloat(existingOrder.total_amount) + subtotal;
        const { error: updateError } = await supabase
          .from('orders')
          .update({ total_amount: newTotal })
          .eq('id', orderId);

        if (updateError) {
          console.error('❌ Erro ao atualizar pedido:', updateError);
          results.push({ code, success: false, error: 'Erro ao atualizar pedido' });
          continue;
        }

        console.log(`✅ Total atualizado para: R$ ${newTotal}`);
      } else {
        // Criar novo pedido alinhado ao tipo de venda do produto
        console.log(`📝 Criando novo pedido ${targetEventType}...`);

        const { data: newOrder, error: orderError } = await supabase
          .from('orders')
          .insert([{
            tenant_id,
            customer_phone: phoneForStorage, // Armazenar SEM normalização
            event_type: targetEventType,
            event_date: today,
            total_amount: subtotal,
            is_paid: false,
            whatsapp_group_name: group_name || null
          }])
          .select()
          .single();

        if (orderError) {
          console.error('❌ Erro ao criar pedido:', orderError);
          results.push({ code, success: false, error: 'Erro ao criar pedido' });
          continue;
        }

        orderId = newOrder.id;
        console.log(`✅ Novo pedido ${targetEventType} criado: #${orderId}`);
      }

      // 5. Criar carrinho se não existir
      if (!cartId) {
        console.log('🛒 Criando carrinho...');

        const { data: newCart, error: cartError } = await supabase
          .from('carts')
          .insert({
            tenant_id,
            customer_phone: phoneForStorage, // Armazenar SEM normalização
            event_type: targetEventType,
            event_date: today,
            status: 'OPEN',
            whatsapp_group_name: group_name || null
          })
          .select()
          .single();

        if (cartError) {
          console.error('❌ Erro ao criar carrinho:', cartError);
          results.push({ code, success: false, error: 'Erro ao criar carrinho' });
          continue;
        }

        cartId = newCart.id;

        // Atualizar pedido com cart_id
        await supabase
          .from('orders')
          .update({ cart_id: cartId })
          .eq('id', orderId);

        console.log(`✅ Carrinho criado: #${cartId}`);
      }

      // 6. Verificar se produto já está no carrinho
      const { data: existingCartItem } = await supabase
        .from('cart_items')
        .select('*')
        .eq('cart_id', cartId)
        .eq('product_id', product.id)
        .maybeSingle();

      if (existingCartItem) {
        // Atualizar quantidade do item existente
        console.log(`🔄 Produto já está no carrinho, atualizando quantidade...`);
        
        const { error: updateCartError } = await supabase
          .from('cart_items')
          .update({
            qty: existingCartItem.qty + qty,
            unit_price: product.price
          })
          .eq('id', existingCartItem.id);

        if (updateCartError) {
          console.error('❌ Erro ao atualizar item do carrinho:', updateCartError);
          results.push({ code, success: false, error: 'Erro ao atualizar carrinho' });
          continue;
        }

        console.log(`✅ Quantidade atualizada: ${existingCartItem.qty} → ${existingCartItem.qty + qty}`);
      } else {
        // Adicionar novo item ao carrinho
        console.log(`➕ Adicionando produto ao carrinho...`);
        
        const { error: cartItemError } = await supabase
          .from('cart_items')
          .insert({
            tenant_id,
            cart_id: cartId,
            product_id: product.id,
            qty: qty,
            unit_price: product.price,
            printed: false
          });

        if (cartItemError) {
          console.error('❌ Erro ao adicionar item ao carrinho:', cartItemError);
          results.push({ code, success: false, error: 'Erro ao adicionar ao carrinho' });
          continue;
        }

        console.log(`✅ Produto adicionado ao carrinho`);
      }

      // 7. Atualizar estoque do produto
      console.log(`📦 Atualizando estoque: ${product.stock} → ${product.stock - qty}`);
      
      const { error: stockError } = await supabase
        .from('products')
        .update({ stock: product.stock - qty })
        .eq('id', product.id);

      if (stockError) {
        console.error('⚠️ Erro ao atualizar estoque (não bloqueante):', stockError);
      } else {
        console.log(`✅ Estoque atualizado`);
      }

      // 8. Enviar mensagem WhatsApp de confirmação
      console.log(`📤 Enviando confirmação via WhatsApp...`);
      
      try {
        const sendMessageResponse = await supabase.functions.invoke('whatsapp-send-item-added', {
          body: {
            tenant_id,
            customer_phone: phoneForWhatsApp, // Normalizar SOMENTE para envio
            product_name: product.name,
            product_code: product.code,
            quantity: qty,
            unit_price: product.price
          }
        });

        if (sendMessageResponse.error) {
          console.error('❌ Erro ao enviar WhatsApp:', sendMessageResponse.error);
        } else {
          console.log('✅ Mensagem WhatsApp enviada');
        }
      } catch (error) {
        console.error('❌ Erro ao chamar edge function WhatsApp:', error);
      }

      console.log(`✅ ===== CÓDIGO ${code} PROCESSADO COM SUCESSO =====\n`);

      results.push({
        code,
        success: true,
        product: product.name,
        orderId,
        quantity: qty,
        total: subtotal
      });
    }

    console.log('🎉 ===== PROCESSAMENTO CONCLUÍDO =====\n');

    return new Response(
      JSON.stringify({
        success: true,
        message: `${codes.length} código(s) processado(s)`,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('\n💥 ===== ERRO NO PROCESSAMENTO =====');
    console.error('Tipo:', error.name);
    console.error('Mensagem:', error.message);
    console.error('Stack:', error.stack);
    console.error('===== FIM DO ERRO =====\n');
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
