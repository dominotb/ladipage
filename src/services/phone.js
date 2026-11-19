const {
  parsePhoneNumberWithError,
  validatePhoneNumberLength,
  getCountryCallingCode,
  getExampleNumber,
} = require('libphonenumber-js/max');
const examples = require('libphonenumber-js/mobile/examples');

// Curated country list (Vietnam first, followed by common international regions)
const SUPPORTED_COUNTRIES = [
  { iso: 'VN', name: 'Việt Nam', dialCode: '+84', flag: '🇻🇳', placeholder: '0967 862 545' },
  { iso: 'US', name: 'Hoa Kỳ', dialCode: '+1', flag: '🇺🇸', placeholder: '(201) 555-0123' },
  { iso: 'CA', name: 'Canada', dialCode: '+1', flag: '🇨🇦', placeholder: '(506) 234-5678' },
  { iso: 'JP', name: 'Nhật Bản', dialCode: '+81', flag: '🇯🇵', placeholder: '090-1234-5678' },
  { iso: 'KR', name: 'Hàn Quốc', dialCode: '+82', flag: '🇰🇷', placeholder: '010-1234-5678' },
  { iso: 'AU', name: 'Úc', dialCode: '+61', flag: '🇦🇺', placeholder: '0412 345 678' },
  { iso: 'GB', name: 'Anh', dialCode: '+44', flag: '🇬🇧', placeholder: '07400 123456' },
  { iso: 'FR', name: 'Pháp', dialCode: '+33', flag: '🇫🇷', placeholder: '06 12 34 56 78' },
  { iso: 'DE', name: 'Đức', dialCode: '+49', flag: '🇩🇪', placeholder: '01512 3456789' },
  { iso: 'SG', name: 'Singapore', dialCode: '+65', flag: '🇸🇬', placeholder: '8123 4567' },
  { iso: 'TW', name: 'Đài Loan', dialCode: '+886', flag: '🇹🇼', placeholder: '0912 345 678' },
  { iso: 'CN', name: 'Trung Quốc', dialCode: '+86', flag: '🇨🇳', placeholder: '131 2345 6789' },
  { iso: 'HK', name: 'Hồng Kông', dialCode: '+852', flag: '🇭🇰', placeholder: '5123 4567' },
  { iso: 'TH', name: 'Thái Lan', dialCode: '+66', flag: '🇹🇭', placeholder: '081 234 5678' },
  { iso: 'MY', name: 'Malaysia', dialCode: '+60', flag: '🇲🇾', placeholder: '012-345 6789' },
  { iso: 'LA', name: 'Lào', dialCode: '+856', flag: '🇱🇦', placeholder: '020 23 123 456' },
  { iso: 'KH', name: 'Campuchia', dialCode: '+855', flag: '🇰🇭', placeholder: '091 234 567' },
  { iso: 'PH', name: 'Philippines', dialCode: '+63', flag: '🇵🇭', placeholder: '0905 123 4567' },
  { iso: 'ID', name: 'Indonesia', dialCode: '+62', flag: '🇮🇩', placeholder: '0812-345-678' },
  { iso: 'RU', name: 'Nga', dialCode: '+7', flag: '🇷🇺', placeholder: '912 345-67-89' },
  { iso: 'CZ', name: 'Séc', dialCode: '+420', flag: '🇨🇿', placeholder: '601 123 456' },
  { iso: 'PL', name: 'Ba Lan', dialCode: '+48', flag: '🇵🇱', placeholder: '512 345 678' },
  { iso: 'NL', name: 'Hà Lan', dialCode: '+31', flag: '🇳🇱', placeholder: '06 12345678' },
  { iso: 'NZ', name: 'New Zealand', dialCode: '+64', flag: '🇳🇿', placeholder: '021 123 4567' },
  { iso: 'CH', name: 'Thụy Sĩ', dialCode: '+41', flag: '🇨🇭', placeholder: '078 123 45 67' },
  { iso: 'SE', name: 'Thụy Điển', dialCode: '+46', flag: '🇸🇪', placeholder: '070-123 45 67' },
  { iso: 'NO', name: 'Na Uy', dialCode: '+47', flag: '🇳🇴', placeholder: '406 12 345' },
  { iso: 'DK', name: 'Đan Mạch', dialCode: '+45', flag: '🇩🇰', placeholder: '32 12 34 56' },
  { iso: 'IT', name: 'Ý', dialCode: '+39', flag: '🇮🇹', placeholder: '312 345 6789' },
  { iso: 'ES', name: 'Tây Ban Nha', dialCode: '+34', flag: '🇪🇸', placeholder: '612 34 56 78' },
  { iso: 'BE', name: 'Bỉ', dialCode: '+32', flag: '🇧🇪', placeholder: '0470 12 34 56' },
  { iso: 'AT', name: 'Áo', dialCode: '+43', flag: '🇦🇹', placeholder: '0664 123456' },
  { iso: 'AE', name: 'UAE', dialCode: '+971', flag: '🇦🇪', placeholder: '050 123 4567' },
];

const COUNTRY_MAP = new Map(SUPPORTED_COUNTRIES.map((c) => [c.iso, c]));

function getCountriesList() {
  return SUPPORTED_COUNTRIES.map((c) => {
    let example = c.placeholder;
    try {
      const ex = getExampleNumber(c.iso, examples);
      if (ex) example = ex.formatNational();
    } catch {
      // keep fallback placeholder
    }
    return { ...c, placeholder: example };
  });
}

