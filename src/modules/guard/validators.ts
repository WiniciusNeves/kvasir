// Checksums that turn "looks like a CPF/card" into "is a valid CPF/card", cutting false positives.

function digitsOf(value: string): number[] {
  return value.replace(/\D/g, '').split('').map(Number);
}

function allSame(digits: number[]): boolean {
  return digits.every((digit) => digit === digits[0]);
}

export function luhn(value: string): boolean {
  const digits = digitsOf(value);
  if (digits.length < 13 || digits.length > 19 || allSame(digits)) return false;

  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let digit = digits[digits.length - 1 - i];
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

function checkDigit(digits: number[], weights: number[]): number {
  const sum = weights.reduce((total, weight, index) => total + digits[index] * weight, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isCpf(value: string): boolean {
  const digits = digitsOf(value);
  if (digits.length !== 11 || allSame(digits)) return false;

  const first = checkDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits[9] === first && digits[10] === second;
}

export function isCnpj(value: string): boolean {
  const digits = digitsOf(value);
  if (digits.length !== 14 || allSame(digits)) return false;

  const first = checkDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits[12] === first && digits[13] === second;
}

// Shannon entropy in bits per character: random keys score ~4.5+, words and code ~3.
export function entropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);

  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}
