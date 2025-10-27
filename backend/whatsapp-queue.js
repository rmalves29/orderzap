/**
 * Sistema de fila para envio de mensagens WhatsApp
 * Evite sobrecarga e lógica de repetição de gerenciamento 
 */

exportar classe WhatsAppQueue { 
  construtor() {
 isso.filas = novo Map();  tenantId -> array de mensagens 
 isso.processamento = novo Map();  tenantId -> booleano 
 isso.stats = new Map();  tenantId -> { enviado, falhou, pendente } 
  }

  /**
   * Adiciona uma mensagem na fila
   */
 enqueue(tenantId, mensagem) { 
 se (!isso.filas.has(tenantId)) { 
 isso.filas.set(tenantId, []); 
 isso.estatísticas.set(tenantId, { enviado: 0, falhou: 0, pendente: 0 }); 
    }

 const queue = this.filas.get(tenantId); 
 const normalizedMessage = { 
 ... Mensagem 
 atrasoDepoisMs: 
 typede mensagem.delayAfterMs === 'número' 
 ? Matemática.max(0, mensagem.atrasoDepoisMs) 
 : indefinido 
    };

 fila.empurrar({ 
 id: '${Date.now()}-${Math.random()}', 
      tenantId,
 ... Mensagens, 
 ... M essage normalizado, 
 tentativas: 0, 
 maxAttempts: 3, 
 createdAt: Data.agora() 
    });

 const stats = this.estatísticas.get(tenantId); 
 estatísticas.pendente++; 

    console.log(`📥 [Queue] Mensagem adicionada à fila do tenant ${tenantId}`);
 console.log(' Tamanho da fila: ${queue.length}'); 
 console.log(' Estatísticas:', estatísticas); 
  }

  /**
   * Processa a fila de um tenant
   */
 async processQueue(tenantId, sendFunction, validationFunction) { 
    // Evitar processamento concorrente
 se (isso.processamento.get(tenantId)) { 
      console.log(`⏳ [Queue] Já está processando fila do tenant ${tenantId}`);
      retornar;
    }

 const queue = this.filas.get(tenantId); 
 if (!queue || queue.comprimento === 0) { 
@@ -68,66 +76,70 @@ exportar classe WhatsAppQueue {
 const canSend = await validationFunction(tenantId); 
 if (!canSend) { 
        console.log(`❌ [Queue] Sessão inválida - pausando processamento`);
 isso.processamento.set(tenantId, false); 
        retornar;
      }

      tentar {
        console.log(`\n📤 [Queue] Processando mensagem ${message.id}`);
 console.log(' Tentativa: ${message.attempts + 1}/${message.maxAttempts}'); 
 console.log(' Grupo: ${message.groupId}'); 
 console.log(' Visualização: ${message.message.substring(0, 50)}...'); 

        // Tentar enviar
 await sendFunction(mensagem); 

        // Sucesso - remover da fila
 fila.deslocamento(); 
 estatísticas.enviado++; 
 estatísticas.pendente --; 

        console.log(`✅ [Queue] Mensagem enviada com sucesso`);
        console.log(`   Stats atualizadas:`, stats);

        // Aguardar intervalo entre mensagens (evitar rate limit)
 const atraso = 2000;  2 segundos 
        console.log(`⏳ [Queue] Aguardando ${delay}ms antes da próxima mensagem...`);
 await new Promise(resolve => setTimeout(resolve, delay)); 

 const atraso = 
 typede mensagem.delayAfterMs === 'número' ? mensagem.atrasoAfterMs : 2000;  recuo de 2s 
 if (atraso > 0) { 
          console.log(`⏳ [Queue] Aguardando ${delay}ms antes da próxima mensagem...`);
 await new Promise(resolve => setTimeout(resolve, delay)); 
        }
 } catch (erro) { 
 Mensagem.tentativas++; 
 Mensagem.lastError = erro.mensagem; 

        console.error(`\n❌ [Queue] Erro ao processar mensagem ${message.id}`);
 console.error(' Tentativa: ${message.attempts}/${message.maxAttempts}'); 
 console.error(' Erro: ${error.message}'); 

        // Se for erro de sessão, parar imediatamente
 if (erro.mensagem.includes('Sem sessões') || 
 erro.mensagem.includes('Conexão Fechada') || 
 erro.mensagem.includes('desconectado')) { 
        se (
 erro.mensagem.includes('Sem sessões') || 
 erro.mensagem.includes('Conexão Fechada') || 
 erro.mensagem.includes('desconectado') 
        ) {
          console.error(`🚫 [Queue] Erro de sessão detectado - parando processamento`);
 isso.processamento.set(tenantId, false); 
          retornar;
        }

        // Se atingiu max tentativas, remover da fila
 if (mensagem.tentativas >= mensagem.maxAttempts) { 
          console.error(`💀 [Queue] Mensagem ${message.id} excedeu máximo de tentativas - removendo`);
 fila.deslocamento(); 
 estatísticas.falhou++; 
 estatísticas.pendente --; 
        } mais {
          // Aguardar backoff antes de tentar novamente
 const recuo = mensagem.tentativas * 2000;  2s, 4s 
          console.log(`⏳ [Queue] Aguardando ${backoff}ms antes de tentar novamente...`);
 aguardar new Promise(resolve => setTimeout(resolve, backoff)); 
        }
      }
    }

 console.log('\n${'='.repeat(70)}'); 
    console.log(`✅ [Queue] Processamento concluído`);
 console.log(' Stats finais:', stats); 
 console.log('${'='.repeat(70)}\n'); 
