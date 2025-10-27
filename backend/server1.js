 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/backend/server1.js b/backend/server1.js
index 32a41fc47284ab7e8e5359b8c04f44dcb843a69a..2bee5734398d8caddab8de240e107bab31aed6fa 100644
--- a/backend/server1.js
+++ b/backend/server1.js
@@ -340,56 +340,65 @@ class TenantManager {
       console.log(`${'='.repeat(70)}\n`);
       throw error;
     }
   }
 
     /**
      * Inicia o processamento da fila para um tenant usando as funções
      * de envio e validação que dependem do contexto do TenantManager
      */
     async processQueueForTenant(tenantId) {
       if (!this.supabaseHelper) {
         console.warn('⚠️ SupabaseHelper não disponível em TenantManager.processQueueForTenant');
         return;
       }
 
       const sendFunction = async (msg) => {
         const sock = this.getOnlineClient(tenantId);
         if (!sock) {
           throw new Error('WhatsApp desconectado');
         }
 
         console.log(`📤 [Queue] Enviando para ${msg.groupId}`);
         await sock.sendMessage(msg.groupId, { text: msg.message });
 
         // Registrar no Supabase
+        const metadata = {
+          whatsapp_group_name: msg.groupName || msg.groupId,
+          product_name: msg.productName,
+        };
+
+        if (typeof msg.delayAfterMs === 'number') {
+          metadata.delay_after_ms = msg.delayAfterMs;
+        }
+
         await this.supabaseHelper.logMessage(
           tenantId,
           msg.groupId,
           msg.message,
           'sendflow',
-          { whatsapp_group_name: msg.groupId, product_name: msg.productName }
+          metadata
         );
       };
 
       const validationFunction = async (tid) => {
         // Usar validação rápida/getOnlineClient para decidir se pode enviar
         return !!this.getOnlineClient(tid);
       };
 
       await this.messageQueue.processQueue(tenantId, sendFunction, validationFunction);
     }
 
   async handleIncomingMessage(tenantId, msg, messageText) {
     const clientData = this.clients.get(tenantId);
     if (!clientData) {
       console.log('⚠️ Cliente não encontrado para tenantId:', tenantId);
       return;
     }
 
     const tenant = clientData.tenant;
     
     console.log(`\n${'='.repeat(70)}`);
     console.log(`📨 NOVA MENSAGEM RECEBIDA (${tenant.name})`);
     console.log(`${'='.repeat(70)}`);
     console.log(`💬 Texto: "${messageText}"`);
 
@@ -838,87 +847,87 @@ class CartMonitor {
       console.log(`   Cliente: ${item.cart?.customer_phone}`);
       console.log(`   Quantidade: ${item.qty}`);
       console.log(`✅ Item será processado via edge function whatsapp-send-item-added`);
       console.log(`   (CartMonitor desabilitado - edge function já envia a mensagem)`);
 
       // Marcar como processado para evitar reprocessamento
       await this.supabaseHelper.markCartItemProcessed(item.id);
       console.log(`✅ Item marcado como processado\n`);
 
     } catch (error) {
       console.error(`❌ Erro ao processar item:`, error.message);
     }
   }
 
   stop() {
     this.isRunning = false;
     console.log('🛑 Monitor de carrinho parado');
   }
 }
 
 /**
  * Normaliza telefone para envio via WhatsApp aplicando regra do DDD.
  * Esta função é chamada APENAS no momento do envio.
  * 
  * Regra do 9º dígito:
- * - DDD ≤ 11: Se tiver 10 dígitos → ADICIONA o 9º dígito
- * - DDD ≥ 31: Se tiver 11 dígitos → REMOVE o 9º dígito
+ * - DDD ≤ 30: Se tiver 10 dígitos → ADICIONA o 9º dígito
+ * - DDD > 30: Se tiver 11 dígitos → REMOVE o 9º dígito
  */
 function normalizePhone(phone) {
   let clean = phone.replace(/\D/g, '');
   
   // Remove DDI 55 se presente
   if (clean.startsWith('55')) {
     clean = clean.substring(2);
   }
   
   // Validação básica
   if (clean.length < 10 || clean.length > 11) {
     console.warn('⚠️ Telefone com tamanho inválido para envio:', phone);
     return '55' + clean + '@s.whatsapp.net';
   }
   
   const ddd = parseInt(clean.substring(0, 2));
   
   // Validar DDD
   if (ddd < 11 || ddd > 99) {
     console.warn('⚠️ DDD inválido:', ddd);
     return '55' + clean + '@s.whatsapp.net';
   }
   
   // Aplica regra do 9º dígito para envio
-  if (ddd <= 11) {
+  if (ddd <= 30) {
     // Norte/Nordeste: Se tem 10 dígitos, ADICIONA o 9º dígito
     if (clean.length === 10) {
       clean = clean.substring(0, 2) + '9' + clean.substring(2);
-      console.log('📤 9º dígito ADICIONADO para envio (DDD ≤ 11):', phone, '→', clean);
+      console.log('📤 9º dígito ADICIONADO para envio (DDD ≤ 30):', phone, '→', clean);
     }
-  } else if (ddd >= 31) {
-    // Sudeste/Sul/Centro-Oeste: Se tem 11 dígitos e começa com 9, REMOVE o 9º dígito
+  } else if (ddd > 30) {
+    // Demais regiões: Se tem 11 dígitos e começa com 9, REMOVE o 9º dígito
     if (clean.length === 11 && clean[2] === '9') {
       clean = clean.substring(0, 2) + clean.substring(3);
-      console.log('📤 9º dígito REMOVIDO para envio (DDD ≥ 31):', phone, '→', clean);
+      console.log('📤 9º dígito REMOVIDO para envio (DDD > 30):', phone, '→', clean);
     }
   }
   
   return '55' + clean + '@s.whatsapp.net';
 }
 
 function delay(ms) {
   return new Promise(resolve => setTimeout(resolve, ms));
 }
 
 function createApp(tenantManager, supabaseHelper) {
   const app = express();
   app.use(cors());
   app.use(express.json());
 
   app.use((req, res, next) => {
     const tenantId = req.headers['x-tenant-id'] || req.query.tenant_id;
     req.tenantId = tenantId;
     next();
   });
 
   app.get('/health', (req, res) => {
     res.json({ status: 'ok', timestamp: new Date().toISOString() });
   });
 
@@ -1306,81 +1315,83 @@ function createApp(tenantManager, supabaseHelper) {
         errorMessage = 'Sem autorização para enviar neste grupo. Verifique se o bot está no grupo.';
       } else if (error.message.includes('rate-limit') || error.message.includes('429')) {
         errorType = 'rate-limit';
         errorMessage = 'Limite de mensagens atingido. Aguarde alguns minutos.';
       } else if (error.message.includes('invalid') || error.message.includes('not found')) {
         errorType = 'invalid-group';
         errorMessage = 'Grupo não encontrado ou ID inválido.';
       }
       
       console.error(`   Tipo identificado: ${errorType}`);
       console.error(`   Stack:`, error.stack);
       console.log(`${'='.repeat(70)}\n`);
       
       res.status(statusCode).json({ 
         success: false, 
         error: errorMessage,
         error_type: errorType,
         details: error.message
       });
     }
   });
 
   // Nova rota: SendFlow com fila de mensagens (batch)
   app.post('/sendflow-batch', async (req, res) => {
     const { tenantId } = req;
-    const { messages } = req.body; // Array de { groupId, message, productName }
+    const { messages } = req.body; // Array de { groupId, message, productName, groupName?, delayAfterMs? }
 
     console.log(`\n${'='.repeat(70)}`);
     console.log(`📦 SENDFLOW BATCH - Recebendo lote de mensagens`);
     console.log(`${'='.repeat(70)}`);
     console.log(`🏢 Tenant ID: ${tenantId}`);
     console.log(`📨 Total de mensagens: ${messages?.length || 0}`);
 
     if (!tenantId || !messages || !Array.isArray(messages) || messages.length === 0) {
       console.log(`❌ Parâmetros inválidos`);
       console.log(`${'='.repeat(70)}\n`);
       return res.status(400).json({ 
         success: false, 
         error: 'tenant_id e messages (array) são obrigatórios' 
       });
     }
 
       // Não bloquear enfileiramento caso a sessão esteja temporariamente indisponível.
       const isOnline = !!tenantManager?.getOnlineClient(tenantId);
       if (!isOnline) {
         console.log(`⚠️ Sessão não online no momento; as mensagens serão enfileiradas e enviadas quando o WhatsApp reconectar`);
       } else {
         console.log(`✅ Sessão online - adicionando ${messages.length} mensagens à fila`);
       }
 
     // Adicionar todas as mensagens na fila
     messages.forEach(msg => {
       tenantManager.messageQueue.enqueue(tenantId, {
         groupId: msg.groupId,
+        groupName: msg.groupName,
         message: msg.message,
-        productName: msg.productName || 'N/A'
+        productName: msg.productName || 'N/A',
+        delayAfterMs: typeof msg.delayAfterMs === 'number' ? Math.max(0, msg.delayAfterMs) : undefined
       });
     });
 
     console.log(`✅ ${messages.length} mensagens adicionadas à fila`);
     console.log(`${'='.repeat(70)}\n`);
 
     // Responder imediatamente
     res.json({ 
       success: true, 
       message: `${messages.length} mensagens adicionadas à fila`,
       queueSize: tenantManager.messageQueue.getQueueSize(tenantId)
     });
 
     // Iniciar processamento da fila (assíncrono) - TenantManager centraliza lógica de envio
     setImmediate(() => {
       if (tenantManager) {
         tenantManager.processQueueForTenant(tenantId).catch(err => {
           console.error('❌ Erro ao processar fila (processQueueForTenant):', err);
         });
       }
     });
   });
 
   app.post('/send', async (req, res) => {
     const { tenantId } = req;
 
EOF
)
