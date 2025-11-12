/**
 * =========================================================
 * WhatsApp Multi-Tenant Server (Railway Ready)
 * =========================================================
 * - Chromium via PUPPETEER_EXECUTABLE_PATH (/usr/bin/chromium)
 * - Headless + flags linux
 * - Sessões persistentes em AUTH_DIR (/data/.wwebjs_auth)
 * - Endpoints: /health, /status, /status/:id, /qr/:id, /reset/:id, /send
 * ---------------------------------------------------------
 * Autor: OrderZaps
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

// Polyfill fetch para Node < 18 (Railway usa 18+ normalmente, mas deixo seguro)
if (typeof fetch !== 'function') {
  global.fetch = require('node-fetch');
}

/* ============================
   CONFIG
   ============================ */
const CONFIG = {
  PORT: Number(process.env.PORT || 8080),
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_KEY:
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    '',
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || '',

  // onde as sessões do wwebjs ficam salvas (MONTAR UM VOLUME EM /data NO RAILWAY)
  AUTH_DIR: process.env.AUTH_DIR || path.join(process.cwd(), '.wwebjs_auth'),

  // chromium do sistema (instalado via NIXPACKS_PKGS)
  PUPPETEER_EXECUTABLE_PATH:
    process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',

  PUPPETEER_TIMEOUT: Number(process.env.PUPPETEER_TIMEOUT || 60000),
};

/* ============================
   SUPABASE HELPER
   ============================ */
