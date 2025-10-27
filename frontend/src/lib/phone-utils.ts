/**
 * Utilities for normalising Brazilian phone numbers.
 *
 * Storage: DDD + number (no country code 55)
 * Sending: 55 + DDD + number
 */

const MIN_BRAZILIAN_DDD = 11;
const MAX_BRAZILIAN_DDD = 99;

function removeNonDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function stripBrazilCountryCode(clean: string): string {
  return clean.startsWith('55') ? clean.slice(2) : clean;
}

function applyRegionalMobileRules(clean: string): string {
  if (clean.length < 10) {
    return clean;
  }

  const dddString = clean.slice(0, 2);
  const ddd = Number(dddString);

  if (Number.isNaN(ddd) || ddd < MIN_BRAZILIAN_DDD || ddd > MAX_BRAZILIAN_DDD) {
    return clean;
  }

  let number = clean.slice(2);

  if (ddd <= 30) {
    // Norte/Nordeste: garantir o nono dígito
    if (number.length === 8) {
      number = `9${number}`;
    }
  } else {
    // Demais regiões: remover nono dígito se presente
    if (number.length === 9 && number.startsWith('9')) {
      number = number.slice(1);
    }
  }

  return `${dddString}${number}`;
}

/**
 * Normalises a phone number for storage in the database.
 * Removes the country code and guarantees the ninth digit for mobiles.
 */
export function normalizeForStorage(phone: string): string {
  if (!phone) return phone;

  const cleaned = stripBrazilCountryCode(removeNonDigits(phone));
  return applyRegionalMobileRules(cleaned);
}

/**
 * Normalises a phone number for sending (e.g., WhatsApp).
 * Ensures the ninth digit and prefixes the Brazil country code.
 */
export function normalizeForSending(phone: string): string {
  if (!phone) return phone;

  const clean = stripBrazilCountryCode(removeNonDigits(phone));
  const normalized = applyRegionalMobileRules(clean);

  if (normalized.length < 10 || normalized.length > 11) {
    console.warn('[phone-utils] Invalid phone length for sending', { phone, clean });
    return `55${normalized}`;
  }

  const ddd = Number(normalized.slice(0, 2));
  if (Number.isNaN(ddd) || ddd < MIN_BRAZILIAN_DDD || ddd > MAX_BRAZILIAN_DDD) {
    console.warn('[phone-utils] Invalid DDD detected', { phone, ddd });
    return `55${normalized}`;
  }

  return `55${normalized}`;
}

/**
 * Formats a phone number for display.
 * Shows it exactly as stored (DDD + number) with a friendly mask.
 */
export function formatPhoneForDisplay(phone: string): string {
  if (!phone) return phone;

  const cleanPhone = removeNonDigits(phone);
  const phoneWithoutDDI = applyRegionalMobileRules(stripBrazilCountryCode(cleanPhone));

  if (phoneWithoutDDI.length >= 10) {
    const ddd = phoneWithoutDDI.slice(0, 2);
    const number = phoneWithoutDDI.slice(2);

    if (number.length === 9) {
      return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
    }

    if (number.length === 8) {
      return `(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
    }
  }

  return phone;
}
