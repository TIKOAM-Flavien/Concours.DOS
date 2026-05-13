# Guide de mise en production

## 1. Prerequis

- Node.js 22 LTS ou equivalent.
- Un secret fort pour `PORTAL_LINK_SECRET`.
- Les 5 flows Power Automate deployes et testes.
- Un acces HTTPS public vers le serveur Express.
- Un dossier persistant pour la base SQLite si le serveur est recree.

## 2. Variables obligatoires

Server-only:

```env
PORTAL_LINK_SECRET=...
CLIENT_PORTAL_PUBLIC_URL=https://portal.example.com/depot
POWER_AUTOMATE_GET_DOCUMENTS_URL=...
POWER_AUTOMATE_UPLOAD_FILE_URL=...
POWER_AUTOMATE_UPDATE_FILE_URL=...
POWER_AUTOMATE_DELETE_FILE_URL=...
```

Optionnelles mais recommandees:

```env
POWER_AUTOMATE_DOWNLOAD_FILE_URL=...
# Emailing admin (boutons "Envoyer invitations" et "Envoyer relances").
# Laisser vide masque les boutons correspondants.
POWER_AUTOMATE_SEND_INVITATIONS_URL=...
POWER_AUTOMATE_SEND_REMINDERS_URL=...
PORTAL_LINK_TTL_MINUTES=43200
PORTAL_ADMIN_DB_PATH=/data/portail-entreprise/admin.db
PORTAL_MAX_BODY_MB=20
PORTAL_FLOW_TIMEOUT_MS=120000
# Recommande si un reverse proxy est utilise:
# - "loopback" (proxy sur la meme machine)
# - ou une liste d'IPs/subnets separes par des virgules (ex: "10.0.0.10, 10.0.0.0/8")
TRUST_PROXY=loopback
```

Public frontend:

```env
VITE_CLIENT_PORTAL_ORGANIZATION=Votre marque
VITE_CLIENT_PORTAL_TITLE=Plateforme de depot
VITE_CLIENT_PORTAL_SUPPORT_EMAIL=support@example.com
```

## 3. Variables interdites

Ne pas exposer ces cles au build frontend:

- `VITE_CLIENT_PORTAL_LINK_SECRET`
- `VITE_POWER_AUTOMATE_GET_DOCUMENTS_URL`
- `VITE_POWER_AUTOMATE_DOWNLOAD_FILE_URL`
- `VITE_POWER_AUTOMATE_UPLOAD_FILE_URL`
- `VITE_POWER_AUTOMATE_UPDATE_FILE_URL`
- `VITE_POWER_AUTOMATE_DELETE_FILE_URL`

Le script `scripts/check-public-env.mjs` bloque le build si elles existent.
Le serveur les refuse egalement au demarrage afin d'eviter une configuration
runtime ambigue.

## 4. Build et demarrage

```powershell
npm install
npm run build:all
$env:NODE_ENV='production'
npm run start
```

Le serveur refuse de demarrer en production si:

- le build frontend est absent ;
- `PORTAL_LINK_SECRET` est absent ;
- un flow critique manque (`GET_DOCUMENTS`, `UPLOAD`, `UPDATE`, `DELETE`).

## 5. Reverse proxy

Recommandations:

- Terminer TLS sur le proxy.
- Forwarder `Host`, `X-Forwarded-Proto` et `X-Forwarded-For`.
- Configurer `TRUST_PROXY` (ex: `loopback` ou IP/subnet du proxy) si le serveur Express est derriere un proxy.
- Ne pas publier `/admin` vers internet. Utiliser une session locale, RDP,
  Bastion, ou un tunnel d'administration restreint.

## 6. Verification avant ouverture

Checklist minimale:

1. `GET /readyz` retourne `200`.
2. `GET /admin` est accessible uniquement depuis localhost.
3. `GET /depot` sans signature retourne `403`.
4. Un lien genere depuis l'admin ouvre bien le portail.
5. Upload, remplacement, suppression et lecture d'historique fonctionnent.
6. Le flow `DOWNLOAD` est configure si la previsualisation doit etre active.

## 7. Rotation et hygiene

- Changer `PORTAL_LINK_SECRET` en cas de suspicion de fuite.
- Regenerer les URLs Power Automate si elles ont ete exposees ailleurs.
- Sauvegarder la base SQLite et verifier sa restauration.
- Garder `.env` et `.env.local` hors versionnement.

## 8. Supervision

Surveiller au minimum:

- `GET /health`
- `GET /readyz`
- les logs serveur Express
- les echecs de flows Power Automate
- l'espace disque du dossier contenant `admin.db`
