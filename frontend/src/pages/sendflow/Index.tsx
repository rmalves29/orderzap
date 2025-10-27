 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/frontend/src/pages/sendflow/Index.tsx b/frontend/src/pages/sendflow/Index.tsx
index f2588dd0b5411676573ecbb286b96d4f2ba7791c..5e2f3500bfc9cfe722006ce82f6ca19284cb36a6 100644
--- a/frontend/src/pages/sendflow/Index.tsx
+++ b/frontend/src/pages/sendflow/Index.tsx
@@ -1,67 +1,67 @@
 import { useState, useEffect } from 'react';
 import { supabaseTenant } from '@/lib/supabase-tenant';
 import { useToast } from '@/hooks/use-toast';
 import { useTenant } from '@/hooks/useTenant';
 import { Button } from '@/components/ui/button';
 import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
 import { Checkbox } from '@/components/ui/checkbox';
 import { Textarea } from '@/components/ui/textarea';
 import { Input } from '@/components/ui/input';
 import { Label } from '@/components/ui/label';
 import { Badge } from '@/components/ui/badge';
 import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
-import { Loader2, Send, Save, Users, Package, Clock, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
-import { Separator } from '@/components/ui/separator';
+import { Loader2, Send, Save, Users, Package, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
 
 interface Product {
   id: number;
   code: string;
   name: string;
   color?: string;
   size?: string;
   price: number;
   image_url?: string;
 }
 
 interface WhatsAppGroup {
   id: string;
   name: string;
   participantCount?: number;
 }
 
 export default function SendFlow() {
   const { toast } = useToast();
   const { tenant } = useTenant();
 
   // Estados principais
   const [products, setProducts] = useState<Product[]>([]);
   const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
   const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set());
   const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
   const [messageTemplate, setMessageTemplate] = useState('');
-  const [intervalSeconds, setIntervalSeconds] = useState(30);
+  const [groupIntervalSeconds, setGroupIntervalSeconds] = useState(10);
+  const [productIntervalMinutes, setProductIntervalMinutes] = useState(1);
   
   // Estados de controle
   const [loading, setLoading] = useState(false);
   const [loadingGroups, setLoadingGroups] = useState(false);
   const [sending, setSending] = useState(false);
   const [sendingStatus, setSendingStatus] = useState<'idle' | 'validating' | 'sending' | 'completed'>('idle');
   const [totalMessages, setTotalMessages] = useState(0);
   const [whatsappConnected, setWhatsappConnected] = useState(false);
   const [checkingConnection, setCheckingConnection] = useState(false);
 
   // Carregar dados iniciais
   useEffect(() => {
     if (tenant?.id) {
       loadProducts();
       loadTemplate();
       loadGroups();
       checkWhatsAppConnection();
     }
   }, [tenant?.id]);
 
   const checkWhatsAppConnection = async () => {
     if (!tenant?.id) return;
 
     setCheckingConnection(true);
     try {
@@ -346,86 +346,92 @@ export default function SendFlow() {
         method: 'GET',
         headers: { 'x-tenant-id': tenant?.id || '' }
       });
 
       if (!statusResponse.ok) {
         throw new Error('Erro ao verificar status do WhatsApp');
       }
 
       const statusData = await statusResponse.json();
       
       if (!statusData.success || statusData.status !== 'online') {
         toast({
           title: 'WhatsApp não conectado',
           description: 'Conecte o WhatsApp antes de enviar mensagens',
           variant: 'destructive',
           duration: 8000
         });
         setSending(false);
         setSendingStatus('idle');
         return;
       }
 
       // 3. Preparar mensagens
       setSendingStatus('sending');
       const selectedProductArray = products.filter(p => selectedProducts.has(p.id));
-      const selectedGroupArray = Array.from(selectedGroups);
-      
-      const messages: Array<{ groupId: string; message: string; productName: string }> = [];
-      
-      selectedProductArray.forEach(product => {
+      const selectedGroupArray = groups.filter(g => selectedGroups.has(g.id));
+
+      const messages: Array<{ groupId: string; groupName?: string; message: string; productName: string; delayAfterMs?: number }> = [];
+
+      selectedProductArray.forEach((product, productIndex) => {
         const personalizedMessage = personalizeMessage(product);
-        selectedGroupArray.forEach(groupId => {
+        selectedGroupArray.forEach((group, groupIndex) => {
+          const isLastGroupForProduct = groupIndex === selectedGroupArray.length - 1;
+          const isLastProduct = productIndex === selectedProductArray.length - 1;
+          const delayAfterMs = isLastGroupForProduct
+            ? (isLastProduct ? 0 : Math.max(0, productIntervalMinutes) * 60 * 1000)
+            : Math.max(0, groupIntervalSeconds) * 1000;
+
           messages.push({
-            groupId,
+            groupId: group.id,
+            groupName: group.name,
             message: personalizedMessage,
-            productName: product.name
+            productName: product.name,
+            delayAfterMs
           });
         });
       });
 
       setTotalMessages(messages.length);
 
       console.log(`📦 Enviando ${messages.length} mensagens para o backend...`);
 
       // 4. Enviar todas as mensagens de uma vez para o backend (fila)
       const sendResponse = await fetch(`${integration.api_url}/sendflow-batch`, {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json',
           'x-tenant-id': tenant?.id || ''
         },
         body: JSON.stringify({ messages })
       });
 
       if (!sendResponse.ok) {
         const errorData = await sendResponse.json().catch(() => ({}));
         throw new Error(errorData.error || 'Erro ao enviar mensagens');
       }
 
-      const responseData = await sendResponse.json();
-
       toast({
         title: '✅ Envio iniciado!',
         description: `${messages.length} mensagens adicionadas à fila. O envio está acontecendo no background.`,
         duration: 10000
       });
 
       setSendingStatus('completed');
       
       // Resetar após 3 segundos
       setTimeout(() => {
         setSendingStatus('idle');
         setSelectedProducts(new Set());
         setSelectedGroups(new Set());
       }, 3000);
 
     } catch (error: any) {
       console.error('Erro ao enviar mensagens:', error);
       toast({
         title: 'Erro',
         description: error.message || 'Erro ao enviar mensagens',
         variant: 'destructive',
         duration: 8000
       });
       setSendingStatus('idle');
     } finally {
@@ -459,236 +465,268 @@ export default function SendFlow() {
               <>
                 <CheckCircle2 className="h-3 w-3 mr-1" />
                 WhatsApp Conectado
               </>
             ) : (
               <>
                 <XCircle className="h-3 w-3 mr-1" />
                 WhatsApp Desconectado
               </>
             )}
           </Badge>
         </div>
       </div>
 
       {!whatsappConnected && (
         <Card className="border-destructive">
           <CardHeader>
             <CardTitle className="text-destructive">⚠️ WhatsApp Desconectado</CardTitle>
             <CardDescription>
               Conecte o WhatsApp na página "Conexão WhatsApp" antes de enviar mensagens
             </CardDescription>
           </CardHeader>
         </Card>
       )}
 
-      {/* Grupos do WhatsApp */}
-      <Card>
-        <CardHeader>
-          <div className="flex justify-between items-center">
-            <div className="flex items-center gap-2">
-              <Users className="h-5 w-5" />
-              <CardTitle>Grupos do WhatsApp</CardTitle>
+      <div className="grid gap-6 xl:grid-cols-2">
+        {/* Grupos do WhatsApp */}
+        <Card className="h-full">
+          <CardHeader>
+            <div className="flex justify-between items-center">
+              <div className="flex items-center gap-2">
+                <Users className="h-5 w-5" />
+                <CardTitle>Grupos do WhatsApp</CardTitle>
+              </div>
+              <div className="flex gap-2">
+                <Button
+                  variant="outline"
+                  size="sm"
+                  onClick={loadGroups}
+                  disabled={loadingGroups}
+                >
+                  {loadingGroups ? (
+                    <Loader2 className="h-4 w-4 animate-spin" />
+                  ) : (
+                    <RefreshCw className="h-4 w-4" />
+                  )}
+                  <span className="ml-2">Atualizar</span>
+                </Button>
+                <Button
+                  variant="outline"
+                  size="sm"
+                  onClick={toggleAllGroups}
+                  disabled={groups.length === 0}
+                >
+                  {selectedGroups.size === groups.length ? 'Desmarcar Todos' : 'Selecionar Todos'}
+                </Button>
+              </div>
             </div>
-            <div className="flex gap-2">
-              <Button
-                variant="outline"
-                size="sm"
-                onClick={loadGroups}
-                disabled={loadingGroups}
-              >
-                {loadingGroups ? (
-                  <Loader2 className="h-4 w-4 animate-spin" />
-                ) : (
-                  <RefreshCw className="h-4 w-4" />
-                )}
-                <span className="ml-2">Atualizar</span>
-              </Button>
+            <CardDescription>
+              Selecione os grupos que receberão as mensagens ({selectedGroups.size} selecionado(s))
+            </CardDescription>
+          </CardHeader>
+          <CardContent className="max-h-[450px] overflow-y-auto pr-1">
+            {loadingGroups ? (
+              <div className="flex justify-center items-center py-8">
+                <Loader2 className="h-8 w-8 animate-spin" />
+              </div>
+            ) : groups.length === 0 ? (
+              <div className="text-center py-8 text-muted-foreground">
+                <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
+                <p>Nenhum grupo encontrado</p>
+                <p className="text-sm">Certifique-se de que o WhatsApp está conectado</p>
+              </div>
+            ) : (
+              <Table>
+                <TableHeader>
+                  <TableRow>
+                    <TableHead className="w-12">
+                      <Checkbox
+                        checked={selectedGroups.size === groups.length}
+                        onCheckedChange={toggleAllGroups}
+                      />
+                    </TableHead>
+                    <TableHead>Grupo</TableHead>
+                    <TableHead className="text-right">Participantes</TableHead>
+                  </TableRow>
+                </TableHeader>
+                <TableBody>
+                  {groups.map(group => (
+                    <TableRow key={group.id} className="cursor-pointer" onClick={() => toggleGroup(group.id)}>
+                      <TableCell>
+                        <Checkbox
+                          checked={selectedGroups.has(group.id)}
+                          onCheckedChange={() => toggleGroup(group.id)}
+                        />
+                      </TableCell>
+                      <TableCell className="font-medium">{group.name}</TableCell>
+                      <TableCell className="text-right">{group.participantCount ?? '-'}</TableCell>
+                    </TableRow>
+                  ))}
+                </TableBody>
+              </Table>
+            )}
+          </CardContent>
+        </Card>
+
+        {/* Produtos */}
+        <Card className="h-full">
+          <CardHeader>
+            <div className="flex justify-between items-center">
+              <div className="flex items-center gap-2">
+                <Package className="h-5 w-5" />
+                <CardTitle>Produtos</CardTitle>
+              </div>
               <Button
                 variant="outline"
                 size="sm"
-                onClick={toggleAllGroups}
-                disabled={groups.length === 0}
+                onClick={toggleAllProducts}
+                disabled={products.length === 0}
               >
-                {selectedGroups.size === groups.length ? 'Desmarcar Todos' : 'Selecionar Todos'}
+                {selectedProducts.size === products.length ? 'Desmarcar Todos' : 'Selecionar Todos'}
               </Button>
             </div>
-          </div>
-          <CardDescription>
-            Selecione os grupos que receberão as mensagens ({selectedGroups.size} selecionado(s))
-          </CardDescription>
-        </CardHeader>
-        <CardContent>
-          {loadingGroups ? (
-            <div className="flex justify-center items-center py-8">
-              <Loader2 className="h-8 w-8 animate-spin" />
-            </div>
-          ) : groups.length === 0 ? (
-            <div className="text-center py-8 text-muted-foreground">
-              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
-              <p>Nenhum grupo encontrado</p>
-              <p className="text-sm">Certifique-se de que o WhatsApp está conectado</p>
-            </div>
-          ) : (
-            <div className="space-y-3 max-h-64 overflow-y-auto">
-              {groups.map((group) => (
-                <div
-                  key={group.id}
-                  className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-accent cursor-pointer"
-                  onClick={() => toggleGroup(group.id)}
-                >
-                  <Checkbox
-                    checked={selectedGroups.has(group.id)}
-                    onCheckedChange={() => toggleGroup(group.id)}
-                  />
-                  <div className="flex-1">
-                    <p className="font-medium">{group.name}</p>
-                    {group.participantCount && (
-                      <p className="text-sm text-muted-foreground">
-                        {group.participantCount} participantes
-                      </p>
-                    )}
-                  </div>
-                </div>
-              ))}
-            </div>
-          )}
-        </CardContent>
-      </Card>
-
-      {/* Produtos */}
-      <Card>
-        <CardHeader>
-          <div className="flex justify-between items-center">
-            <div className="flex items-center gap-2">
-              <Package className="h-5 w-5" />
-              <CardTitle>Produtos</CardTitle>
-            </div>
-            <Button
-              variant="outline"
-              size="sm"
-              onClick={toggleAllProducts}
-              disabled={products.length === 0}
-            >
-              {selectedProducts.size === products.length ? 'Desmarcar Todos' : 'Selecionar Todos'}
-            </Button>
-          </div>
-          <CardDescription>
-            Selecione os produtos que serão enviados ({selectedProducts.size} selecionado(s))
-          </CardDescription>
-        </CardHeader>
-        <CardContent>
-          {loading ? (
-            <div className="flex justify-center items-center py-8">
-              <Loader2 className="h-8 w-8 animate-spin" />
-            </div>
-          ) : products.length === 0 ? (
-            <div className="text-center py-8 text-muted-foreground">
-              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
-              <p>Nenhum produto cadastrado</p>
-            </div>
-          ) : (
-            <Table>
-              <TableHeader>
-                <TableRow>
-                  <TableHead className="w-12"></TableHead>
-                  <TableHead>Código</TableHead>
-                  <TableHead>Nome</TableHead>
-                  <TableHead>Cor</TableHead>
-                  <TableHead>Tamanho</TableHead>
-                  <TableHead>Preço</TableHead>
-                </TableRow>
-              </TableHeader>
-              <TableBody>
-                {products.map((product) => (
-                  <TableRow
-                    key={product.id}
-                    className="cursor-pointer hover:bg-accent"
-                    onClick={() => toggleProduct(product.id)}
-                  >
-                    <TableCell>
-                      <Checkbox
-                        checked={selectedProducts.has(product.id)}
-                        onCheckedChange={() => toggleProduct(product.id)}
-                      />
-                    </TableCell>
-                    <TableCell className="font-mono">{product.code}</TableCell>
-                    <TableCell className="font-medium">{product.name}</TableCell>
-                    <TableCell>{product.color || '-'}</TableCell>
-                    <TableCell>{product.size || '-'}</TableCell>
-                    <TableCell>{formatPrice(product.price)}</TableCell>
+            <CardDescription>
+              Selecione os produtos que serão enviados ({selectedProducts.size} selecionado(s))
+            </CardDescription>
+          </CardHeader>
+          <CardContent className="max-h-[450px] overflow-y-auto pr-1">
+            {loading ? (
+              <div className="flex justify-center items-center py-8">
+                <Loader2 className="h-8 w-8 animate-spin" />
+              </div>
+            ) : products.length === 0 ? (
+              <div className="text-center py-8 text-muted-foreground">
+                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
+                <p>Nenhum produto cadastrado</p>
+              </div>
+            ) : (
+              <Table>
+                <TableHeader>
+                  <TableRow>
+                    <TableHead className="w-12"></TableHead>
+                    <TableHead>Código</TableHead>
+                    <TableHead>Nome</TableHead>
+                    <TableHead>Cor</TableHead>
+                    <TableHead>Tamanho</TableHead>
+                    <TableHead>Preço</TableHead>
                   </TableRow>
-                ))}
-              </TableBody>
-            </Table>
-          )}
-        </CardContent>
-      </Card>
+                </TableHeader>
+                <TableBody>
+                  {products.map((product) => (
+                    <TableRow
+                      key={product.id}
+                      className="cursor-pointer hover:bg-accent"
+                      onClick={() => toggleProduct(product.id)}
+                    >
+                      <TableCell>
+                        <Checkbox
+                          checked={selectedProducts.has(product.id)}
+                          onCheckedChange={() => toggleProduct(product.id)}
+                        />
+                      </TableCell>
+                      <TableCell className="font-mono">{product.code}</TableCell>
+                      <TableCell className="font-medium">{product.name}</TableCell>
+                      <TableCell>{product.color || '-'}</TableCell>
+                      <TableCell>{product.size || '-'}</TableCell>
+                      <TableCell>{formatPrice(product.price)}</TableCell>
+                    </TableRow>
+                  ))}
+                </TableBody>
+              </Table>
+            )}
+          </CardContent>
+        </Card>
+      </div>
 
       {/* Template de Mensagem */}
       <Card>
         <CardHeader>
           <CardTitle>Template de Mensagem</CardTitle>
           <CardDescription>
             Use as variáveis: {'{'}{'{'} codigo {'}'}{'}'}, {'{'}{'{'} nome {'}'}{'}'}, {'{'}{'{'} cor {'}'}{'}'}, {'{'}{'{'} tamanho {'}'}{'}'}, {'{'}{'{'} valor {'}'}{'}'}
           </CardDescription>
         </CardHeader>
         <CardContent className="space-y-4">
           <Textarea
             value={messageTemplate}
             onChange={(e) => setMessageTemplate(e.target.value)}
             rows={8}
             placeholder="Digite o template da mensagem..."
           />
           <div className="flex justify-end gap-2">
             <Button variant="outline" onClick={saveTemplate}>
               <Save className="h-4 w-4 mr-2" />
               Salvar Template
             </Button>
           </div>
         </CardContent>
       </Card>
 
       {/* Configurações de Envio */}
       <Card>
         <CardHeader>
           <CardTitle>Configurações de Envio</CardTitle>
         </CardHeader>
         <CardContent className="space-y-4">
-          <div>
-            <Label>Intervalo entre produtos (segundos)</Label>
-            <Input
-              type="number"
-              value={intervalSeconds}
-              onChange={(e) => setIntervalSeconds(Number(e.target.value))}
-              min="5"
-              max="300"
-            />
-            <p className="text-sm text-muted-foreground mt-1">
-              Tempo de espera após enviar todos os grupos de um produto
-            </p>
+          <div className="grid gap-4 sm:grid-cols-2">
+            <div>
+              <Label>Intervalo entre grupos (segundos)</Label>
+              <Input
+                type="number"
+                value={groupIntervalSeconds}
+                onChange={(e) => {
+                  const value = Number(e.target.value);
+                  setGroupIntervalSeconds(Number.isFinite(value) ? value : 0);
+                }}
+                min="0"
+                step="1"
+              />
+              <p className="text-sm text-muted-foreground mt-1">
+                Pausa entre o envio do mesmo produto em grupos diferentes
+              </p>
+            </div>
+            <div>
+              <Label>Intervalo entre produtos (minutos)</Label>
+              <Input
+                type="number"
+                value={productIntervalMinutes}
+                onChange={(e) => {
+                  const value = Number(e.target.value);
+                  setProductIntervalMinutes(Number.isFinite(value) ? value : 0);
+                }}
+                min="0"
+                step="0.5"
+              />
+              <p className="text-sm text-muted-foreground mt-1">
+                Pausa antes de iniciar o envio do próximo produto
+              </p>
+            </div>
           </div>
+          <p className="text-sm text-muted-foreground">
+            Os intervalos são aplicados automaticamente na fila de envio para reduzir o risco de bloqueio.
+          </p>
         </CardContent>
       </Card>
 
       {/* Status do Envio */}
       {sendingStatus !== 'idle' && (
         <Card className="border-primary">
           <CardHeader>
             <CardTitle className="flex items-center gap-2">
               {sendingStatus === 'validating' && (
                 <>
                   <Loader2 className="h-5 w-5 animate-spin" />
                   Validando conexão...
                 </>
               )}
               {sendingStatus === 'sending' && (
                 <>
                   <Loader2 className="h-5 w-5 animate-spin" />
                   Enviando mensagens...
                 </>
               )}
               {sendingStatus === 'completed' && (
                 <>
                   <CheckCircle2 className="h-5 w-5 text-green-500" />
                   Envio concluído!
                 </>
 
EOF
)
