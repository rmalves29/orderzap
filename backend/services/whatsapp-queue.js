 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/backend/services/whatsapp-queue.js b/backend/services/whatsapp-queue.js
index fd8fb354da0bdbdae766345e990f4035edb968dd..6c824dad278979d40932e96acfce6c358925bf99 100644
--- a/backend/services/whatsapp-queue.js
+++ b/backend/services/whatsapp-queue.js
@@ -1,51 +1,58 @@
 /**
  * Sistema de fila para envio de mensagens WhatsApp
  * Evita sobrecarga e gerencia retry logic
  */
 
 export class WhatsAppQueue {
   constructor() {
     this.queues = new Map(); // tenantId -> array de mensagens
     this.processing = new Map(); // tenantId -> boolean
     this.stats = new Map(); // tenantId -> { sent, failed, pending }
   }
 
   /**
    * Adiciona uma mensagem na fila
    */
   enqueue(tenantId, message) {
     if (!this.queues.has(tenantId)) {
       this.queues.set(tenantId, []);
       this.stats.set(tenantId, { sent: 0, failed: 0, pending: 0 });
     }
 
     const queue = this.queues.get(tenantId);
+    const normalizedMessage = {
+      ...message,
+      delayAfterMs: typeof message.delayAfterMs === 'number'
+        ? Math.max(0, message.delayAfterMs)
+        : undefined
+    };
+
     queue.push({
       id: `${Date.now()}-${Math.random()}`,
       tenantId,
-      ...message,
+      ...normalizedMessage,
       attempts: 0,
       maxAttempts: 3,
       createdAt: Date.now()
     });
 
     const stats = this.stats.get(tenantId);
     stats.pending++;
 
     console.log(`📥 [Queue] Mensagem adicionada à fila do tenant ${tenantId}`);
     console.log(`   Queue size: ${queue.length}`);
     console.log(`   Stats:`, stats);
   }
 
   /**
    * Processa a fila de um tenant
    */
   async processQueue(tenantId, sendFunction, validationFunction) {
     // Evitar processamento concorrente
     if (this.processing.get(tenantId)) {
       console.log(`⏳ [Queue] Já está processando fila do tenant ${tenantId}`);
       return;
     }
 
     const queue = this.queues.get(tenantId);
     if (!queue || queue.length === 0) {
@@ -68,53 +75,55 @@ export class WhatsAppQueue {
       const canSend = await validationFunction(tenantId);
       if (!canSend) {
         console.log(`❌ [Queue] Sessão inválida - pausando processamento`);
         this.processing.set(tenantId, false);
         return;
       }
 
       try {
         console.log(`\n📤 [Queue] Processando mensagem ${message.id}`);
         console.log(`   Tentativa: ${message.attempts + 1}/${message.maxAttempts}`);
         console.log(`   Grupo: ${message.groupId}`);
         console.log(`   Preview: ${message.message.substring(0, 50)}...`);
 
         // Tentar enviar
         await sendFunction(message);
 
         // Sucesso - remover da fila
         queue.shift();
         stats.sent++;
         stats.pending--;
 
         console.log(`✅ [Queue] Mensagem enviada com sucesso`);
         console.log(`   Stats atualizadas:`, stats);
 
         // Aguardar intervalo entre mensagens (evitar rate limit)
-        const delay = 2000; // 2 segundos
-        console.log(`⏳ [Queue] Aguardando ${delay}ms antes da próxima mensagem...`);
-        await new Promise(resolve => setTimeout(resolve, delay));
+        const delay = typeof message.delayAfterMs === 'number' ? message.delayAfterMs : 2000; // fallback 2s
+        if (delay > 0) {
+          console.log(`⏳ [Queue] Aguardando ${delay}ms antes da próxima mensagem...`);
+          await new Promise(resolve => setTimeout(resolve, delay));
+        }
 
       } catch (error) {
         message.attempts++;
         message.lastError = error.message;
 
         console.error(`\n❌ [Queue] Erro ao processar mensagem ${message.id}`);
         console.error(`   Tentativa: ${message.attempts}/${message.maxAttempts}`);
         console.error(`   Erro: ${error.message}`);
 
         // Se for erro de sessão, parar imediatamente
         if (error.message.includes('No sessions') || 
             error.message.includes('Connection Closed') ||
             error.message.includes('desconectado')) {
           console.error(`🚫 [Queue] Erro de sessão detectado - parando processamento`);
           this.processing.set(tenantId, false);
           return;
         }
 
         // Se atingiu max tentativas, remover da fila
         if (message.attempts >= message.maxAttempts) {
           console.error(`💀 [Queue] Mensagem ${message.id} excedeu máximo de tentativas - removendo`);
           queue.shift();
           stats.failed++;
           stats.pending--;
         } else {
 
EOF
)
