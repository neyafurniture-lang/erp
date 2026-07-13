# Activer HTTPS (corriger « Non sécurisé » sur iPhone)

## Cause

Safari affiche **Non sécurisé** car le site est en `http://` (IP).  
Ce n’est **pas** lié au SSH.

## Étape 1 — DNS (obligatoire)

Chez le registrar de `neyafurniture.ca` (souvent OVH, GoDaddy, Cloudflare…) :

| Type | Nom | Valeur | TTL |
|------|-----|--------|-----|
| **A** | `erp` | `51.222.31.75` | 300 ou Auto |

Résultat attendu : `erp.neyafurniture.ca` → `51.222.31.75`

Vérifier (après 5–30 min) :

```bash
nslookup erp.neyafurniture.ca
```

## Étape 2 — Activer HTTPS sur le VPS

```bash
ssh ubuntu@51.222.31.75
cd /opt/neya-erp
sudo bash deploy/enable-https.sh erp.neyafurniture.ca neyafurniture@gmail.com
```

Caddy obtient un certificat **Let's Encrypt** automatiquement.

## Étape 3 — iPhone

1. Ouvrir **https://erp.neyafurniture.ca** (pas http, pas l’IP)
2. Recréer le raccourci écran d’accueil si besoin
3. Le cadenas / « Sécurisé » doit apparaître

## Google OAuth (si utilisé)

Dans Google Cloud Console, ajouter :

`https://erp.neyafurniture.ca/api/integrations/google/callback`
