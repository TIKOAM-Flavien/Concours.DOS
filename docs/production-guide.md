# Guide de mise en production

## 1. Prerequis

- Node.js 22 LTS ou equivalent.
- Un secret fort pour `PORTAL_LINK_SECRET`.
- Les 5 flows Power Automate deployes et testes.
- Un acces HTTPS public vers le serveur Express.
- PostgreSQL accessible depuis chaque instance Node (`DATABASE_URL`).
- Un volume persistant pour le staging upload sur l'instance **portal** uniquement.

## 2. Variables obligatoires

Server-only:

```env
PORTAL_APP_ROLE=admin|portal|all
DATABASE_URL=postgresql://...
PORTAL_LINK_SECRET=...
CLIENT_PORTAL_PUBLIC_URL=https://portal.example.com/depot
PORTAL_UPLOAD_STAGING_DIR=/data/uploads
```

Les pieces sont stockees **localement sur le VPS** via `PORTAL_UPLOAD_STAGING_DIR` (finalisation synchrone a l'upload).
Aucun flow Power Automate fichier (upload/update/delete/download) n'est requis.

Optionnelles (admin — envoi d'e-mails) :

```env
POWER_AUTOMATE_SEND_INVITATIONS_URL=...
POWER_AUTOMATE_SEND_REMINDERS_URL=...
PORTAL_LINK_TTL_MINUTES=43200
PORTAL_UPLOAD_STAGING_DIR=/data/uploads
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
- `VITE_POWER_AUTOMATE_SEND_INVITATIONS_URL`
- `VITE_POWER_AUTOMATE_SEND_REMINDERS_URL`

Le script `scripts/check-public-env.mjs` bloque le build si elles existent.
Le serveur les refuse egalement au demarrage afin d'eviter une configuration
runtime ambigue.

## 4. Build et demarrage

```powershell
npm install
npm run build:admin   # instance admin
npm run build:portal  # instance portal
# ou npm run build:all pour monolithe
$env:NODE_ENV='production'
$env:DATABASE_URL='postgresql://...'
$env:PORTAL_APP_ROLE='admin'  # ou portal / all
npm run start
```

Images Docker (GHCR) : `…/portail-admin` et `…/portail-portal` (voir `docker-compose.admin.yml` / `docker-compose.portal.yml`).

Le serveur refuse de demarrer en production si:

- le build frontend est absent ;
- `PORTAL_LINK_SECRET` est absent ;
- `DATABASE_URL` ou `PORTAL_LINK_SECRET` est absent.

### Suivi d'ouverture des liens

Les ouvertures de liens signes sont historisees dans PostgreSQL via
`invitation_events`. Deux signaux sont enregistres:

- `opened`: le serveur a servi `/depot` apres validation de la signature ;
- `verified`: le frontend a appele `/api/portal/verify` avec un lien valide.

La console admin affiche ensuite `Jamais ouvert`, `Ouvert N fois` et la date de
derniere ouverture dans la liste des entreprises. Pour les audits, preferer
`verified` comme signal fort d'ouverture utilisateur: certains clients mail ou
outils antispam peuvent precharger les URLs et produire un `opened` sans visite
humaine complete.

### Donnees affichees sur le portail

Le lien signe contient un identifiant opaque (`inv`) et une signature (`sig`).
Apres verification, le serveur relit dans PostgreSQL le projet, l'entreprise,
la deadline, le folderPath et la liste courante des pieces attendues. Une
modification admin de `expectedDocuments` ou des pieces specifiques projet est
donc visible avec le meme lien de depot, sans regenerer l'invitation.
Les envois et relances reutilisent aussi cette invitation active afin de
conserver une URL stable par entreprise.

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
6. La previsualisation des fichiers deposes fonctionne depuis le portail.

## 7. Rotation et hygiene

- Changer `PORTAL_LINK_SECRET` en cas de suspicion de fuite.
- Regenerer les URLs Power Automate si elles ont ete exposees ailleurs.
- Sauvegarder PostgreSQL et le volume `PORTAL_UPLOAD_STAGING_DIR` (portal).
- Garder `.env` et `.env.local` hors versionnement.

## 8. Supervision

Surveiller au minimum:

- `GET /health`
- `GET /readyz`
- les logs serveur Express
- les echecs de flows Power Automate
- l'espace disque du dossier staging portal (`PORTAL_UPLOAD_STAGING_DIR`)
