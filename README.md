# Concours.DOS — Portail Depot Entreprises

Portail React + Express pour piloter des invitations documentaires entreprise,
generer des liens signes et gerer les depots de pieces en stockage local.

## Sommaire

- [1. Vue d'ensemble](#1-vue-densemble)
- [2. Architecture du site](#2-architecture-du-site)
- [3. Logique admin et lien signe](#3-logique-admin-et-lien-signe)
- [4. Variables d'environnement](#4-variables-denvironnement)
- [5. Demarrage local](#5-demarrage-local)
- [6. Deploiement production sur serveur entreprise](#6-deploiement-production-sur-serveur-entreprise)
- [7. Exploitation et maintenance](#7-exploitation-et-maintenance)
- [8. Endpoints utiles](#8-endpoints-utiles)
- [9. Structure du repository](#9-structure-du-repository)
- [10. Documentation complementaire](#10-documentation-complementaire)

## 1. Vue d'ensemble

Le produit expose deux interfaces:

- `GET /admin`: console d'administration (projets, entreprises, pieces attendues, generation des liens signes).
- `GET /depot?inv=...&sig=...&alg=HS256`: portail entreprise securise pour depot et suivi des pieces.

Principes de securite:

- L'admin est accessible uniquement en local sur l'hote serveur (`localhost`).
- Le portail depot est inaccessible sans lien signe valide.
- Les URLs des flows Power Automate et le secret de signature restent cote serveur.
- En production, le serveur refuse de demarrer si les prerequis critiques sont absents (build, secret, flows critiques).

## 2. Architecture du site

### 2.1 Architecture technique

Deux modes de deploiement :

- **Monolithe** (`PORTAL_APP_ROLE=all`, dev local) : un processus Express sert admin + portail.
- **Deux serveurs** (production cible) : VM interne **admin** + VM DMZ **portal**, base **PostgreSQL** partagee.

```text
Internet -> proxy externe -> Node (role=portal) -> PostgreSQL (zone donnees)
Admins   -> proxy interne -> Node (role=admin)  -> PostgreSQL
Les deux instances -> Power Automate (e-mails) ; fichiers sur disque local VPS
```

Le staging fichiers (`PORTAL_UPLOAD_STAGING_DIR`) vit uniquement sur l'instance **portal**. Les depots sont finalises de facon synchrone a l'upload.

### 2.2 Separation frontend

- `src/main.jsx` charge l'app portail entreprise (`src/app/App.jsx`).
- `src/admin-main.jsx` charge l'app admin (`src/app/AdminApp.jsx`).
- `npm run build:all` produit `dist-all` (monolithe).
- `npm run build:portal` / `npm run build:admin` produisent `dist-portal` / `dist-admin` pour les images Docker scindees.

### 2.3 Flux metier principal

1. L'admin cree un projet et ajoute des entreprises avec leurs pieces attendues.
2. L'admin genere un lien signe stable par entreprise (ou envoie les invitations par email via un flow Power Automate dedie).
3. L'entreprise ouvre `/depot` avec `inv + sig + alg` (identifiant opaque stocke cote serveur).
4. Le serveur verifie la signature, retrouve l'invitation, puis hydrate le
   projet, l'entreprise et les pieces attendues depuis PostgreSQL.
5. L'ouverture du lien est tracee dans `invitation_events` et remontee dans l'admin.
6. Les fichiers sont enregistres localement sur le VPS (staging portal) ; les e-mails passent par Power Automate si configure.
7. L'admin peut relancer les entreprises au dossier incomplet via un second flow Power Automate.

## 3. Logique admin et lien signe

### 3.1 Logique page admin (`/admin`)

La page admin centralise:

- `Configuration projet`: `name`, `dossierId`, `folderPath`, `deadline`.
- `Ajout nouvelle entreprise`: metadonnees + liste de pieces attendues.
- `Lien securise`: generation et copie de l'URL signee.
- `Suivi des pieces recues`: vues visuelles avec filtres (statut, piece, recherche, incomplets).

Controle d'acces:

- Toutes les routes admin (`/admin`, `/api/admin/*`) passent par `requireLocalAdmin`.
- Si la requete n'est pas locale, reponse `403`.

### 3.2 Logique du lien signe

Format du lien:

- `inv`: identifiant opaque (UUID) persiste en base (`signed_invitations`).
- `sig`: HMAC SHA-256 de `inv`, calcule avec `PORTAL_LINK_SECRET`.
- `alg`: `HS256`.

Contenu fonctionnel du payload serveur (minimum attendu):

- `projectId`, `companyDbId` si disponible
- `companyId`, `companyName`
- `submissionId`
- `dossierId`
- `folderPath`
- `documents` (liste des pieces autorisees)

Comportement de verification:

1. Verification a l'acces HTML `/depot` (refus immediat si invalide/expire).
2. Hydratation depuis PostgreSQL du projet et de l'entreprise rattaches au lien.
3. Relecture des pieces attendues courantes (`companies.expectedDocuments` +
   `projects.customDocuments`). Si l'admin modifie la liste de pieces d'une
   entreprise, le meme lien affiche les nouvelles pieces a deposer.
4. Verification a chaque appel API portail (`/api/portal/*`).
5. Verification que la piece manipulee est autorisee par l'etat courant en base.
6. Verification que le fichier cible reste dans le perimetre `folderPath` courant.

Resultat: un lien ne peut agir que pour l'entreprise rattachee en base et les
pieces actuellement attendues pour cette entreprise. Le lien reste utilisable
apres modification de la liste de pieces, tant que l'entreprise et le projet
existent et que le lien n'est pas expire ou revoque.
La generation de lien, l'envoi d'invitation et les relances reutilisent
l'invitation active existante pour conserver une seule URL par entreprise.

### 3.3 Suivi d'ouverture des invitations

Chaque invitation signee peut produire des evenements serveur dans la table
`invitation_events`:

- `opened`: le HTML `/depot` a ete servi apres validation du lien.
- `verified`: le frontend portail a confirme l'invitation via `/api/portal/verify`.
- `admin_test_open`: ouverture volontaire marquee comme test admin.
- `email_sent` / `email_reminder_sent`: envoi ou relance email cote admin.

L'API admin `GET /api/admin/projects/:id/invitations` renvoie pour chaque
entreprise les champs `hasOpened`, `openCount`, `firstOpenedAt` et
`lastOpenedAt`. La page admin affiche alors `Jamais ouvert` ou `Ouvert N fois`
dans la colonne Invitation.

Note d'exploitation: certains clients mail ou solutions antispam peuvent
precharger une URL et declencher un evenement `opened`. L'evenement `verified`
est plus representatif d'une ouverture complete par le navigateur, car il
necessite l'execution du frontend.

## 4. Variables d'environnement

### 4.1 Obligatoires (serveur)

```env
PORTAL_APP_ROLE=all
DATABASE_URL=postgresql://user:pass@host:5432/portail
PORTAL_LINK_SECRET=replace-with-a-long-random-secret
CLIENT_PORTAL_PUBLIC_URL=https://portal.example.com/depot
# Documents : stockage local VPS uniquement (pas de flow Power Automate fichier).
```

### 4.2 Recommandees (serveur)

```env
PORT=3001
# Duree de validite des liens signes (minutes).
# Valeur par defaut si non definie: 43200 (30 jours).
PORTAL_LINK_TTL_MINUTES=43200
POWER_AUTOMATE_SEND_INVITATIONS_URL=https://...
POWER_AUTOMATE_SEND_REMINDERS_URL=https://...
# Emailing optionnel (cf. boutons "Envoyer invitations" et "Envoyer relances").
POWER_AUTOMATE_SEND_INVITATIONS_URL=https://...
POWER_AUTOMATE_SEND_REMINDERS_URL=https://...
DATABASE_URL=postgresql://user:pass@host:5432/portail
PORTAL_APP_ROLE=all
PORTAL_MAX_BODY_MB=20
PORTAL_FLOW_TIMEOUT_MS=120000
# Recommande si un reverse proxy est utilise:
# - "loopback" (proxy sur la meme machine)
# - ou une liste d'IPs/subnets separes par des virgules (ex: "10.0.0.10, 10.0.0.0/8")
TRUST_PROXY=loopback
```

### 4.3 Variables frontend publiques (branding uniquement)

```env
VITE_CLIENT_PORTAL_ORGANIZATION=Votre marque
VITE_CLIENT_PORTAL_TITLE=Plateforme de depot de pieces concours
VITE_CLIENT_PORTAL_SUBTITLE=...
VITE_CLIENT_PORTAL_SUPPORT_EMAIL=contact@example.com
VITE_CLIENT_PORTAL_SUPPORT_PHONE=+33...
VITE_CLIENT_PORTAL_WEBSITE_URL=https://...
VITE_CLIENT_PORTAL_DEFAULT_FOLDER_PATH=/sites/DEPOTS/...
VITE_CLIENT_PORTAL_DEFAULT_DOSSIER_ID=...
VITE_CLIENT_PORTAL_CONTEST_NAME=...
VITE_CLIENT_PORTAL_REQUIRED_DOCUMENTS=KBIS,URSSAF,RIB,ASSURANCE_RC
```

### 4.4 Variables interdites au build frontend

Ne pas definir ces cles en `VITE_*`:

- `VITE_CLIENT_PORTAL_LINK_SECRET`
- `VITE_POWER_AUTOMATE_SEND_INVITATIONS_URL`
- `VITE_POWER_AUTOMATE_SEND_REMINDERS_URL`

Le script `scripts/check-public-env.mjs` bloque le build si elles existent.
Le serveur les refuse aussi au demarrage pour eviter une configuration runtime
ambigue.

## 5. Demarrage local

1. Copier les variables:

```powershell
Copy-Item .env.example .env
Copy-Item .env.example .env.local
```

2. Installer:

```powershell
npm install
```

3. Lancer en dev (API + Vite):

```powershell
npm run dev
```

4. Verifier le build production:

```powershell
npm run check
```

## 6. Deploiement production sur serveur entreprise

### 6.1 Prerequis infra

- Node.js 22 LTS.
- Reverse proxy TLS (IIS, Nginx, Apache, F5, etc.).
- Acces sortant du serveur vers les webhooks Power Automate.
- PostgreSQL (`DATABASE_URL`) et, sur l'instance portal, volume staging (`PORTAL_UPLOAD_STAGING_DIR`).

### 6.2 Installation applicative

```powershell
npm ci
npm run build:all
```

Configurer les variables d'environnement de production (fichier `.env` ou secret manager), puis:

```powershell
$env:NODE_ENV='production'
npm run start
```

En production, le serveur quitte au demarrage si:

- le build frontend est absent,
- `PORTAL_LINK_SECRET` est absent,
- les flows mail Power Automate (`SEND_INVITATIONS`, `SEND_REMINDERS`) sont absents si l'envoi email est requis.

### 6.3 Reverse proxy entreprise

Bonnes pratiques:

- Terminer TLS au proxy.
- Forwarder `Host`, `X-Forwarded-Proto`, `X-Forwarded-For`.
- Configurer `TRUST_PROXY` cote app (ex: `loopback` ou IP/subnet du proxy).
- Ne pas exposer `/admin` publiquement.

Exemple cible:

- Exposer `/depot` et `/assets/*` via HTTPS.
- Restreindre `/admin` a une administration locale (RDP/Bastion/VPN restreint).

### 6.4 Mise en service robuste (service)

Option Linux (systemd) ou Windows (NSSM/Task Scheduler) recommandee pour:

- redemarrage automatique,
- logs centralises,
- gestion propre des arrets/redemarrages.

Exemple systemd (Linux):

```ini
[Unit]
Description=Portail Entreprise
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/portail-entreprise
Environment=NODE_ENV=production
EnvironmentFile=/opt/portail-entreprise/.env
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

Exemple NSSM (Windows Server):

```powershell
nssm install PortailEntreprise "C:\\Program Files\\nodejs\\node.exe" "C:\\apps\\portail-entreprise\\server\\index.js"
nssm set PortailEntreprise AppDirectory "C:\\apps\\portail-entreprise"
nssm set PortailEntreprise AppEnvironmentExtra "NODE_ENV=production"
nssm start PortailEntreprise
```

### 6.5 Exemple reverse proxy Nginx

```nginx
server {
  listen 443 ssl http2;
  server_name portail.example.com;

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Important: garder `/admin` non expose publiquement (ACL reseau, bastion, VPN, etc.).

Pour un deploiement DSI complet (TLS 1.3, HSTS, ACL proxy, systemd/NSSM durci,
sauvegarde PostgreSQL, plan de reprise, conformite RGPD), suivre
`docs/deployment-guide.md`. Pour la cartographie complete des mecanismes
de securite cote serveur et client, voir `docs/security-report.md`.

### 6.6 Checklist de go-live

1. `GET /readyz` retourne `200`.
2. `GET /admin` retourne `403` depuis une machine distante.
3. `GET /depot` sans signature retourne `403`.
4. Un lien signe genere depuis l'admin ouvre bien le portail.
5. Upload / update / delete fonctionnent.
6. La previsualisation des fichiers deposes fonctionne depuis le portail.

## 7. Exploitation et maintenance

### 7.1 Base PostgreSQL

- Connexion: `DATABASE_URL` (pool `pg`, migrations au demarrage).
- Sauvegarde: politique DSI (`pg_dump` / PITR / equivalent).
- Les ouvertures de liens sont historisees dans `invitation_events`
  (`invitationId`, `eventType`, `source`, hash IP, user-agent tronque,
  metadata JSON, date).

### 7.2 Rotation secret de signature

1. Changer `PORTAL_LINK_SECRET`.
2. Redemarrer le service.
3. Regenerer les liens depuis l'admin.

Effet: les anciens liens deviennent invalides.

### 7.3 Supervision

Surveiller au minimum:

- `GET /health`
- `GET /readyz`
- logs Express
- echecs Power Automate
- espace disque staging (instance portal) et sante PostgreSQL

## 8. Endpoints utiles

- `GET /health`: liveness.
- `GET /readyz`: readiness (build + secret + flows).
- `GET /admin`: UI admin locale uniquement.
- `GET /depot?inv=...&sig=...&alg=HS256`: UI portail entreprise securisee.
- `GET /api/admin/security`: statut securite/flows (admin local).
- `POST /api/admin/invitations/sign`: generation de lien signe (admin local).
- `POST /api/admin/invitations/revoke`: revocation d'un lien signe (admin local).
- `GET /api/admin/invitations/revoked`: liste des liens revoques (admin local).
- `GET /api/admin/projects/:id/invitations`: derniers liens par entreprise avec
  statut d'envoi, relances et ouvertures tracees.
- `POST /api/admin/projects/:id/send-invitations`: genere et envoie par email le lien signe aux entreprises ciblees (admin local, flow `SEND_INVITATIONS`).
- `POST /api/admin/projects/:id/send-reminders`: envoie une relance aux entreprises au dossier incomplet (admin local, flow `SEND_REMINDERS`).
- `POST /api/portal/documents|upload|update|delete|download`: operations documentaires scopees par invitation signee.

## 9. Structure du repository

```text
server/
  index.js            # entree (env + startServer)
  startServer.js      # bootstrap par PORTAL_APP_ROLE
  routes/             # admin, portal, health, static
  db/                 # PostgreSQL (schema, pool, repositories)
  security.js         # signature HMAC et verification des invitations
  flows.js            # appels Power Automate
src/
  app/App.jsx         # portail entreprise
  app/AdminApp.jsx    # console admin
  lib/adminApi.js     # client API admin
  lib/powerAutomateClient.js
scripts/
  check-public-env.mjs
```

## 10. Documentation complementaire

- `docs/deployment-guide.md` : guide de deploiement (TLS, HSTS, reverse proxy, systemd/NSSM, sauvegarde, DRP, RGPD, checklist Go-Live).
- `docs/security-report.md` : rapport de securite (fonctionnalites exposees, patterns, OWASP, STRIDE, mapping code).
- `docs/security-audit-2026-04.md` : audit de securite (avril 2026, 27 findings).
- `docs/production-guide.md` : guide de mise en production (env, prerequis).
- `docs/operations-guide.md` : guide d'exploitation (runbook, depannage).
- `docs/roadmap.md` : feuille de route fonctionnelle et technique.
