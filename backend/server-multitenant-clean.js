/**
 * server-multitenant-clean.js
 * OrderZap – Backend WhatsApp (Multi-tenant) usando Baileys
 *
 * Rotas:
 *  - GET  /health
 *  - GET  /status/:tenantId   -> { ok, tenantId, status: 'booting|qr|connecting|ready|error', hasQR, error? }
 *  - GET  /qr/:tenantId       -> { ok, qr } (dataURL) | { ok:false, error }
 *  - POST /reset/:tenantId    -> apaga auth do tenant e reinicia (gera novo QR)
 *  - POST /reconnect/:tenantId-> força reconexão mantendo auth
 *
 * ENV:
 *  - PORT (default 8080)
 *  - AUTH_DIR (default /data/webjs_auth)
 *  - NODE_ENV, etc.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  Browsers,
  useMultiFileAuthState,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

// -------------------- Config / Helpers --------------------

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const AUTH_DIR = process.env.AUTH_DIR || '/data/webjs_auth';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true } },
});

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDir(AUTH_DIR);

// Estado por tenant em memória
const tenants = new Map();
/**
 * Estrutura do state:
 * {
 *   tenantId,
 *   status: 'booting'|'qr'|'connecting'|'ready'|'error',
 *   error: null|string,
 *   hasQR: boolean,
 *   lastQR: null|string(dataURL),
 *   sock: WASocket|null,
 *   stop: async()=>void,
 * }
 */

// -------------------- Tenants Manager --------------------

async function startTenant(tenantId) {
  // Se já existe e está funcionando, só retorna
  const existing = tenants.get(tenantId);
  if (existing && existing.sock) return existing;

  const tenantPath = path.join(AUTH_DIR, tenantId);
  ensureDir(tenantPath);

  // Cria/atualiza estrutura base
  const state = {
    tenantId,
    status: 'booting',
    error: null,
    hasQR: false,
    lastQR: null,
    sock: null,
    stop: async () => {
      try {
        if (state.sock) {
          await state.sock?.logout?.().catch(() => {});
          try {
            // fecha conexão com cuidado
            state.sock?.ws?.close?.();
          } catch {}
        }
      } catch (e) {
        logger.warn({ tenantId, err: (e && e.message) || e }, '[stop] error');
      } finally {
        state.sock = null;
      }
    },
  };

  tenants.set(tenantId, state);

  // Baileys Auth multi-file
  const { state: authState, saveCreds } = await useMultiFileAuthState(tenantPath);

  // Cria o socket
  const sock = makeWASocket({
    logger,
    // Fake browser para reduzir ban/triggers
    browser: Browsers.appropriate('Chrome'),
    printQRInTerminal: false,
    auth: authState,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    // reconnection handled by on('connection.update')
  });

  state.sock = sock;
  state.status = 'connecting';

  // Eventos
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        state.lastQR = await QRCode.toDataURL(qr, { margin: 1, width: 300 });
        state.hasQR = true;
        state.status = 'qr';
        state.error = null;
        logger.info({ tenantId }, 'QR atualizado');
      } catch (e) {
        state.status = 'error';
        state.error = 'Falha ao gerar QR';
        logger.error({ tenantId, err: e?.message || e }, 'Erro QRCode');
      }
    }

    if (connection === 'open') {
      state.status = 'ready';
      state.hasQR = false;
      state.error = null;
      logger.info({ tenantId }, 'Conectado (ready)');
    } else if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      logger.warn({ tenantId, reason }, 'Conexão fechada');

      // Trata motivos comuns
      if (reason === DisconnectReason.loggedOut) {
        // sessão inválida — precisa resetar
        state.status = 'error';
        state.error = 'logged_out';
        state.hasQR = false;
        state.sock = null;
      } else {
        // tenta reconectar automaticamente
        state.status = 'connecting';
        try {
          await startTenant(tenantId);
        } catch (e) {
          state.status = 'error';
          state.error = 'reconnect_failed';
          logger.error({ tenantId, err: e?.message || e }, 'Falha ao reconectar');
        }
      }
    }
  });

  return state;
}

async function resetTenant(tenantId) {
  // apaga a pasta e reinicia
  const tenantPath = path.join(AUTH_DIR, tenantId);

  // para conexão atual
  const st = tenants.get(tenantId);
  if (st) {
    try {
      await st.stop();
    } catch {}
    tenants.delete(tenantId);
  }

  // remove auth
  try {
    if (fs.existsSync(tenantPath)) {
      fs.rmSync(tenantPath, { recursive: true, force: true });
    }
  } catch (e) {
    logger.warn({ tenantId, err: e?.message || e }, 'Erro removendo auth');
  }

  // volta a subir do zero (gera novo QR)
  return startTenant(tenantId);
}

async function reconnectTenant(tenantId) {
  const st = tenants.get(tenantId);
  if (!st) return startTenant(tenantId);

  try {
    await st.stop();
  } catch {}
  tenants.delete(tenantId);
  return startTenant(tenantId);
}

// -------------------- HTTP Server --------------------

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), tenants: tenants.size });
});

app.get('/status/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  try {
    const st = await startTenant(tenantId);
    res.json({
      ok: true,
      tenantId,
      status: st.status,
      hasQR: !!st.hasQR,
      error: st.error || null,
    });
  } catch (e) {
    logger.error({ tenantId, err: e?.message || e }, 'status error');
    res.status(500).json({ ok: false, tenantId, error: 'status_failed' });
  }
});

app.get('/qr/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  try {
    const st = await startTenant(tenantId);
    // Se já está conectado, não há QR
    if (st.status === 'ready') {
      return res.json({ ok: false, error: 'Sessão ativa (sem QR)' });
    }
    if (st.hasQR && st.lastQR) {
      return res.json({ ok: true, qr: st.lastQR });
    }
    return res.json({
      ok: false,
      error: 'QR não disponível (ainda não gerado ou sessão ativa)',
    });
  } catch (e) {
    logger.error({ tenantId, err: e?.message || e }, 'qr error');
    res.status(500).json({ ok: false, error: 'qr_failed' });
  }
});

app.post('/reset/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  try {
    await resetTenant(tenantId);
    res.json({ ok: true, tenantId, message: 'Sessão resetada. Gere/veja o novo QR.' });
  } catch (e) {
    logger.error({ tenantId, err: e?.message || e }, 'reset error');
    res.status(500).json({ ok: false, error: 'reset_failed' });
  }
});

app.post('/reconnect/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  try {
    await reconnectTenant(tenantId);
    res.json({ ok: true, tenantId, message: 'Reconectando...' });
  } catch (e) {
    logger.error({ tenantId, err: e?.message || e }, 'reconnect error');
    res.status(500).json({ ok: false, error: 'reconnect_failed' });
  }
});

// Rota opcional para listar tenants ativos em memória
app.get('/tenants', (_req, res) => {
  const list = Array.from(tenants.values()).map((t) => ({
    tenantId: t.tenantId,
    status: t.status,
    hasQR: t.hasQR,
    error: t.error || null,
  }));
  res.json({ ok: true, tenants: list });
});

// -------------------- Start --------------------

app.listen(PORT, () => {
  logger.info({ PORT, AUTH_DIR }, 'API online');
});