class Supabase {
  static async req(pathname, options = {}) {
    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) {
      throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configurados');
    }
    const url = `${CONFIG.SUPABASE_URL}/rest/v1${pathname}`;
    const headers = {
      apikey: CONFIG.SUPABASE_KEY,
      Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase ${res.status}: ${text}`);
    }
    return res.json();
  }

  static async loadActiveTenants() {
    try {
      const rows = await this.req(
        '/tenants?select=id,name,slug,is_active&is_active=eq.true'
      );
      return rows || [];
    } catch (e) {
      console.error('❌ Supabase.loadActiveTenants:', e.message);
      return [];
    }
  }

  static async logMessage(tenant_id, phone, message, type, metadata = {}) {
    try {
      await this.req('/whatsapp_messages', {
        method: 'POST',
        body: JSON.stringify({
          tenant_id,
          phone,
          message,
          type,
          sent_at: type === 'outgoing' ? new Date().toISOString() : null,
          received_at: type === 'incoming' ? new Date().toISOString() : null,
          ...metadata,
        }),
      });
    } catch (e) {
      console.warn('⚠️ Falha ao logar mensagem no Supabase:', e.message);
    }
  }
}

/* ============================
   UTILS
   ============================ */
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function normalizePhoneBR(phone) {
  if (!phone) return phone;
  const clean = String(phone).replace(/\D/g, '');
  const withoutDDI = clean.startsWith('55') ? clean.slice(2) : clean;

  let n = withoutDDI;
  if (n.length === 10) {
    // acrescenta 9º dígito em celulares (aproximação segura)
    n = n.slice(0, 2) + '9' + n.slice(2);
  }
  return `55${n}`;
}

/* ============================
   TENANT MANAGER
   ============================ */
class TenantManager {
  constructor() {
    /** @type {Map<string, import('whatsapp-web.js').Client>} */
    this.clients = new Map();
    /** @type {Map<string, string>} */
    this.status = new Map(); // offline | initializing | qr_code | authenticated | online | error | auth_failure
    /** @type {Map<string, string>} */
    this.qrCache = new Map(); // tenantId -> dataURL do QR (atual)
    /** @type {Map<string, string>} */
    this.authDirs = new Map();
  }

  _tenantAuthDir(tenantId) {
    const dir = path.join(CONFIG.AUTH_DIR, `tenant_${tenantId}`);
    ensureDir(CONFIG.AUTH_DIR);
    ensureDir(dir);
    this.authDirs.set(tenantId, dir);
    return dir;
  }

  /**
   * Cria/Inicializa cliente de um tenant
   */
  async createClient(tenant) {
    const tenantId = tenant.id;
    const name = tenant.name || tenant.slug || tenantId;
    const authDir = this._tenantAuthDir(tenantId);

    console.log(
      `\n================= INIT TENANT =================\n` +
        `🧩 Tenant: ${name}\n` +
        `🆔 ID: ${tenantId}\n` +
        `📁 AuthDir: ${authDir}\n` +
        `==============================================\n`
    );

    const exe = CONFIG.PUPPETEER_EXECUTABLE_PATH || undefined;
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: `tenant_${tenantId}`,
        dataPath: authDir,
      }),
      puppeteer: {
        executablePath: exe, // chromium do sistema
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-software-rasterizer',
        ],
        timeout: CONFIG.PUPPETEER_TIMEOUT,
      },
      qrMaxRetries: 10,
    });

    /* -------- Eventos -------- */
    client.on('qr', async (qr) => {
      // Gerar dataURL para o frontend (qrcode lib opcional)
      try {
        const qrcode = require('qrcode');
        const dataUrl = await qrcode.toDataURL(qr, { margin: 1, scale: 6 });
        this.qrCache.set(tenantId, dataUrl);
        this.status.set(tenantId, 'qr_code');
        console.log(`📱 [${name}] QR gerado`);
      } catch (err) {
        console.warn(`⚠️ [${name}] Falha ao gerar dataURL do QR:`, err.message);
        this.qrCache.set(tenantId, '');
        this.status.set(tenantId, 'qr_code');
      }
    });

    client.on('loading_screen', (p) => {
      console.log(`⏳ [${name}] carregando ${p}%`);
    });

    client.on('authenticated', () => {
      this.status.set(tenantId, 'authenticated');
      // ao autenticar apaga QR cache
      this.qrCache.delete(tenantId);
      console.log(`🔐 [${name}] autenticado`);
    });

    client.on('ready', () => {
      this.status.set(tenantId, 'online');
      this.qrCache.delete(tenantId);
      console.log(`✅✅✅ [${name}] CONECTADO ✅✅✅`);
    });

    client.on('auth_failure', (msg) => {
      this.status.set(tenantId, 'auth_failure');
      console.error(`❌ [${name}] Falha de auth:`, msg);
    });

    client.on('disconnected', (reason) => {
      this.status.set(tenantId, 'offline');
      this.qrCache.delete(tenantId);
      console.warn(`🔌 [${name}] desconectado: ${reason}`);
    });

    /* -------- Inicialização -------- */
    try {
      this.status.set(tenantId, 'initializing');
      await client.initialize();
      this.clients.set(tenantId, client);
      return client;
    } catch (err) {
      this.status.set(tenantId, 'error');
      console.error(`💥 [${name}] erro ao iniciar:`, err.message);
      // dica de libs ausentes
      console.error(
        'TROUBLESHOOTING: verifique instalação do Chromium e libs: libasound2, libatk-bridge2.0-0, libatk1.0-0, libcairo2, libcups2, libdbus-1-3, libexpat1, libfontconfig1, libgbm1, libglib2.0-0, libgtk-3-0, libnspr4, libnss3, libpango-1.0-0, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxkbcommon0, libxrandr2, xdg-utils.'
      );
      return null;
    }
  }

  getClient(tenantId) {
    return this.clients.get(tenantId) || null;
  }

  getStatus(tenantId) {
    return this.status.get(tenantId) || 'not_found';
  }

  getAllStatus() {
    const out = {};
    for (const [id] of this.clients) {
      out[id] = {
        status: this.getStatus(id),
        hasClient: true,
        hasQR: this.qrCache.has(id),
      };
    }
    return out;
  }

  getQR(tenantId) {
    return this.qrCache.get(tenantId) || '';
  }

  async reset(tenantId) {
    const client = this.getClient(tenantId);
    try {
      if (client) {
        try {
          await client.destroy();
        } catch (e) {}
        this.clients.delete(tenantId);
      }
      this.qrCache.delete(tenantId);
      this.status.set(tenantId, 'initializing');

      // apaga diretório de sessão
      const authDir = this.authDirs.get(tenantId) || this._tenantAuthDir(tenantId);
      try {
        fs.rmSync(authDir, { recursive: true, force: true });
      } catch (_) {}
      ensureDir(authDir);

      return true;
    } catch (e) {
      console.error('reset error:', e.message);
      return false;
    }
  }
}

/* ============================
   EXPRESS APP
   ============================ */
async function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  const manager = new TenantManager();

  // carrega tenants e inicia clientes
  console.log('🔎 Carregando tenants ativos do Supabase...');
  const tenants = await Supabase.loadActiveTenants();
  console.log(`➡️ Encontrados ${tenants.length} tenant(s)`);

  for (const t of tenants) {
    await manager.createClient(t);
  }

  // --------- ROTAS ---------
  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      status: 'online',
      ts: new Date().toISOString(),
      port: CONFIG.PORT,
      publicBaseUrl: CONFIG.PUBLIC_BASE_URL || null,
    });
  });

  app.get('/status', (req, res) => {
    res.json({ ok: true, tenants: manager.getAllStatus() });
  });

  app.get('/status/:tenantId', (req, res) => {
    const { tenantId } = req.params;
    const st = manager.getStatus(tenantId);
    res.json({ ok: true, tenantId, status: st, hasQR: !!manager.getQR(tenantId) });
  });

  app.get('/qr/:tenantId', (req, res) => {
    const { tenantId } = req.params;
    const st = manager.getStatus(tenantId);
    if (st === 'qr_code') {
      const dataUrl = manager.getQR(tenantId);
      if (dataUrl) return res.json({ ok: true, tenantId, qr_data_url: dataUrl });
    }
    return res
      .status(404)
      .json({ ok: false, error: 'QR não disponível (ainda não gerado ou sessão ativa)' });
  });

  app.post('/reset/:tenantId', async (req, res) => {
    const { tenantId } = req.params;
    const ok = await manager.reset(tenantId);

    // Recria o cliente imediatamente (gera novo QR em seguida)
    const tenantsList = await Supabase.loadActiveTenants();
    const t = tenantsList.find((x) => x.id === tenantId);
    if (!t) {
      return res.status(404).json({ ok: false, error: 'Tenant não encontrado no banco' });
    }
    await manager.createClient(t);

    return res.json({ ok, tenantId });
  });

  app.post('/send', async (req, res) => {
    try {
      const { tenant_id, number, phone, message } = req.body || {};
      const tenantId =
        req.headers['x-tenant-id'] ||
        req.headers['X-Tenant-Id'] ||
        tenant_id;

      if (!tenantId) {
        return res.status(400).json({ ok: false, error: 'tenant_id obrigatorio' });
      }
      if (!message) {
        return res.status(400).json({ ok: false, error: 'message obrigatoria' });
      }
      const phoneRaw = number || phone;
      if (!phoneRaw) {
        return res.status(400).json({ ok: false, error: 'phone/number obrigatorio' });
      }

      const client = manager.getClient(tenantId);
      const st = manager.getStatus(tenantId);

      if (!client || !['online', 'authenticated'].includes(st)) {
        return res.status(503).json({
          ok: false,
          error: 'WhatsApp não está conectado para este tenant',
          status: st,
        });
      }

      const normalized = normalizePhoneBR(phoneRaw);
      await client.sendMessage(`${normalized}@c.us`, message);

      Supabase.logMessage(tenantId, normalized, message, 'outgoing').catch(() => {});
      return res.json({ ok: true, sent: true, to: normalized, tenantId });
    } catch (e) {
      console.error('❌ /send error:', e.message);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 404
  app.use((req, res) => res.status(404).json({ ok: false, error: 'Rota não encontrada' }));

  return { app, manager };
}

/* ============================
   BOOT
   ============================ */
(async () => {
  try {
    ensureDir(CONFIG.AUTH_DIR);

    const { app } = await createApp();
    app.listen(CONFIG.PORT, () => {
      console.log('\n==================================================');
      console.log('✅ API online em:', `http://localhost:${CONFIG.PORT}`);
      if (CONFIG.PUBLIC_BASE_URL) console.log('🌐 PUBLIC_BASE_URL:', CONFIG.PUBLIC_BASE_URL);
      console.log('📁 AUTH_DIR:', CONFIG.AUTH_DIR);
      console.log('🧭 Rotas: /health, /status, /status/:id, /qr/:id, /reset/:id, /send');
      console.log('==================================================\n');
    });
  } catch (e) {
    console.error('❌ Erro fatal de inicialização:', e);
    process.exit(1);
  }
})();
