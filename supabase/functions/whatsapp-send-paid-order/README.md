# whatsapp-send-paid-order

Esta função edge envia o template "Pedido Pago" do tenant para o cliente assim que um pedido é marcado como pago. Ela normaliza o telefone seguindo as regras regionais (DDD até 30 ganha o nono dígito; DDD acima de 30 tem o nono removido) e registra o envio na tabela `whatsapp_messages`.

> Caso você não encontre o arquivo `index.ts` no repositório local, execute `git fetch` e `git checkout work` para garantir que está na mesma branch usada pelo deploy.

> Documento revisado em outubro/2025 após a recriação completa das funções edge.
