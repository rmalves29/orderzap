import { useCallback, useEffect, useMemo, useState } from 'react';
// Reimplementado em 2025-10 após a limpeza do repositório.
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/hooks/useTenant';
import { supabaseTenant } from '@/lib/supabase-tenant';
import {
  Loader2,
  RefreshCw,
  Save,
  Send,
  Users,
  Package,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

interface Product {
  id: number;
  code: string;
  name: string;
  color?: string | null;
  size?: string | null;
  price: number;
  image_url?: string | null;
}

interface WhatsAppGroup {
  id: string;
  name: string;
  participantCount?: number;
}

const DEFAULT_TEMPLATE =
  '🛍️ *{{nome}}* ({{codigo}})\n\n' +
  '🎨 Cor: {{cor}}\n' +
  '📏 Tamanho: {{tamanho}}\n' +
  '💰 Valor: {{valor}}\n\n' +
  '📱 Para comprar, digite apenas o código: *{{codigo}}*';

export default function SendFlowPage() {
  const { toast } = useToast();
  const { tenant } = useTenant();

  const [products, setProducts] = useState<Product[]>([]);
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [messageTemplate, setMessageTemplate] = useState(DEFAULT_TEMPLATE);
  const [groupIntervalSeconds, setGroupIntervalSeconds] = useState(10);
  const [productIntervalMinutes, setProductIntervalMinutes] = useState(1);

  const [checkingConnection, setCheckingConnection] = useState(false);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingStage, setSendingStage] = useState<'idle' | 'validating' | 'sending' | 'completed'>(
    'idle',
  );
  const [queuedMessages, setQueuedMessages] = useState(0);

  const selectedProductList = useMemo(
    () => products.filter((product) => selectedProducts.has(product.id)),
    [products, selectedProducts],
  );

  const selectedGroupList = useMemo(
    () => groups.filter((group) => selectedGroups.has(group.id)),
    [groups, selectedGroups],
  );

  const canSend =
    selectedProductList.length > 0 &&
    selectedGroupList.length > 0 &&
    messageTemplate.trim().length > 0 &&
    whatsappConnected &&
    !sending;

  const formatPrice = (price: number) =>
    `R$ ${price.toFixed(2).replace('.', ',')}`;

  const personalizeMessage = (product: Product) =>
    messageTemplate
      .replace(/\{\{codigo\}\}/g, product.code)
      .replace(/\{\{nome\}\}/g, product.name)
      .replace(/\{\{cor\}\}/g, product.color || 'N/A')
      .replace(/\{\{tamanho\}\}/g, product.size || 'N/A')
      .replace(/\{\{valor\}\}/g, formatPrice(product.price));

  const toggleProduct = (productId: number) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  const toggleGroup = (groupId: string) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const toggleAllProducts = () => {
    setSelectedProducts((prev) => {
      if (selectedProductList.length === products.length && products.length > 0) {
        return new Set();
      }
      return new Set(products.map((product) => product.id));
    });
  };

  const toggleAllGroups = () => {
    setSelectedGroups((prev) => {
      if (selectedGroupList.length === groups.length && groups.length > 0) {
        return new Set();
      }
      return new Set(groups.map((group) => group.id));
    });
  };

  const checkWhatsAppConnection = useCallback(async () => {
    if (!tenant?.id) return;

    setCheckingConnection(true);

    try {
      const { data: integration, error } = await supabaseTenant
        .from('integration_whatsapp')
        .select('api_url')
        .eq('is_active', true)
        .maybeSingle();

      if (error || !integration?.api_url) {
        setWhatsappConnected(false);
        return;
      }

      const response = await fetch(`${integration.api_url}/status/${tenant.id}`, {
        headers: { 'x-tenant-id': tenant.id },
      });

      if (!response.ok) {
        setWhatsappConnected(false);
        return;
      }

      const payload = await response.json();
      setWhatsappConnected(payload.success && payload.status === 'online');
    } catch (error) {
      console.error('Erro ao verificar conexão do WhatsApp:', error);
      setWhatsappConnected(false);
    } finally {
      setCheckingConnection(false);
    }
  }, [tenant?.id]);

  const loadProducts = useCallback(async () => {
    if (!tenant?.id) {
      setProducts([]);
      return;
    }

    try {
      setLoadingProducts(true);
      const { data, error } = await supabaseTenant
        .from('products')
        .select('id, code, name, color, size, price, image_url')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;
      setProducts(data ?? []);
    } catch (error) {
      console.error('Erro ao carregar produtos:', error);
      toast({
        title: 'Erro ao carregar produtos',
        description: 'Não foi possível carregar o catálogo.',
        variant: 'destructive',
      });
    } finally {
      setLoadingProducts(false);
    }
  }, [tenant?.id, toast]);

  const loadGroups = useCallback(async () => {
    if (!tenant?.id) {
      setGroups([]);
      return;
    }

    try {
      setLoadingGroups(true);

      const { data: integration, error: integrationError } = await supabaseTenant
        .from('integration_whatsapp')
        .select('api_url')
        .eq('is_active', true)
        .maybeSingle();

      if (integrationError) throw integrationError;

      if (!integration?.api_url) {
        toast({
          title: 'Integração WhatsApp não configurada',
          description: 'Acesse Configurações > Integrações para definir a URL do servidor.',
          variant: 'destructive',
        });
        return;
      }

      const response = await fetch(`${integration.api_url}/list-all-groups`, {
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenant.id,
        },
      });

      if (!response.ok) {
        throw new Error('Falha ao buscar grupos do WhatsApp');
      }

      const payload = await response.json();

      if (!payload.success || !Array.isArray(payload.groups)) {
        setGroups([]);
        toast({
          title: 'Nenhum grupo encontrado',
          description: 'Verifique se o bot está conectado ao WhatsApp.',
        });
        return;
      }

      const maxGroups = tenant.max_whatsapp_groups ?? 0;
      const limited = maxGroups > 0 ? payload.groups.slice(0, maxGroups) : payload.groups;
      setGroups(limited);
      toast({
        title: 'Grupos carregados',
        description: `${limited.length} grupo(s) disponíveis`,
      });
    } catch (error) {
      console.error('Erro ao carregar grupos do WhatsApp:', error);
      toast({
        title: 'Erro ao carregar grupos',
        description: 'Não foi possível buscar os grupos conectados.',
        variant: 'destructive',
      });
      setGroups([]);
    } finally {
      setLoadingGroups(false);
    }
  }, [tenant?.id, tenant?.max_whatsapp_groups, toast]);

  const loadTemplate = useCallback(async () => {
    if (!tenant?.id) return;

    try {
      const { data, error } = await supabaseTenant
        .from('whatsapp_templates')
        .select('content')
        .eq('type', 'SENDFLOW')
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data?.content) {
        setMessageTemplate(data.content);
      } else {
        setMessageTemplate(DEFAULT_TEMPLATE);
      }
    } catch (error) {
      console.error('Erro ao carregar template do SendFlow:', error);
      toast({
        title: 'Erro ao carregar template',
        description: 'Utilizando mensagem padrão.',
      });
      setMessageTemplate(DEFAULT_TEMPLATE);
    }
  }, [tenant?.id, toast]);

  const saveTemplate = async () => {
    if (!messageTemplate.trim()) {
      toast({
        title: 'Template obrigatório',
        description: 'Digite o texto que será enviado aos clientes.',
        variant: 'destructive',
      });
      return;
    }

    setSavingTemplate(true);

    try {
      const { error } = await supabaseTenant
        .from('whatsapp_templates')
        .upsert(
          {
            type: 'SENDFLOW',
            title: 'SendFlow - Divulgação em Grupos',
            content: messageTemplate,
          },
          { onConflict: 'tenant_id,type' },
        );

      if (error) throw error;

      toast({ title: 'Template salvo com sucesso' });
    } catch (error) {
      console.error('Erro ao salvar template:', error);
      toast({
        title: 'Erro ao salvar template',
        description: 'Tente novamente em instantes.',
        variant: 'destructive',
      });
    } finally {
      setSavingTemplate(false);
    }
  };

  useEffect(() => {
    if (!tenant?.id) return;
    loadProducts();
    loadGroups();
    loadTemplate();
    checkWhatsAppConnection();
  }, [tenant?.id, loadProducts, loadGroups, loadTemplate, checkWhatsAppConnection]);

  const handleSendMessages = async () => {
    if (!tenant?.id) return;
    if (!canSend) return;

    setSending(true);
    setSendingStage('validating');

    try {
      const { data: integration, error: integrationError } = await supabaseTenant
        .from('integration_whatsapp')
        .select('api_url')
        .eq('is_active', true)
        .maybeSingle();

      if (integrationError || !integration?.api_url) {
        throw new Error('Integração WhatsApp não configurada');
      }

      const statusResponse = await fetch(`${integration.api_url}/status/${tenant.id}`, {
        headers: { 'x-tenant-id': tenant.id },
      });

      if (!statusResponse.ok) {
        throw new Error('Não foi possível validar a conexão do WhatsApp');
      }

      const statusPayload = await statusResponse.json();
      if (!statusPayload.success || statusPayload.status !== 'online') {
        toast({
          title: 'WhatsApp desconectado',
          description: 'Conecte o bot antes de iniciar o envio.',
          variant: 'destructive',
        });
        setSendingStage('idle');
        return;
      }

      setSendingStage('sending');

      const messages: Array<{
        groupId: string;
        groupName?: string;
        message: string;
        productName: string;
        delayAfterMs?: number;
      }> = [];

      selectedProductList.forEach((product, productIndex) => {
        const composedMessage = personalizeMessage(product);

        selectedGroupList.forEach((group, groupIndex) => {
          const isLastGroup = groupIndex === selectedGroupList.length - 1;
          const isLastProduct = productIndex === selectedProductList.length - 1;
          const delayAfterMs = isLastGroup
            ? isLastProduct
              ? 0
              : Math.max(0, productIntervalMinutes) * 60 * 1000
            : Math.max(0, groupIntervalSeconds) * 1000;

          messages.push({
            groupId: group.id,
            groupName: group.name,
            message: composedMessage,
            productName: product.name,
            delayAfterMs,
          });
        });
      });

      setQueuedMessages(messages.length);

      const response = await fetch(`${integration.api_url}/sendflow-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenant.id,
        },
        body: JSON.stringify({ messages }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || 'Falha ao enfileirar mensagens');
      }

      toast({
        title: 'Envio iniciado',
        description: `${messages.length} mensagens adicionadas à fila. O envio ocorre em segundo plano.`,
      });

      setSendingStage('completed');

      setTimeout(() => {
        setSendingStage('idle');
        setSelectedProducts(new Set());
        setSelectedGroups(new Set());
        setQueuedMessages(0);
      }, 3000);
    } catch (error) {
      console.error('Erro ao enviar mensagens do SendFlow:', error);
      toast({
        title: 'Erro ao enviar mensagens',
        description: error instanceof Error ? error.message : 'Tente novamente em instantes.',
        variant: 'destructive',
      });
      setSendingStage('idle');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">SendFlow</h1>
          <p className="text-muted-foreground">
            Dispare seus produtos para múltiplos grupos de WhatsApp com intervalos controlados.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={checkWhatsAppConnection}
            disabled={checkingConnection}
          >
            {checkingConnection ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Verificar conexão</span>
          </Button>
          <Badge variant={whatsappConnected ? 'default' : 'destructive'}>
            {whatsappConnected ? (
              <>
                <CheckCircle2 className="mr-1 h-3 w-3" /> Conectado
              </>
            ) : (
              <>
                <XCircle className="mr-1 h-3 w-3" /> Desconectado
              </>
            )}
          </Badge>
        </div>
      </div>

      {!whatsappConnected && (
        <Card className="border-destructive bg-destructive/10">
          <CardHeader>
            <CardTitle className="text-destructive">WhatsApp desconectado</CardTitle>
            <CardDescription>
              Conecte o bot na página "Conexão WhatsApp" antes de iniciar uma campanha.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="h-full">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                <CardTitle>Grupos do WhatsApp</CardTitle>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={loadGroups} disabled={loadingGroups}>
                  {loadingGroups ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  <span className="ml-2">Atualizar</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleAllGroups}
                  disabled={groups.length === 0}
                >
                  {selectedGroups.size === groups.length && groups.length > 0
                    ? 'Desmarcar todos'
                    : 'Selecionar todos'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[440px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[48px]" />
                    <TableHead>Nome</TableHead>
                    <TableHead>Participantes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                        Nenhum grupo disponível.
                      </TableCell>
                    </TableRow>
                  ) : (
                    groups.map((group) => (
                      <TableRow key={group.id} className="cursor-pointer" onClick={() => toggleGroup(group.id)}>
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            checked={selectedGroups.has(group.id)}
                            onCheckedChange={() => toggleGroup(group.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{group.name}</TableCell>
                        <TableCell>{group.participantCount ?? '—'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                <CardTitle>Produtos</CardTitle>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={loadProducts} disabled={loadingProducts}>
                  {loadingProducts ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  <span className="ml-2">Atualizar</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleAllProducts}
                  disabled={products.length === 0}
                >
                  {selectedProducts.size === products.length && products.length > 0
                    ? 'Desmarcar todos'
                    : 'Selecionar todos'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[440px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[48px]" />
                    <TableHead>Nome</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Preço</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        Nenhum produto ativo encontrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    products.map((product) => (
                      <TableRow
                        key={product.id}
                        className="cursor-pointer"
                        onClick={() => toggleProduct(product.id)}
                      >
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            checked={selectedProducts.has(product.id)}
                            onCheckedChange={() => toggleProduct(product.id)}
                          />
                        </TableCell>
                        <TableCell className="max-w-[240px] truncate font-medium">
                          {product.name}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{product.code}</Badge>
                        </TableCell>
                        <TableCell>{formatPrice(product.price)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Template da mensagem</CardTitle>
          <CardDescription>
            Use as variáveis {{codigo}}, {{nome}}, {{cor}}, {{tamanho}} e {{valor}} para personalizar o texto.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={messageTemplate}
            onChange={(event) => setMessageTemplate(event.target.value)}
            rows={8}
            placeholder="Digite o template a ser enviado..."
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setMessageTemplate(DEFAULT_TEMPLATE)}>
              Restaurar padrão
            </Button>
            <Button onClick={saveTemplate} disabled={savingTemplate}>
              {savingTemplate ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Salvar template
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Intervalos de envio</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="group-delay">Pausa entre grupos (segundos)</Label>
            <Input
              id="group-delay"
              type="number"
              min={0}
              value={groupIntervalSeconds}
              onChange={(event) => setGroupIntervalSeconds(Number(event.target.value) || 0)}
            />
            <p className="text-sm text-muted-foreground">
              Intervalo aplicado após enviar o mesmo produto em um grupo.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-delay">Pausa entre produtos (minutos)</Label>
            <Input
              id="product-delay"
              type="number"
              min={0}
              step={0.5}
              value={productIntervalMinutes}
              onChange={(event) => setProductIntervalMinutes(Number(event.target.value) || 0)}
            />
            <p className="text-sm text-muted-foreground">
              Intervalo aplicado antes de iniciar o envio do próximo produto.
            </p>
          </div>
        </CardContent>
      </Card>

      {sendingStage !== 'idle' && (
        <Card className="border-primary bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {sendingStage === 'validating' && (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" /> Validando conexão...
                </>
              )}
              {sendingStage === 'sending' && (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" /> Enfileirando mensagens...
                </>
              )}
              {sendingStage === 'completed' && (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-500" /> Envio iniciado com sucesso!
                </>
              )}
            </CardTitle>
            <CardDescription>
              {sendingStage === 'validating' && 'Verificando se o WhatsApp está conectado...'}
              {sendingStage === 'sending' &&
                `Gerando ${selectedProductList.length * selectedGroupList.length} mensagens...`}
              {sendingStage === 'completed' &&
                `${queuedMessages} mensagem(ns) adicionadas à fila. Elas serão enviadas respeitando os intervalos configurados.`}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="flex flex-col items-center gap-4">
        <div className="text-sm text-muted-foreground">
          {selectedProductList.length} produto(s) × {selectedGroupList.length} grupo(s) ={' '}
          {selectedProductList.length * selectedGroupList.length} mensagens
        </div>
        <Button
          size="lg"
          className="w-full max-w-xl"
          onClick={handleSendMessages}
          disabled={!canSend}
        >
          {sending ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Enfileirando mensagens...
            </>
          ) : (
            <>
              <Send className="mr-2 h-5 w-5" /> Enviar campanha
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
