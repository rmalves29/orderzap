export function normalizeForStorage(phone: string): string {
  if (!phone) return phone;
  let clean = String(phone).replace(/\D/g, '');

  // Remove DDI 55 se presente
  if (clean.startsWith('55')) {
    clean = clean.substring(2);
  }

  // Se tem 10 dígitos, adicionar 9º dígito após o DDD
  if (clean.length === 10) {
    const ddd = clean.substring(0, 2);
    const number = clean.substring(2);
    clean = ddd + '9' + number;
  }

  // Se já tem 11 dígitos, assume que está correto
  return clean;
}

export function normalizeForWhatsApp(phone: string): string {
  const storage = normalizeForStorage(phone) || '';
  // Prefixar DDI 55 para envio
  return '55' + storage;
}
