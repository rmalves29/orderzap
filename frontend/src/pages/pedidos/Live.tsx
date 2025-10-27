import { useCallback, useEffect, useMemo, useState } from 'react';
// Fluxo LIVE reconstruído em 2025-10 após a limpeza do repositório.
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Plus, RefreshCw, Search, Edit, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/hooks/useTenant';
import { supabaseTenant } from '@/lib/supabase-tenant';
import { supabase } from '@/integrations/supabase/client';
import {
  getBrasiliaDateISO,
  formatBrasiliaDate,
} from '@/lib/date-utils';
import {
  formatPhoneForDisplay,
  normalizeForStorage,
} from '@/lib/phone-utils';

const EVENT_TYPE = 'LIVE' as const;
const PHONE_MIN_LENGTH = 10;
const PHONE_MAX_LENGTH = 11;

interface Product {
  id: number;
  code: string;
  name: string;
  price: number;
  stock: number;
  image_url?: string | null;
  sale_type: 'LIVE' | 'BAZAR';
}

interface Order {
  id: number;
  customer_phone: string;
  total_amount: number;
  is_paid: boolean;
  created_at: string;
  event_type: string;
  cart_id: number | null;
}

export default function LiveOrdersPage() {
  const { toast } = useToast();
  const { tenant } = useTenant();

  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [itemsPerPage, setItemsPerPage] = useState('10');
  const [defaultInstagram, setDefaultInstagram] = useState('');
  const [instagramsByProduct, setInstagramsByProduct] = useState<Record<number, string>>({});
  const [quantitiesByProduct, setQuantitiesByProduct] = useState<Record<number, number>>({});
  const [processingProducts, setProcessingProducts] = useState<Set<number>>(new Set());
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editPhone, setEditPhone] = useState('');
  const [editAmount, setEditAmount] = useState('');

  const parsedItemsPerPage = useMemo(
    () => Math.max(1, Number(itemsPerPage) || 10),
    [itemsPerPage],
  );

  const buildProductSearchFilter = (query: string) => {
    if (!query) return undefined;

    const sanitized = query.trim();
    const digitsOnly = sanitized.replace(/[^0-9]/g, '');
    const filters = [
      `code.ilike.%${sanitized}%`,
      `name.ilike.%${sanitized}%`,
    ];

    if (digitsOnly) {
      filters.push(`code.ilike.%C${digitsOnly}%`);
    }

    return filters.join(',');
  };

  const loadProducts = useCallback(async () => {
    if (!tenant?.id) {
      setProducts([]);
      return;
    }

    try {
      setLoadingProducts(true);

      let query = supabaseTenant
        .from('products')
        .select('id, code, name, price, stock, image_url, sale_type')
        .eq('is_active', true)
        .eq('sale_type', EVENT_TYPE)
        .order('code')
        .limit(parsedItemsPerPage);

      const filter = buildProductSearchFilter(searchQuery);
      if (filter) {
        query = query.or(filter);
      }

      const { data, error } = await query;

      if (error) throw error;

      setProducts(data ?? []);
    } catch (error) {
      console.error('Erro ao carregar produtos da live:', error);
      toast({
        title: 'Erro ao carregar produtos',
        description: 'Não foi possível carregar os itens ativos para a live.',
        variant: 'destructive',
      });
    } finally {
      setLoadingProducts(false);
    }
  }, [tenant?.id, parsedItemsPerPage, searchQuery, toast]);

  const loadOrders = useCallback(async () => {
    if (!tenant?.id) {
      setOrders([]);
      return;
    }

    try {
      setLoadingOrders(true);

      const { data, error } = await supabaseTenant
        .from('orders')
        .select('id, customer_phone, total_amount, is_paid, created_at, event_type, cart_id')
        .eq('event_type', EVENT_TYPE)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setOrders(data ?? []);
    } catch (error) {
      console.error('Erro ao carregar pedidos da live:', error);
      toast({
        title: 'Erro ao carregar pedidos',
        description: 'Não foi possível recuperar os pedidos da live.',
        variant: 'destructive',
      });
    } finally {
      setLoadingOrders(false);
    }
  }, [tenant?.id, toast]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const setProductInstagram = (productId: number, value: string) => {
    setInstagramsByProduct((prev) => ({ ...prev, [productId]: value }));
  };

  const setProductQuantity = (productId: number, value: number) => {
    setQuantitiesByProduct((prev) => ({ ...prev, [productId]: Math.max(1, value) }));
  };

  const applyDefaultInstagramToVisibleProducts = () => {
    if (!defaultInstagram.trim()) return;

    setInstagramsByProduct((prev) => {
      const updated = { ...prev };
      products.forEach((product) => {
        updated[product.id] = defaultInstagram;
      });
      return updated;
    });
  };

  const normalizeInstagramHandle = (instagram: string) =>
    instagram.replace('@', '').trim().toLowerCase();

  const resolveCustomerPhone = async (instagram: string): Promise<string | null> => {
    const normalizedHandle = normalizeInstagramHandle(instagram);
    if (!normalizedHandle) return null;

    const { data, error } = await supabaseTenant
      .from('customers')
      .select('phone')
      .eq('instagram', normalizedHandle)
      .maybeSingle();

    if (error) {
      console.error('Erro ao buscar cliente por Instagram:', error);
      throw error;
    }

    if (!data?.phone) {
      return null;
    }

    const normalizedPhone = normalizeForStorage(data.phone);

    if (normalizedPhone !== data.phone) {
      await supabaseTenant
        .from('customers')
        .update({ phone: normalizedPhone })
        .eq('instagram', normalizedHandle);
    }

    return normalizedPhone;
  };

  const ensureOrderAndCart = async (
    normalizedPhone: string,
    subtotal: number,
    today: string,
  ): Promise<{ orderId: number; cartId: number; isNew: boolean }> => {
    const { data: existingOrders, error: existingOrdersError } = await supabaseTenant
      .from('orders')
      .select('id, cart_id, total_amount, event_type')
      .eq('customer_phone', normalizedPhone)
      .eq('event_date', today)
      .eq('is_paid', false)
      .eq('event_type', EVENT_TYPE)
      .order('created_at', { ascending: false })
      .limit(1);

    if (existingOrdersError) {
      throw existingOrdersError;
    }

    if (existingOrders && existingOrders.length > 0) {
      const order = existingOrders[0];
      const newTotal = Number(order.total_amount ?? 0) + subtotal;

      const { error: updateError } = await supabaseTenant
        .from('orders')
        .update({ total_amount: newTotal, event_type: EVENT_TYPE })
        .eq('id', order.id);

      if (updateError) throw updateError;

      if (order.cart_id) {
        return { orderId: order.id, cartId: order.cart_id, isNew: false };
      }

      const { data: createdCart, error: cartCreationError } = await supabaseTenant
        .from('carts')
        .insert({
          customer_phone: normalizedPhone,
          event_type: EVENT_TYPE,
          event_date: today,
          status: 'OPEN',
        })
        .select('id')
        .single();

      if (cartCreationError || !createdCart) {
        throw cartCreationError ?? new Error('Falha ao criar carrinho');
      }

      await supabaseTenant.from('orders').update({ cart_id: createdCart.id }).eq('id', order.id);

      return { orderId: order.id, cartId: createdCart.id, isNew: false };
    }

    const { data: newOrder, error: insertError } = await supabaseTenant
      .from('orders')
      .insert({
        customer_phone: normalizedPhone,
        event_type: EVENT_TYPE,
        event_date: today,
        total_amount: subtotal,
        is_paid: false,
      })
      .select('id')
      .single();

    if (insertError || !newOrder) {
      throw insertError ?? new Error('Falha ao criar pedido');
    }

    const { data: newCart, error: newCartError } = await supabaseTenant
      .from('carts')
      .insert({
        customer_phone: normalizedPhone,
        event_type: EVENT_TYPE,
        event_date: today,
        status: 'OPEN',
      })
      .select('id')
      .single();

    if (newCartError || !newCart) {
      throw newCartError ?? new Error('Falha ao criar carrinho');
    }

    await supabaseTenant.from('orders').update({ cart_id: newCart.id }).eq('id', newOrder.id);

    return { orderId: newOrder.id, cartId: newCart.id, isNew: true };
  };

  const handleLaunchSale = async (product: Product) => {
    const rawInstagram = instagramsByProduct[product.id]?.trim() || defaultInstagram.trim();
    const quantity = quantitiesByProduct[product.id] ?? 1;

    if (!rawInstagram) {
      toast({
        title: 'Instagram obrigatório',
        description: 'Informe o @ do cliente para lançar a venda.',
        variant: 'destructive',
      });
      return;
    }

    if (quantity > product.stock) {
      toast({
        title: 'Estoque insuficiente',
        description: `Restam apenas ${product.stock} unidade(s) disponíveis para este produto.`,
        variant: 'destructive',
      });
      return;
    }

    setProcessingProducts((prev) => new Set(prev).add(product.id));

    try {
      const customerPhone = await resolveCustomerPhone(rawInstagram);

      if (!customerPhone) {
        toast({
          title: 'Cliente não localizado',
          description: `Não encontramos telefone cadastrado para @${normalizeInstagramHandle(rawInstagram)}.`,
          variant: 'destructive',
        });
        return;
      }

      if (
        customerPhone.length < PHONE_MIN_LENGTH ||
        customerPhone.length > PHONE_MAX_LENGTH
      ) {
        toast({
          title: 'Telefone inválido',
          description: 'O telefone cadastrado para este cliente está incompleto.',
          variant: 'destructive',
        });
        return;
      }

      const today = getBrasiliaDateISO();
      const subtotal = product.price * quantity;

      const { orderId, cartId, isNew } = await ensureOrderAndCart(
        customerPhone,
        subtotal,
        today,
      );

      const { data: existingCartItem, error: fetchCartItemError } = await supabaseTenant
        .from('cart_items')
        .select('id, qty')
        .eq('cart_id', cartId)
        .eq('product_id', product.id)
        .maybeSingle();

      if (fetchCartItemError && fetchCartItemError.code !== 'PGRST116') {
        throw fetchCartItemError;
      }

      if (existingCartItem) {
        const { error: updateCartItemError } = await supabaseTenant
          .from('cart_items')
          .update({
            qty: (existingCartItem.qty ?? 0) + quantity,
            unit_price: product.price,
          })
          .eq('id', existingCartItem.id);

        if (updateCartItemError) throw updateCartItemError;
      } else {
        const { error: insertCartItemError } = await supabaseTenant.from('cart_items').insert({
          cart_id: cartId,
          product_id: product.id,
          qty: quantity,
          unit_price: product.price,
        });

        if (insertCartItemError) throw insertCartItemError;
      }

      const { error: stockUpdateError } = await supabaseTenant
        .from('products')
        .update({ stock: product.stock - quantity })
        .eq('id', product.id);

      if (stockUpdateError) throw stockUpdateError;

      setProducts((prev) =>
        prev.map((item) =>
          item.id === product.id ? { ...item, stock: item.stock - quantity } : item,
        ),
      );

      if (tenant?.id) {
        const { error: sendError } = await supabase.functions.invoke(
          'whatsapp-send-item-added',
          {
            body: {
              tenant_id: tenant.id,
              customer_phone: customerPhone,
              product_name: product.name,
              product_code: product.code,
              quantity,
              unit_price: product.price,
            },
          },
        );

        if (sendError) {
          console.error('Erro ao enviar mensagem WhatsApp:', sendError);
          toast({
            title: 'Pedido registrado',
            description:
              'O produto foi lançado, porém não foi possível enviar a mensagem automática.',
          });
        }
      }

      toast({
        title: 'Venda registrada',
        description: isNew
          ? `Novo pedido criado para @${normalizeInstagramHandle(rawInstagram)}`
          : `Pedido atualizado para @${normalizeInstagramHandle(rawInstagram)}`,
      });

      setInstagramsByProduct((prev) => ({ ...prev, [product.id]: '' }));
      setQuantitiesByProduct((prev) => ({ ...prev, [product.id]: 1 }));

      loadOrders();
    } catch (error) {
      console.error('Erro ao lançar venda da live:', error);
      toast({
        title: 'Erro ao lançar venda',
        description: 'Revise as informações e tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setProcessingProducts((prev) => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
    }
  };

  const openEditDialog = (order: Order) => {
    setEditingOrder(order);
    setEditPhone(order.customer_phone);
    setEditAmount(order.total_amount.toString());
  };

  const closeEditDialog = () => {
    setEditingOrder(null);
    setEditPhone('');
    setEditAmount('');
  };

  const handleUpdateOrder = async () => {
    if (!editingOrder) return;

    try {
      const normalizedPhone = normalizeForStorage(editPhone);
      const parsedAmount = Number(editAmount);

      if (!normalizedPhone || Number.isNaN(parsedAmount)) {
        toast({
          title: 'Dados inválidos',
          description: 'Informe um telefone e valor válidos.',
          variant: 'destructive',
        });
        return;
      }

      const { error } = await supabaseTenant
        .from('orders')
        .update({
          customer_phone: normalizedPhone,
          total_amount: parsedAmount,
          event_type: EVENT_TYPE,
        })
        .eq('id', editingOrder.id);

      if (error) throw error;

      toast({ title: 'Pedido atualizado com sucesso' });
      closeEditDialog();
      loadOrders();
    } catch (error) {
      console.error('Erro ao atualizar pedido da live:', error);
      toast({
        title: 'Erro ao atualizar pedido',
        description: 'Não foi possível salvar as alterações.',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteOrder = async (orderId: number) => {
    const confirmed = window.confirm('Tem certeza que deseja excluir este pedido?');
    if (!confirmed) return;

    try {
      const { error } = await supabaseTenant.from('orders').delete().eq('id', orderId);
      if (error) throw error;

      toast({ title: 'Pedido removido com sucesso' });
      loadOrders();
    } catch (error) {
      console.error('Erro ao excluir pedido da live:', error);
      toast({
        title: 'Erro ao excluir pedido',
        description: 'Tente novamente em instantes.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="p-6">
        <div className="container mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold">Pedidos Live</h1>
            <Button variant="outline" onClick={() => loadProducts()} disabled={loadingProducts}>
              {loadingProducts ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Atualizar produtos
            </Button>
          </div>

          <Tabs defaultValue="create" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="create">
                <Plus className="mr-2 h-4 w-4" />
                Criar pedido
              </TabsTrigger>
              <TabsTrigger value="manage">Gerenciar pedidos</TabsTrigger>
            </TabsList>

            <TabsContent value="create" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Controles</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="md:col-span-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.target.value)}
                          placeholder="Buscar por código (C123) ou nome"
                          className="pl-9"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Instagram padrão"
                        value={defaultInstagram}
                        onChange={(event) => setDefaultInstagram(event.target.value)}
                      />
                      <Button variant="outline" onClick={applyDefaultInstagramToVisibleProducts}>
                        Aplicar
                      </Button>
                    </div>

                    <div className="flex items-center gap-2">
                      <Select value={itemsPerPage} onValueChange={setItemsPerPage}>
                        <SelectTrigger>
                          <SelectValue placeholder="Itens por página" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10 itens</SelectItem>
                          <SelectItem value="20">20 itens</SelectItem>
                          <SelectItem value="50">50 itens</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="outline" onClick={loadProducts} disabled={loadingProducts}>
                        {loadingProducts ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-2 h-4 w-4" />
                        )}
                        Recarregar
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Produtos ativos da live</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>@ Instagram</TableHead>
                          <TableHead>Código</TableHead>
                          <TableHead>Produto</TableHead>
                          <TableHead>Estoque</TableHead>
                          <TableHead>Preço</TableHead>
                          <TableHead>Quantidade</TableHead>
                          <TableHead>Foto</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loadingProducts ? (
                          <TableRow>
                            <TableCell colSpan={8} className="py-8 text-center">
                              <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                            </TableCell>
                          </TableRow>
                        ) : products.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                              Nenhum produto ativo encontrado.
                            </TableCell>
                          </TableRow>
                        ) : (
                          products.map((product) => {
                            const instagramValue = instagramsByProduct[product.id] ?? '';
                            const quantityValue = quantitiesByProduct[product.id] ?? 1;
                            const isProcessing = processingProducts.has(product.id);

                            return (
                              <TableRow key={product.id}>
                                <TableCell className="whitespace-nowrap">
                                  <Input
                                    value={instagramValue}
                                    onChange={(event) =>
                                      setProductInstagram(product.id, event.target.value)
                                    }
                                    placeholder="@cliente"
                                    disabled={isProcessing}
                                  />
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline">{product.code}</Badge>
                                </TableCell>
                                <TableCell className="max-w-[240px] truncate">
                                  {product.name}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={product.stock > 0 ? 'default' : 'destructive'}>
                                    {product.stock}
                                  </Badge>
                                </TableCell>
                                <TableCell>R$ {product.price.toFixed(2)}</TableCell>
                                <TableCell>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={product.stock}
                                    value={quantityValue}
                                    onChange={(event) =>
                                      setProductQuantity(
                                        product.id,
                                        Number(event.target.value) || 1,
                                      )
                                    }
                                    disabled={isProcessing}
                                    className="w-24"
                                  />
                                </TableCell>
                                <TableCell>
                                  {product.image_url ? (
                                    <img
                                      src={product.image_url}
                                      alt={product.name}
                                      className="h-12 w-12 rounded object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-12 w-12 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                                      Sem foto
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    size="sm"
                                    onClick={() => handleLaunchSale(product)}
                                    disabled={isProcessing}
                                  >
                                    {isProcessing ? (
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : null}
                                    Lançar venda
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="manage" className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Pedidos registrados</CardTitle>
                    <Button variant="outline" onClick={loadOrders} disabled={loadingOrders}>
                      {loadingOrders ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      Atualizar lista
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>Telefone</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead>Total</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loadingOrders ? (
                          <TableRow>
                            <TableCell colSpan={6} className="py-8 text-center">
                              <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                            </TableCell>
                          </TableRow>
                        ) : orders.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                              Nenhum pedido de live encontrado.
                            </TableCell>
                          </TableRow>
                        ) : (
                          orders.map((order) => (
                            <TableRow key={order.id}>
                              <TableCell>#{order.id}</TableCell>
                              <TableCell>{formatPhoneForDisplay(order.customer_phone)}</TableCell>
                              <TableCell>{formatBrasiliaDate(order.created_at)}</TableCell>
                              <TableCell>R$ {Number(order.total_amount).toFixed(2)}</TableCell>
                              <TableCell>
                                <Badge variant={order.is_paid ? 'default' : 'secondary'}>
                                  {order.is_paid ? 'Pago' : 'Pendente'}
                                </Badge>
                              </TableCell>
                              <TableCell className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openEditDialog(order)}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleDeleteOrder(order.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Dialog open={!!editingOrder} onOpenChange={(open) => !open && closeEditDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar pedido #{editingOrder?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Telefone</label>
              <Input
                value={editPhone}
                onChange={(event) => setEditPhone(event.target.value)}
                placeholder="DDD + número"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Valor total</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={editAmount}
                onChange={(event) => setEditAmount(event.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeEditDialog}>
                Cancelar
              </Button>
              <Button onClick={handleUpdateOrder}>Salvar alterações</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
