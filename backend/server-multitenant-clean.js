// server-multitenant-clean.js
// API WhatsApp multi-tenant — Railway
// Dep: express, cors, whatsapp-web.js, qrcode, fs-extra, path, dotenv (opcional)

const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const fs = require('fs-extra');
const path = require('path');

require('dotenv').config();

const app = express();
app.use(express.json());

// ===== CORS =====
const APP_ORIGIN = process.env.APP_ORIGIN || '*';
app.use(
  cors({
    origin: (origin, cb) => cb(null, true), // se quiser travar, troque para [APP_ORIGIN]
    credentials: true,
  })
);

// ===== Config =====
const PORT = process.env.PORT || 8080;
const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, 'wwebjs_auth');

// Prioridade:
// 1) PUPPETEER_EXECUTABLE_PATH (recomendado pela Railway)
// 2) CHROME_PATH (compatibilidade antiga)
// 3) caminho padrão do Chromium no container
const chromiumEnvVars = [
  'PUPPETEER_EXECUTABLE_PATH',
  'CHROME_PATH',
  'CHROME_BIN',
  'GOOGLE_CHROME_BIN',
  'GOOGLE_CHROME_SHIM',
  'PUPPETEER_CHROME_PATH',
];

const chromiumSystemCandidates = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/lib/chromium-browser/chrome',
  '/app/.cache/ms-playwright/chromium/chrome-linux/chrome',
];

function collectBundledChromium() {
  const bundled = [];
  const puppeteerBase = path.join(__dirname, 'node_modules', 'puppeteer', '.local-chromium');
  if (!fs.existsSync(puppeteerBase)) {
    return bundled;
  }

  for (const platformDir of fs.readdirSync(puppeteerBase)) {
    const chromiumDir = path.join(puppeteerBase, platformDir);
    try {
      if (!fs.statSync(chromiumDir).isDirectory()) continue;
    } catch (err) {
      continue;
    }

    const chromeCandidates = [
      path.join(chromiumDir, 'chrome-linux', 'chrome'),
      path.join(chromiumDir, 'chrome-win', 'chrome.exe'),
      path.join(chromiumDir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ];

    for (const candidate of chromeCandidates) {
      if (fs.existsSync(candidate)) {
        bundled.push(candidate);
      }
    }
  }

  return bundled;
}

const chromiumCandidates = Array.from(
  new Set([
    ...chromiumEnvVars.map((key) => process.env[key]).filter(Boolean),
    ...collectBundledChromium(),
    ...chromiumSystemCandidates,
  ])
);

function describeCandidate(candidate, diagnostics, origin) {
  if (!candidate) return null;
  const entry = { path: candidate, origin };
  try {
    const stats = fs.statSync(candidate);
    entry.type = stats.isDirectory() ? 'directory' : 'file';
    if (stats.isDirectory()) {
      entry.status = 'é um diretório';
      diagnostics.push(entry);
      return null;
    }

    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      entry.status = 'ok';
      diagnostics.push(entry);
      return candidate;
    } catch (accessErr) {
      entry.status = 'sem permissão de execução';
      entry.detail = accessErr.message;
      diagnostics.push(entry);
      return null;
    }
  } catch (err) {
    entry.status = err.code === 'ENOENT' ? 'não existe' : 'erro ao verificar';
    entry.detail = err.message;
    diagnostics.push(entry);
    return null;
  }
}

function resolveFromPath(diagnostics) {
  const binaries = ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome'];
  const PATH = process.env.PATH || '';
  for (const dir of PATH.split(path.delimiter)) {
    if (!dir) continue;
    for (const binary of binaries) {
      const candidate = path.join(dir, binary);
      const found = describeCandidate(candidate, diagnostics, 'PATH');
      if (found) return found;
    }
  }
  return null;
}

function formatDiagnostics(diagnostics) {
  if (!diagnostics.length) return 'nenhum caminho foi analisado';
  return diagnostics
    .map((entry) => {
      const detail = entry.detail ? ` (${entry.detail})` : '';
      return `- ${entry.path} [${entry.origin}]: ${entry.status}${detail}`;
    })
    .join('\n');
}

function resolveChromiumExecutable() {
  const diagnostics = [];

  for (const candidate of chromiumCandidates) {
    const found = describeCandidate(candidate, diagnostics, 'lista');
    if (found) {
      console.info('[Chromium] Usando', found);
      return found;
    }
  }

  const pathCandidate = resolveFromPath(diagnostics);
  if (pathCandidate) {
    console.info('[Chromium] Encontrado via PATH', pathCandidate);
    return pathCandidate;
  }

  const message = formatDiagnostics(diagnostics);
  console.error(
    'Nenhum executável do Chromium/Chrome encontrado. Defina PUPPETEER_EXECUTABLE_PATH com um caminho válido.\n' +
      message
  );
  return null;
}

const PUPPETEER_EXECUTABLE_PATH = resolveChromiumExecutable();

if (!PUPPETEER_EXECUTABLE_PATH) {
  throw new Error(
    'Não foi possível localizar o executável do Chromium. Configure a variável PUPPETEER_EXECUTABLE_PATH.'
  );
}

