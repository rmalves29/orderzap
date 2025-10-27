 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/backend/server-multitenant-clean.js b/backend/server-multitenant-clean.js
index 0a9eebd01bc6ce51bf86a7089808d1c92578e786..9e931e1944226c793298477286b45c4522a3e551 100644
--- a/backend/server-multitenant-clean.js
+++ b/backend/server-multitenant-clean.js
@@ -377,69 +377,76 @@ class SupabaseHelper {
           message,
           type,
           sent_at: type === 'outgoing' ? new Date().toISOString() : null,
           received_at: type === 'incoming' ? new Date().toISOString() : null,
           ...metadata
         })
       });
     } catch (error) {
       console.error('⚠️ Erro ao salvar log no banco:', error.message);
     }
   }
 }
 
 /* ============================================================
    UTILITÁRIOS
    ============================================================ */
 
 /**
  * Normaliza número de telefone brasileiro para WhatsApp
  */
 function normalizePhone(phone) {
   if (!phone) return phone;
   
   const clean = phone.replace(/\D/g, '');
   const withoutDDI = clean.startsWith('55') ? clean.substring(2) : clean;
-  
-  let normalized = withoutDDI;
-  
-  // Adicionar 9º dígito se necessário
-  if (normalized.length >= 10 && normalized.length <= 11) {
-    const ddd = parseInt(normalized.substring(0, 2));
-    
-    if (ddd >= 11 && ddd <= 99) {
-      if (normalized.length === 10) {
-        const firstDigit = normalized[2];
-        if (firstDigit !== '9') {
-          normalized = normalized.substring(0, 2) + '9' + normalized.substring(2);
-          console.log(`✅ 9º dígito adicionado: ${phone} -> ${normalized}`);
-        }
-      }
+
+  if (withoutDDI.length < 10 || withoutDDI.length > 11) {
+    return '55' + withoutDDI;
+  }
+
+  const ddd = parseInt(withoutDDI.substring(0, 2));
+
+  if (Number.isNaN(ddd) || ddd < 11 || ddd > 99) {
+    return '55' + withoutDDI;
+  }
+
+  let number = withoutDDI.substring(2);
+
+  if (ddd <= 30) {
+    if (number.length === 8) {
+      number = '9' + number;
+      console.log(`✅ 9º dígito adicionado (DDD ≤ 30): ${phone} -> ${ddd}${number}`);
+    }
+  } else if (ddd > 30) {
+    if (number.length === 9 && number.startsWith('9')) {
+      number = number.substring(1);
+      console.log(`✂️ 9º dígito removido (DDD > 30): ${phone} -> ${ddd}${number}`);
     }
   }
-  
-  return '55' + normalized;
+
+  return '55' + ddd.toString().padStart(2, '0') + number;
 }
 
 function delay(ms) {
   return new Promise(resolve => setTimeout(resolve, ms));
 }
 
 /* ============================================================
    EXPRESS APP
    ============================================================ */
 
 async function createApp(tenantManager) {
   const app = express();
   
   app.use(express.json({ limit: '10mb' }));
   app.use(cors());
 
   // Middleware: Extrair tenant_id
   app.use((req, res, next) => {
     let tenantId = 
       req.headers['x-tenant-id'] ||
       req.headers['X-Tenant-Id'] ||
       req.query.tenant_id ||
       req.body?.tenant_id;
 
     if (tenantId) {
 
EOF
)