/**
 * Strictly validates phone number for a given country ISO (e.g. 'VN', 'JP', 'US')
 * Ensures:
 * - Not missing digits (TOO_SHORT)
 * - Not extra digits (TOO_LONG)
 * - Valid prefix & format for the selected country
 * - Returns normalized E.164 (e.g. +84967862545) for duplicate detection
 */
function validatePhone(rawInput, countryIso = 'VN') {
  const iso = String(countryIso || 'VN').toUpperCase();
  const countryInfo = COUNTRY_MAP.get(iso) || COUNTRY_MAP.get('VN');
  const effectiveIso = countryInfo.iso;

  const cleaned = String(rawInput || '').trim();
  if (!cleaned) {
    return {
      ok: false,
      code: 'EMPTY',
      message: 'Vui lòng nhập số điện thoại.',
    };
  }

  // Reject clearly non-phone characters
  if (/[^0-9+\s().\-]/.test(cleaned)) {
    return {
      ok: false,
      code: 'INVALID_CHARS',
      message: 'Số điện thoại chỉ được chứa chữ số và ký tự phân tách (+, khoảng trắng, dấu gạch ngang).',
    };
  }

  // Check length first for precise TOO_SHORT / TOO_LONG feedback
  const lenCheck = validatePhoneNumberLength(cleaned, effectiveIso);
  if (lenCheck === 'TOO_SHORT') {
    return {
      ok: false,
      code: 'TOO_SHORT',
      message: `Số điện thoại bị thiếu số theo định dạng ${countryInfo.name} (${countryInfo.dialCode}). Ví dụ: ${countryInfo.placeholder}`,
    };
  }
  if (lenCheck === 'TOO_LONG') {
    return {
      ok: false,
      code: 'TOO_LONG',
      message: `Số điện thoại bị thừa số theo định dạng ${countryInfo.name} (${countryInfo.dialCode}). Ví dụ: ${countryInfo.placeholder}`,
    };
  }
  if (lenCheck === 'INVALID_LENGTH') {
    return {
      ok: false,
      code: 'INVALID_LENGTH',
      message: `Độ dài số điện thoại không hợp lệ cho ${countryInfo.name} (${countryInfo.dialCode}). Ví dụ: ${countryInfo.placeholder}`,
    };
  }
  if (lenCheck === 'NOT_A_NUMBER' || lenCheck === 'INVALID_COUNTRY') {
    return {
      ok: false,
      code: 'INVALID_FORMAT',
      message: `Số điện thoại không hợp lệ cho ${countryInfo.name} (${countryInfo.dialCode}).`,
    };
  }

  try {
    const parsed = parsePhoneNumberWithError(cleaned, effectiveIso);
    if (!parsed || !parsed.isValid()) {
      // Extra-clear feedback for Vietnam mobile numbers (always 10 digits with leading 0 / 9 national digits)
      if (effectiveIso === 'VN') {
        const digitsOnly = cleaned.replace(/\D/g, '');
        const nationalDigits = digitsOnly.startsWith('84')
          ? digitsOnly.slice(2)
          : digitsOnly.startsWith('0')
          ? digitsOnly.slice(1)
          : digitsOnly;
        if (/^[35789]/.test(nationalDigits)) {
          if (nationalDigits.length < 9) {
            return {
              ok: false,
              code: 'TOO_SHORT',
              message: `Số điện thoại Việt Nam bị thiếu số (cần đúng 10 số bắt đầu bằng 0, ví dụ: ${countryInfo.placeholder}).`,
            };
          }
          if (nationalDigits.length > 9) {
            return {
              ok: false,
              code: 'TOO_LONG',
              message: `Số điện thoại Việt Nam bị thừa số (chỉ gồm đúng 10 số bắt đầu bằng 0, ví dụ: ${countryInfo.placeholder}).`,
            };
          }
        }
      }

      return {
        ok: false,
        code: 'INVALID_FORMAT',
        message: `Đầu số hoặc định dạng số điện thoại không hợp lệ tại ${countryInfo.name} (${countryInfo.dialCode}). Ví dụ: ${countryInfo.placeholder}`,
      };
    }

    const detectedIso = parsed.country || effectiveIso;
    const dialCode = `+${parsed.countryCallingCode || getCountryCallingCode(detectedIso)}`;

    return {
      ok: true,
      countryIso: detectedIso,
      dialCode,
      e164: parsed.number, // e.g. +84967862545
      national: parsed.formatNational(), // e.g. 0967 862 545
      international: parsed.formatInternational(), // e.g. +84 96 786 25 45
    };
  } catch (err) {
    if (err && err.message === 'TOO_SHORT') {
      return {
        ok: false,
        code: 'TOO_SHORT',
        message: `Số điện thoại bị thiếu số theo định dạng ${countryInfo.name} (${countryInfo.dialCode}).`,
      };
    }
    if (err && err.message === 'TOO_LONG') {
      return {
        ok: false,
        code: 'TOO_LONG',
        message: `Số điện thoại bị thừa số theo định dạng ${countryInfo.name} (${countryInfo.dialCode}).`,
      };
    }
    return {
      ok: false,
      code: 'INVALID_FORMAT',
      message: `Số điện thoại không hợp lệ theo mã vùng ${countryInfo.name} (${countryInfo.dialCode}).`,
    };
  }
}

module.exports = {
  SUPPORTED_COUNTRIES,
  getCountriesList,
  validatePhone,
};