process.env.PUPPETEER_EXECUTABLE_PATH = PUPPETEER_EXECUTABLE_PATH;
if (!process.env.CHROME_PATH) {
  process.env.CHROME_PATH = PUPPETEER_EXECUTABLE_PATH;
}
if (!process.env.CHROME_BIN) {
  process.env.CHROME_BIN = PUPPETEER_EXECUTABLE_PATH;
}
if (!process.env.GOOGLE_CHROME_BIN) {
  process.env.GOOGLE_CHROME_BIN = PUPPETEER_EXECUTABLE_PATH;
}
if (!process.env.GOOGLE_CHROME_SHIM) {
  process.env.GOOGLE_CHROME_SHIM = PUPPETEER_EXECUTABLE_PATH;
}

fs.ensureDirSync(AUTH_DIR);

// ===== Estado em memória =====
/**
 * clients[tenantId] = {
 *   client,
 *   status: 'starting' | 'qr' | 'ready' | 'auth_failure' | 'disconnected' | 'error',
 *   qr: 'data:image/png;base64,...' | null,
 * }
 */
const clients = Object.create(null);

// ===== Helpers =====

// cria (ou retorna) um client de um tenant
async function ensureClient(tenantId) {
  if (clients[tenantId]?.client) return clients[tenantId];

  const sessionDir = path.join(AUTH_DIR, tenantId);
  fs.ensureDirSync(sessionDir);

  // Mesmo efeito do exemplo:
  // args: ['--no-sandbox', '--disable-setuid-sandbox', ...]
  const puppeteerArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-zygote',
    '--single-process',
  ];

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: tenantId,
      dataPath: AUTH_DIR,
    }),
    puppeteer: {
      // equivalente a executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
      executablePath: PUPPETEER_EXECUTABLE_PATH,
      headless: true,
      args: puppeteerArgs,
    },
  });

  clients[tenantId] = {
    client,
    status: 'starting',
    qr: null,
  };

  // Eventos
  client.on('qr', async (qr) => {
    try {
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1 });
      clients[tenantId].qr = dataUrl;
      clients[tenantId].status = 'qr';
      console.log(`[${tenantId}] QR gerado`);
    } catch (e) {
      console.error(`[${tenantId}] Falha ao gerar QR:`, e);
    }
  });

  client.on('ready', () => {
    clients[tenantId].status = 'ready';
    clients[tenantId].qr = null;
    console.log(`[${tenantId}] WhatsApp pronto`);
  });

  client.on('authenticated', () => {
    console.log(`[${tenantId}] Autenticado`);
  });

  client.on('auth_failure', (msg) => {
    clients[tenantId].status = 'auth_failure';
    console.error(`[${tenantId}] Falha de auth: ${msg}`);
  });

  client.on('disconnected', (reason) => {
    clients[tenantId].status = 'disconnected';
    console.warn(`[${tenantId}] Desconectado: ${reason}`);
  });

  client.on('change_state', (state) => {
    console.log(`[${tenantId}] Estado: ${state}`);
  });

  // Inicializa
  try {
    await client.initialize();
  } catch (e) {
    clients[tenantId].status = 'error';
    console.error(`[${tenantId}] Erro ao inicializar client:`, e);
  }

  return clients[tenantId];
}

// derruba e apaga a sessão do tenant
async function resetTenant(tenantId) {
  const current = clients[tenantId];
  try {
    if (current?.client) {
      try {
        await current.client.destroy();
      } catch (_) {}
    }
  } catch (_) {}

  // remove pasta LocalAuth
  const sessionFolder = path.join(AUTH_DIR, tenantId);
  try {
    await fs.remove(sessionFolder);
  } catch (e) {
    console.warn(`[${tenantId}] Não conseguiu remover sessão:`, e.message);
  }

  delete clients[tenantId];
  console.log(`[${tenantId}] Sessão resetada`);
}

// ===== Rotas =====
app.get('/', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// status do tenant
app.get('/status/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  try {
    const entry = await ensureClient(tenantId);
    res.json({
      ok: true,
      tenantId,
      status: entry.status,
      hasQR: Boolean(entry.qr),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'erro status' });
  }
});

// último QR em cache (se existir)
app.get('/qr/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  try {
    const entry = await ensureClient(tenantId);
    if (entry.qr) {
      // retorna como DataURL (front exibe diretamente)
      res.json({ ok: true, tenantId, qr: entry.qr });
    } else {
      res.json({ ok: false, error: 'QR não disponível (ainda não gerado ou sessão ativa)' });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'erro qr' });
  }
});

// força reconexão (não apaga sessão)
app.post('/reconnect/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  try {
    const entry = clients[tenantId];
    if (entry?.client) {
      try {
        await entry.client.destroy();
      } catch (_) {}
      delete clients[tenantId];
    }
    const created = await ensureClient(tenantId);
    res.json({ ok: true, tenantId, status: created.status });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'erro reconnect' });
  }
});

// RESET total: apaga sessão + re-inicializa (gera novo QR do zero)
app.post('/reset/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  try {
    await resetTenant(tenantId);
    const created = await ensureClient(tenantId);
    res.json({ ok: true, tenantId, status: created.status });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'erro reset' });
  }
});

// ===== Start =====
app.listen(PORT, () => {
  console.log(`API online em :${PORT}`);
  console.log(`Auth dir: ${AUTH_DIR}`);
  console.log(`Chromium: ${PUPPETEER_EXECUTABLE_PATH}`);
});
