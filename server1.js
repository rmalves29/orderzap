#!/usr/bin/env node
// Loader recriado em 2025-10 para manter compatibilidade após limpeza do repositório.
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendEntry = path.join(__dirname, 'backend', 'server1.js');

try {
  await import(pathToFileURL(backendEntry).href);
} catch (error) {
  console.error('\n❌ Não foi possível carregar o backend/server1.js');
  console.error('   Caminho resolvido:', backendEntry);
  console.error('   Erro:', error);
  process.exitCode = 1;
}
