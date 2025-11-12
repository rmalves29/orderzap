/**
 * OrderZaps – WhatsApp Multi‑Tenant Server (Fixed)
 * v4.2
 *
 * Correções principais:
 * - Rotas /qr/:tenantId e /reset/:tenantId adicionadas
 * - /status e /status/:tenantId mais verbosas
 * - Carga de tenants a partir do Supabase (is_active=true)
 * - Sessões isoladas por tenant em AUTH_DIR/tenant_<id>
 * - Geração de QR em DataURL para consumo no frontend
 * - Puppeteer headless e flags compatíveis com Railway
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');

// Polyfill fetch em Node <18
if (typeof fetch !== 'function') {
  global.fetch = require('node-fetch');
}

// ======================== CONFIG ========================
const CONFIG = {
  PORT: process.env.PORT || 8080,
  AUTH_DIR: process.env.AUTH_DIR || path.join(__dirname, '.wwebjs_auth'),
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || 'http://localhost:8080',
};

if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n❌ Variáveis do Supabase ausentes.');
  console.error('  Necessárias: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Garante diretório base
fs.mkdirSync(CONFIG.AUTH_DIR, { recursive: true });

// ===================== SUPABASE HELPER ==================
const Supabase = {
  async request(pathname, init = {}) {
    const url = `${CONFIG.SUPABASE_URL}/rest/v1${pathname}`;
    const headers = {
      apikey: CONFIG.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${CONFIG.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    };
    const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase ${res.status}: ${text}`);
    }
    return res.json();
  },
  async loadActiveTenants() {
    // Espera tabela tenants com colunas: id (uuid), name, slug, is_active
    return this.request('/tenants?select=id,name,slug,is_active&is_active=eq.true');
  }
};

// ===================== TENANT MANAGER ===================
class TenantManager {
  constructor() {
    this.clients = new Map(); // id -> Client
    this.status = new Map();  // id -> status
    this.qr = new Map();      // id -> { raw, dataUrl, updatedAt }
    this.authDir = new Map(); // id -> path
  }

  getAuthDir(tenantId) {
    const dir = path.join(CONFIG.AUTH_DIR, `tenant_${tenantId}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.authDir.set(tenantId, dir);
    return dir;
  }

  async createClient(tenant) {
    const tenantId = tenant.id;
    const authPath = this.getAuthDir(tenantId);

    const client = new Client({
      authStrategy: new LocalAuth({ clientId: `tenant_${tenantId}`, dataPath: authPath }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
        timeout: 60000
      },
      qrMaxRetries: 10
    });

    // ---- Events
    client.on('qr', async (qr) => {
      try {
        const dataUrl = await QRCode.toDataURL(qr);
        this.qr.set(tenantId, { raw: qr, dataUrl, updatedAt: new Date().toISOString() });
        this.status.set(tenantId, 'qr_code');
        console.log(`📱 [${tenant.slug}] QR gerado`);
      } catch (e) {
        console.error(`Erro ao gerar DataURL do QR (${tenant.slug}):`, e.message);
      }
    });

    client.on('authenticated', () => {
      this.status.set(tenantId, 'authenticated');
      console.log(`🔐 [${tenant.slug}] autenticado`);
    });

    client.on('ready', () => {
      this.status.set(tenantId, 'online');
      console.log(`✅ [${tenant.slug}] pronto/online`);
    });

    client.on('auth_failure', (msg) => {
      this.status.set(tenantId, 'auth_failure');
      console.error(`❌ [${tenant.slug}] falha de autenticação: ${msg}`);
    });

    client.on('disconnected', (reason) => {
      this.status.set(tenantId, 'offline');
      console.warn(`🔌 [${tenant.slug}] desconectado (${reason}) – tentando reconectar em 10s`);
      setTimeout(() => client.initialize().catch(() => {}), 10000);
    });

    this.clients.set(tenantId, client);
    this.status.set(tenantId, 'initializing');

    // Start
    client.initialize().catch((e) => {
      this.status.set(tenantId, 'error');
      console.error(`💥 [${tenant.slug}] erro ao inicializar:`, e.message);
    });

    return client;
  }

  getClient(tenantId) { return this.clients.get(tenantId) || null; }
  getStatus(tenantId) { return this.status.get(tenantId) || 'not_found'; }
  getQR(tenantId) { return this.qr.get(tenantId) || null; }

  async resetTenant(tenantId) {
    const cli = this.clients.get(tenantId);
    if (cli) {
      try { await cli.logout().catch(() => {}); } catch (_) {}
      try { await cli.destroy().catch(() => {}); } catch (_) {}
      this.clients.delete(tenantId);
    }
    // remove pasta de sessão
    const dir = this.authDir.get(tenantId) || this.getAuthDir(tenantId);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    fs.mkdirSync(dir, { recursive: true });
    this.status.set(tenantId, 'reset');
    this.qr.delete(tenantId);
  }
}

const tenantsMgr = new TenantManager();

// ================ BOOT: carregar tenants ================
async function bootTenants() {
  console.log('🔍 Carregando tenants ativos do Supabase...');
  const tenants = await Supabase.loadActiveTenants();
  if (!tenants?.length) {
    console.warn('⚠️ Nenhum tenant ativo encontrado.');
    return;
  }
  console.log(`✅ ${tenants.length} tenant(s) encontrado(s). Inicializando...`);
  for (const t of tenants) {
    await tenantsMgr.createClient(t);
  }
}

// ======================= EXPRESS ========================
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health
app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'online', ts: new Date().toISOString(), version: '4.2' });
});

// Status global
app.get('/status', (req, res) => {
  const tenants = {};
  for (const [id] of tenantsMgr.clients) {
    tenants[id] = { status: tenantsMgr.getStatus(id), hasQR: !!tenantsMgr.getQR(id) };
  }
  res.json({ ok: true, tenants, total: Object.keys(tenants).length });
});

// Status por tenant
app.get('/status/:tenantId', (req, res) => {
  const { tenantId } = req.params;
  const status = tenantsMgr.getStatus(tenantId);
  res.json({ ok: true, tenantId, status, hasQR: !!tenantsMgr.getQR(tenantId) });
});

// QR por tenant
app.get('/qr/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  const qr = tenantsMgr.getQR(tenantId);
  if (!qr) return res.status(404).json({ ok: false, error: 'QR não disponível (ainda não gerado ou sessão ativa)' });
  res.json({ ok: true, tenantId, qr: qr.raw, qr_data_url: qr.dataUrl, updatedAt: qr.updatedAt });
});

// Reset por tenant
app.post('/reset/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  try {
    await tenantsMgr.resetTenant(tenantId);
    // Recarrega dados do tenant no Supabase e reinicializa
    const data = await Supabase.request(`/tenants?select=id,name,slug,is_active&id=eq.${tenantId}&limit=1`);
    const tenant = data?.[0];
    if (!tenant || tenant.is_active !== true) {
      return res.status(404).json({ ok: false, error: 'Tenant inativo ou inexistente' });
    }
    await tenantsMgr.createClient(tenant);
    res.json({ ok: true, tenantId, msg: 'Reset executado. Aguardando novo QR.' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'Erro no reset' });
  }
});

// Normalização simples de telefone (Brasil)
function normalizePhone(phone) {
  if (!phone) return phone;
  const clean = String(phone).replace(/\D/g, '');
  const base = clean.startsWith('55') ? clean.slice(2) : clean;
  let n = base;
  if (n.length === 10) n = n.slice(0, 2) + '9' + n.slice(2);
  return '55' + n;
}

// Envio de mensagem
app.post('/send', async (req, res) => {
  try {
    const tenantId = req.headers['x-tenant-id'] || req.body?.tenant_id;
    const { number, phone, message } = req.body || {};
    if (!tenantId) return res.status(400).json({ ok: false, error: 'tenant_id obrigatório' });
    if (!message) return res.status(400).json({ ok: false, error: 'message obrigatório' });

    const cli = tenantsMgr.getClient(tenantId);
    const status = tenantsMgr.getStatus(tenantId);
    if (!cli || status !== 'online') {
      return res.status(503).json({ ok: false, error: `WhatsApp offline para este tenant (status: ${status})` });
    }
    const dest = normalizePhone(number || phone);
    await cli.sendMessage(`${dest}@c.us`, message);
    res.json({ ok: true, tenantId, to: dest, sent: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'Erro ao enviar' });
  }
});

// 404
app.use((req, res) => res.status(404).json({ ok: false, error: 'Rota não encontrada' }));

// Start server
app.listen(CONFIG.PORT, () => {
  console.log(`\n✅ API online em ${CONFIG.PUBLIC_BASE_URL || 'http://localhost:' + CONFIG.PORT}`);
  console.log(`📂 AUTH_DIR: ${CONFIG.AUTH_DIR}`);
  bootTenants().catch((e) => console.error('Erro ao carregar tenants:', e.message));
});
