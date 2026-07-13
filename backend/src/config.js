import dotenv from 'dotenv';

dotenv.config();

const WEAK_SECRETS = ['neya-dev-secret-change-in-production', 'change-me', 'secret', 'neya2024'];

export function getJwtSecret() {
  return process.env.JWT_SECRET || 'neya-dev-secret-change-in-production';
}

export function isProduction() {
  return process.env.NODE_ENV === 'production';
}

export function validateSecurityConfig() {
  const secret = getJwtSecret();
  const warnings = [];

  if (isProduction()) {
    if (secret.length < 32) {
      console.error('❌ JWT_SECRET trop court (min. 32 caractères en production)');
      process.exit(1);
    }
    if (WEAK_SECRETS.some(w => secret.toLowerCase().includes(w))) {
      console.error('❌ JWT_SECRET par défaut interdit en production');
      process.exit(1);
    }
    if (!process.env.FRONTEND_URL) {
      warnings.push('FRONTEND_URL non défini — CORS limité');
    }
  } else if (WEAK_SECRETS.some(w => secret.toLowerCase().includes(w))) {
    warnings.push('JWT_SECRET par défaut — changez-le avant mise en production');
  }

  const adminPw = process.env.ADMIN_PASSWORD || 'neya2024';
  if (isProduction() && (adminPw === 'neya2024' || adminPw.length < 10)) {
    console.error('❌ ADMIN_PASSWORD faible — définissez un mot de passe fort');
    process.exit(1);
  }

  for (const w of warnings) console.warn(`⚠ Sécurité: ${w}`);
}

export function validatePassword(password) {
  if (!password || password.length < 10) {
    return 'Le mot de passe doit contenir au moins 10 caractères';
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Le mot de passe doit contenir des lettres et des chiffres';
  }
  return null;
}
