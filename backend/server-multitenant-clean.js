// backend/server-multitenant-clean.js
/**
 * OrderZap – Backend Multi-Tenant (limpo e verboso)
 * - Mantém nome do arquivo: server-multitenant-clean.js
 * - Rotas:
 *    GET /status/:tenantId
 *    GET /qr/:tenantId
 *    POST /reset/:tenantId
 * - Usa fila por tenant para evitar corrida
 * - Usa PUPPETEER_EXECUTABLE_PATH (Chromium do sistema, via Nixpacks)
 */

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuid } = require('uuid');
const http = require('http');

// ====== CONFIG BÁSICA ======
const PORT = process.env.PORT || 8080;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// Chromium (instalado via apt no Nixpacks)
const PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

// ====== APP ======
const app = express();
app.use(cors());
app.use(express.json());

// ====== SUPABASE ======
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[BOOT] Variáveis do Supabase ausentes.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ====== ESTADO EM MEMÓRIA ======
/**
 * tenantsState[tenantId] = {
 *   status: 'idle' | 'generating' | 'ready' | 'error',
 *   hasQR: boolean,
 *   lastError: string|undefined,
 *   queue: Promise<void> (cadeia de promessas pra serializar tarefas),
 *   sessionId: string | null
 * }
 */
const tenantsState = new Map();

function ensureTenant(tenantId) {
  if (!tenantsState.has(tenantId)) {
    tenantsState.set(tenantId, {
      status: 'idle',
      hasQR: false,
      lastError: undefined,
      queue: Promise.resolve(),
      sessionId: null,
    });
  }
  return tenantsState.get(tenantId);
}

function enqueue(tenantId, task) {
  const state = ensureTenant(tenantId);
  state.queue = state.queue.then(task).catch((err) => {
    // Captura qualquer erro não tratado dentro da tarefa
    console.error(`[${tenantId}] Erro na fila:`, err);
  });
  return state.queue;
}

// ====== HELPERS ======
async function getTenantRow(tenantId) {
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .single();

  if (error) throw new Error(`Supabase: ${error.message}`);
  if (!data) throw new Error('Tenant não encontrado');
  return data;
}

async function saveSessionStatus(tenantId, payload) {
  await supabase.from('wa_sessions').upsert({
    tenant_id: tenantId,
    ...payload,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id' });
}

function log(tenantId, ...args) {
  console.log(`[${new Date().toISOString()}][${tenantId}]`, ...args);
}

// ====== FAKE GERADOR DE QR (substitua pelo seu launch real) ======
/**
 * Aqui deveria entrar seu código de integração com Baileys/whatsapp-web.js.
 * Para fins de infraestrutura, simulamos o ciclo: gerar QR -> fica "ready".
 */
async function launchWhatsappForTenant(tenantId, options = {}) {
  const state = ensureTenant(tenantId);

  // Se já existe sessão ativa, apenas confirma status.
  if (state.status === 'ready') {
    log(tenantId, 'Sessão já ativa, não relaunch.');
    return;
  }

  state.status = 'generating';
  state.hasQR = false;
  state.lastError = undefined;

  log(tenantId, 'Iniciando geração de QR...');
  // Simula tempo para “baixar/abrir” Chromium e preparar a sessão
  await new Promise((r) => setTimeout(r, 3000));

  // Simula sucesso de QR
  state.hasQR = true;
  state.status = 'ready';
  state.sessionId = uuid();

  await saveSessionStatus(tenantId, {
    status: state.status,
    has_qr: state.hasQR,
    session_id: state.sessionId,
  });

  log(tenantId, 'QR pronto. Sessão marcada como ready.');
}

// ====== ROTAS ======

// Health
app.get('/', (_req, res) => {
  res.json({ ok: true, name: 'orderzaps-backend', time: new Date().toISOString() });
});

// Status do tenant
app.get('/status/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  ensureTenant(tenantId);
  const { status, hasQR } = tenantsState.get(tenantId);
  res.json({ ok: true, tenantId, status, hasQR });
});

// Força gerar/obter QR
app.get('/qr/:tenantId', async (req, res) => {
  const { tenantId } = req.params;

  try {
    // Garante que o tenant existe no banco (falha rápido se não existir)
    await getTenantRow(tenantId);
  } catch (err) {
    return res.status(404).json({ ok: false, error: String(err.message || err) });
  }

  // Serializa a geração para este tenant
  enqueue(tenantId, async () => {
    const state = ensureTenant(tenantId);
    if (state.status === 'generating') {
      log(tenantId, 'Já está gerando QR; não duplicar.');
      return;
    }
    await launchWhatsappForTenant(tenantId, { executablePath: PUPPETEER_EXECUTABLE_PATH });
  });

  res.json({ ok: true, message: 'Geração de QR iniciada (se necessário). Consulte /status/:tenantId.' });
});

// Reset de sessão (limpa e força novo QR no próximo /qr)
app.post('/reset/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  const state = ensureTenant(tenantId);

  enqueue(tenantId, async () => {
    state.status = 'idle';
    state.hasQR = false;
    state.sessionId = null;
    state.lastError = undefined;

    await saveSessionStatus(tenantId, {
      status: state.status,
      has_qr: state.hasQR,
      session_id: null,
    });

    log(tenantId, 'Sessão resetada; próximo /qr irá gerar novo QR.');
  });

  res.json({ ok: true, message: 'Sessão será resetada.' });
});

// ====== BOOT ======
const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`[BOOT] API online em http://0.0.0.0:${PORT}`);
  console.log(`[BOOT] ExecutablePath do Chromium: ${PUPPETEER_EXECUTABLE_PATH}`);
});
