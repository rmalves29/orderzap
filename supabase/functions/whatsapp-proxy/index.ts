// Atualização 2025-10: função recriada após restauração do repositório.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WhatsAppIntegration {
  api_url: string;
}

interface ProxyRequestBody {
  tenant_id?: string;
  tenantId?: string;
  action?: string;
  api_url?: string;
  server_url?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let body: ProxyRequestBody = {};

  try {
    if (req.bodyUsed) {
      // body already consumed by a previous middleware (shouldn't happen) but guard anyway
      body = {};
    } else {
      body = await req.json() as ProxyRequestBody;
    }
  } catch (_err) {
    // ignore parse errors – treated as empty body
    body = {};
  }

  try {
    const { tenant_id, action, tenantId, api_url, server_url } = body;
    const actualTenantId = tenant_id || tenantId;
    console.log('🔍 Proxy request:', { tenant_id: actualTenantId, action });

    if (!actualTenantId) {
      return new Response(
        JSON.stringify({ error: 'tenant_id is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    let apiUrl = (api_url || server_url || '').trim();

    if (!apiUrl) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
      const authToken = serviceKey || anonKey;

      if (!supabaseUrl || !authToken) {
        console.error('❌ SUPABASE credentials not configured in Edge function');
        return new Response(
          JSON.stringify({
            error: 'Supabase credentials missing for whatsapp-proxy',
            details: 'Configure SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) for this function or send server_url'
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      const response = await fetch(
        `${supabaseUrl}/rest/v1/integration_whatsapp?tenant_id=eq.${actualTenantId}&select=api_url`,
        {
          headers: {
            'apikey': authToken,
            'Authorization': `Bearer ${authToken}`,
          },
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('❌ Failed to load integration from Supabase:', response.status, errorBody);
        return new Response(
          JSON.stringify({
            error: 'Failed to load WhatsApp integration',
            details: errorBody || response.statusText,
          }),
          {
            status: response.status === 404 ? 404 : 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      const integrations = await response.json() as WhatsAppIntegration[];

      if (!Array.isArray(integrations) || integrations.length === 0 || !integrations[0]?.api_url) {
        console.error('❌ No WhatsApp integration found for tenant:', actualTenantId);
        return new Response(
          JSON.stringify({ error: 'WhatsApp integration not configured' }),
          {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      apiUrl = integrations[0].api_url.trim();
    }

    if (!apiUrl) {
      return new Response(
        JSON.stringify({ error: 'WhatsApp integration not configured' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Normalizar URL removendo barra final
    apiUrl = apiUrl.replace(/\/$/, '');

    if (!apiUrl.startsWith('http')) {
      console.error('❌ Invalid API URL configured for tenant:', apiUrl);
      return new Response(
        JSON.stringify({ error: 'Invalid WhatsApp server URL configured' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Construir URL correta: /qr/:tenant_id ou /status/:tenant_id
    const endpoint = action === 'status' ? 'status' : 'qr';
    const fullUrl = `${apiUrl}/${endpoint}/${actualTenantId}`;

    console.log('📡 Forwarding to WhatsApp server:', fullUrl);

    // Make request to WhatsApp server with tenant_id in URL
    const whatsappResponse = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/json',
      },
    }).catch((error) => {
      console.error('❌ Error proxying request to WhatsApp server:', error);
      throw new Error('Não foi possível conectar ao servidor WhatsApp configurado');
    });

    console.log('📡 Response status:', whatsappResponse.status);
    console.log('📄 Content-Type:', whatsappResponse.headers.get('content-type'));

    if (!whatsappResponse.ok) {
      const errorBody = await whatsappResponse.text();
      console.error('❌ WhatsApp server returned error:', whatsappResponse.status, errorBody);
      return new Response(
        JSON.stringify({
          error: 'Erro ao consultar servidor WhatsApp',
          status: whatsappResponse.status,
          details: errorBody,
        }),
        {
          status: whatsappResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const contentType = whatsappResponse.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      const jsonData = await whatsappResponse.json();
      console.log('✅ JSON response:', jsonData);
      return new Response(JSON.stringify(jsonData), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // If HTML, extract QR code or status
    const html = await whatsappResponse.text();
    console.log('📄 HTML length:', html.length);
    console.log('📄 HTML first 1000 chars:', html.substring(0, 1000));

    // Check if WhatsApp is already connected
    if (html.includes('✅ Conectado') || html.includes('Status: online')) {
      console.log('✅ WhatsApp is already connected');
      return new Response(
        JSON.stringify({
          success: true,
          connected: true,
          status: 'connected',
          message: 'WhatsApp está conectado'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Try to extract QR code - buscar por data:image
    if (html.includes('data:image')) {
      const imgMatch = html.match(/src=["']([^"']*data:image[^"']*)["']/i);
      console.log('🔍 QR Code data:image match:', imgMatch ? 'Found' : 'Not found');

      if (imgMatch && imgMatch[1]) {
        const qrCode = imgMatch[1];
        console.log('✅ QR Code found! Length:', qrCode.length);
        console.log('📸 QR Code preview:', qrCode.substring(0, 100));
        
        return new Response(
          JSON.stringify({
            success: true,
            connected: false,
            qrCode,
            message: 'QR Code gerado com sucesso'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Se não encontrou data:image, tentar qualquer src de img
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
    console.log('🔍 Generic image match:', imgMatch ? 'Found' : 'Not found');

    if (imgMatch && imgMatch[1]) {
      const qrCode = imgMatch[1];
      console.log('✅ QR Code found (generic)! Length:', qrCode.length);
      
      return new Response(
        JSON.stringify({
          success: true,
          connected: false,
          qrCode,
          message: 'QR Code gerado com sucesso'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // No QR code found - return HTML for debugging
    console.error('❌ No QR Code found in HTML');
    console.error('🔍 Full HTML:', html);
    
    return new Response(
      JSON.stringify({
        error: 'Could not extract QR Code from response',
        htmlPreview: html.substring(0, 500),
        connected: false
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('❌ Proxy error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: 'Failed to proxy request to WhatsApp server'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
