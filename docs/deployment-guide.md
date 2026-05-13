# Guide de déploiement — Portail Entreprise

Ce document décrit le déploiement, l'exploitation et la conformité du
**Portail Entreprise** Il complète :

- `[README.md](../README.md)` — vue d'ensemble et démarrage.
- `[docs/production-guide.md](production-guide.md)` — résumé production.
- `[docs/operations-guide.md](operations-guide.md)` — runbook exploitation.
- `[docs/security-report.md](security-report.md)` — patterns de sécurité.
- `[docs/security-audit-2026-04.md](security-audit-2026-04.md)` — historique audit.

## Sommaire

1. [Périmètre et architecture cible](#1-périmètre-et-architecture-cible)
2. [Prérequis DSI](#2-prérequis-dsi)
3. [Topologie réseau et flux](#3-topologie-réseau-et-flux)
4. [Procédure d'installation](#4-procédure-dinstallation)
5. [Configuration des variables d'environnement](#5-configuration-des-variables-denvironnement)
6. [Reverse proxy (TLS, HSTS, ACL)](#6-reverse-proxy-tls-hsts-acl)
7. [Service système (systemd / NSSM)](#7-service-système-systemd--nssm)
8. [Sauvegarde et restauration](#8-sauvegarde-et-restauration)
9. [Supervision, journalisation, métriques](#9-supervision-journalisation-métriques)
10. [Gestion des secrets et rotation](#10-gestion-des-secrets-et-rotation)
11. [Plan de continuité (DRP / PRA)](#11-plan-de-continuité-drp--pra)
12. [Conformité, RGPD, durée de rétention](#12-conformité-rgpd-durée-de-rétention)
13. [Procédures de mise à jour](#13-procédures-de-mise-à-jour)
14. [Checklist Go-Live et recette DSI](#14-checklist-go-live-et-recette-dsi)
15. [Désactivation / décommissionnement](#15-désactivation--décommissionnement)
16. [Contacts et escalade](#16-contacts-et-escalade)

---

## 1. Périmètre et architecture cible

L'application expose **deux interfaces distinctes** servies par un seul
processus Node.js :


| Chemin                       | Public cible                        | Contrôle d'accès                                               |
| ---------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| `GET /depot?ctx=&sig=&alg=`  | Entreprises invitées (Internet)     | Lien signé HMAC-SHA256 obligatoire                             |
| `GET /admin`                 | Administrateur (sur l'hôte serveur) | Restreint à `127.0.0.1` / `::1` par `req.socket.remoteAddress` |
| `GET /health`, `GET /readyz` | Supervision interne                 | Sans authentification (réponse non sensible)                   |
| `POST /api/portal/`*         | Portail entreprise (XHR)            | Signature obligatoire + budget journalier + rate-limit         |
| `POST /api/admin/*`          | Console admin (XHR)                 | `requireLocalAdmin`                                            |


```text
Internet
  └─► Reverse Proxy TLS (IIS / Nginx / F5 / ARR)
        │   - TLS terminaison
        │   - HSTS (relais)
        │   - ACL : /admin* refusé
        │   - en-têtes X-Forwarded-* signés
        └─► Node.js (Express 5) sur loopback (127.0.0.1:3001)
              ├─► SQLite local (admin.db, journal WAL)
              └─► Power Automate (5 webhooks HTTPS)
                    └─► SharePoint Online
```

Aucune base de données externe, aucun cache distribué, aucun broker. Le
processus est **stateful** uniquement vis-à-vis du fichier SQLite et de la
mémoire du rate-limiter en-process (voir §11 pour le multi-instance).

---

## 2. Prérequis DSI

### 2.1 Matrice de compatibilité


| Composant     | Version supportée                                                 | Notes                                                                              |
| ------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| OS serveur    | Windows Server 2019/2022, RHEL 8/9, Debian 12, Ubuntu 22.04/24.04 | x64 uniquement                                                                     |
| Node.js       | **22 LTS**                                                        | Pas de polyfill `fetch` requis ; `AbortSignal.timeout` natif                       |
| Reverse proxy | IIS ≥10 + ARR 3.0, Nginx ≥1.24, Apache 2.4, F5 LTM ≥16            | TLS 1.2+ (recommandé : TLS 1.3)                                                    |
| Navigateurs   | Chrome 110+, Edge 110+, Firefox 110+, Safari 16+                  | ES2022, fetch, `URL`, `crypto.subtle` (option preview)                             |
| Filesystem    | Local NTFS ou ext4                                                | **Ne pas** stocker la base sur un partage WebDAV / OneDrive (lock + sync conflict) |
| RAM           | 512 Mo minimum, 1 Go recommandé                                   | Pic upload : 4–6× la taille max d'un fichier                                       |
| CPU           | 1 vCPU minimum, 2 vCPU recommandé                                 | Charge CPU ≈ négligeable hors handshake TLS                                        |
| Disque        | 1 Go minimum + croissance SQLite                                  | Provisionner 2× la taille estimée pour les `*-wal`                                 |


### 2.2 Comptes et droits

- **Compte de service dédié** sans droits interactifs (`svc-portail` ou
équivalent).
- Droits NTFS / POSIX : lecture/exécution sur le code, **lecture/écriture
exclusive** sur le dossier `PORTAL_ADMIN_DB_PATH`.
- Pas d'accès aux partages SharePoint depuis le serveur : tous les échanges
passent par les flows Power Automate.

### 2.3 Ouvertures réseau


| Sens    | Source                       | Destination                                          | Port        | Protocole                       |
| ------- | ---------------------------- | ---------------------------------------------------- | ----------- | ------------------------------- |
| Entrant | Internet                     | Reverse proxy                                        | 443         | HTTPS                           |
| Entrant | Reverse proxy                | Hôte applicatif                                      | 3001        | HTTP (loopback ou VLAN d'admin) |
| Sortant | Hôte applicatif              | `*.flow.microsoft.com` ou `*.azure-apim.net`         | 443         | HTTPS                           |
| Sortant | Hôte applicatif              | `registry.npmjs.org` (au moment du build uniquement) | 443         | HTTPS                           |
| Admin   | Console locale RDP / Bastion | Hôte applicatif                                      | 3389 ou ssh | Au choix DSI                    |


Le portail **n'écoute pas** directement sur 443. Le reverse proxy TLS est
obligatoire en production.

### 2.4 Identité et accès admin

L'accès admin n'est **pas** authentifié par mot de passe : il est verrouillé
au socket loopback (`127.0.0.1` / `::1`). Le contrôle d'accès admin est donc
**délégué au système** :

- Limiter l'ouverture de session sur l'hôte via Active Directory.
- Imposer un MFA pour atteindre la console (RDP, SSH, bastion).
- Auditer les ouvertures de session OS (Event Viewer / journald).

---

## 3. Topologie réseau et flux

### 3.1 Flux applicatifs


| #   | Source                | Destination          | Description                                         | Donnée transportée      |
| --- | --------------------- | -------------------- | --------------------------------------------------- | ----------------------- |
| F1  | Navigateur entreprise | Reverse proxy:443    | Page `/depot` + assets                              | HTML, JS, CSS           |
| F2  | Navigateur entreprise | Reverse proxy:443    | `/api/portal/`* (signé)                             | JSON + base64 (upload)  |
| F3  | Reverse proxy         | Node:3001            | F1+F2 relayés                                       | id.                     |
| F4  | Node                  | Power Automate:443   | GET_DOCUMENTS / UPLOAD / UPDATE / DELETE / DOWNLOAD | JSON + base64 (fichier) |
| F5  | Power Automate        | SharePoint           | Stockage et lecture documentaire                    | Fichiers + métadonnées  |
| F6  | Hôte admin            | Node:3001 (loopback) | `/admin` + `/api/admin/*`                           | JSON                    |
| F7  | Supervision           | Node:3001            | `/health`, `/readyz`                                | JSON                    |


### 3.2 Diagramme zoning

```text
┌─ Zone Internet ────────────────────────────────────────────┐
│   Navigateur entreprise (lien signé reçu par mail)         │
└──────────────────────────┬─────────────────────────────────┘
                           │ TLS 1.2+
┌─ Zone DMZ ───────────────┴─────────────────────────────────┐
│   Reverse proxy (IIS/Nginx/F5) — ACL : /admin* refusé      │
│   - TLS, HSTS                                              │
│   - Forwarding 3001                                        │
└──────────────────────────┬─────────────────────────────────┘
                           │ Loopback / VLAN privé
┌─ Zone Backend ───────────┴─────────────────────────────────┐
│   Node.js (Express) — port 3001                            │
│   - SQLite local (admin.db, WAL)                           │
│   - Loggage stdout                                         │
└──────────────────────────┬─────────────────────────────────┘
                           │ HTTPS sortant
┌─ Zone SaaS Microsoft ────┴─────────────────────────────────┐
│   Power Automate ─► SharePoint Online (BDD_reception_piece)│
└────────────────────────────────────────────────────────────┘
```

### 3.3 Données traitées (catégorisation RGPD)


| Donnée                                                    | Catégorie               | Stockage                                                     |
| --------------------------------------------------------- | ----------------------- | ------------------------------------------------------------ |
| `companyName`, `companyId`, `contactName`, `companyEmail` | Données pro / contact   | SQLite `companies`, payload signé                            |
| Pièces administratives (KBIS, URSSAF, RIB, etc.)          | Documents pro           | SharePoint via Power Automate. **Aucune persistance locale** |
| Adresse IP appelante                                      | Métadonnée              | `audit_log.actorIp`, rétention 90j                           |
| `submissionId` (jeton applicatif)                         | Identifiant fonctionnel | SQLite + payload signé                                       |


Aucune donnée personnelle sensible (santé, opinions, etc.) n'est attendue
dans le portail.

---

## 4. Procédure d'installation

> Toutes les commandes utilisent PowerShell sur Windows et Bash sur Linux.

### 4.1 Récupération du code

```powershell
# Préférer un clone hors OneDrive / Dropbox (lock + sync conflit)
git clone <url-interne> C:\apps\portail-entreprise
Set-Location C:\apps\portail-entreprise
```

```bash
sudo mkdir -p /opt/portail-entreprise
sudo chown svc-portail:svc-portail /opt/portail-entreprise
sudo -u svc-portail git clone <url-interne> /opt/portail-entreprise
cd /opt/portail-entreprise
```

### 4.2 Installation des dépendances

```bash
npm ci
```

Garanti reproductible (utilise `package-lock.json`). Pas besoin d'outils
natifs autres que ceux fournis par les paquets précompilés.

### 4.3 Configuration

1. Copier `.env.example` vers `.env`.
2. Remplir les variables obligatoires (cf. §5).
3. Générer un secret HMAC fort :
  ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
  ```
4. Restreindre les droits du fichier `.env` : lecture pour le compte de service uniquement.

### 4.4 Build de production

```bash
npm run build:all
```

Génère `dist-all/` (HTML + assets immutables, hash de contenu).

### 4.5 Premier démarrage de test

```bash
NODE_ENV=production npm run start
```

Le serveur **refuse** de démarrer si :

- le build est absent ;
- `PORTAL_LINK_SECRET` est absent, faible (<32 octets) ou contient un mot
interdit (`replace`, `change`, `secret`, etc.) ;
- l'un des flows critiques (GET / UPLOAD / UPDATE / DELETE) est manquant ;
- une variable `VITE_`* interdite est définie.

Vérifier `GET http://127.0.0.1:3001/readyz` → `200 OK`.

---

## 5. Configuration des variables d'environnement

### 5.1 Obligatoires


| Variable                           | Type      | Description                                                       |
| ---------------------------------- | --------- | ----------------------------------------------------------------- |
| `PORTAL_LINK_SECRET`               | secret    | Clé HMAC ≥32 octets. Source de confiance unique des liens signés. |
| `CLIENT_PORTAL_PUBLIC_URL`         | URL HTTPS | URL publique du portail (utilisée pour générer les liens).        |
| `POWER_AUTOMATE_GET_DOCUMENTS_URL` | URL HTTPS | Flow lecture documentaire SharePoint.                             |
| `POWER_AUTOMATE_UPLOAD_FILE_URL`   | URL HTTPS | Flow dépôt.                                                       |
| `POWER_AUTOMATE_UPDATE_FILE_URL`   | URL HTTPS | Flow remplacement.                                                |
| `POWER_AUTOMATE_DELETE_FILE_URL`   | URL HTTPS | Flow suppression.                                                 |


### 5.2 Recommandées


| Variable                              | Défaut            | Description                                                                |
| ------------------------------------- | ----------------- | -------------------------------------------------------------------------- |
| `POWER_AUTOMATE_DOWNLOAD_FILE_URL`    | *vide*            | Flow téléchargement (preview / download). Si absent, preview désactivé.    |
| `POWER_AUTOMATE_SEND_INVITATIONS_URL` | *vide*            | Envoi des invitations par email.                                           |
| `POWER_AUTOMATE_SEND_REMINDERS_URL`   | *vide*            | Envoi des relances.                                                        |
| `PORTAL_LINK_TTL_MINUTES`             | 43200 (30j)       | Durée de vie par défaut des liens signés.                                  |
| `PORTAL_LINK_TTL_MAX_MINUTES`         | 525600 (1 an)     | Plafond serveur appliqué à toute demande de signature.                     |
| `PORTAL_ADMIN_DB_PATH`                | `server/admin.db` | Chemin du fichier SQLite. **Doit être hors du repo et hors OneDrive.**     |
| `PORTAL_MAX_FILE_MB`                  | 20                | Taille max d'un fichier uploadé.                                           |
| `PORTAL_MAX_BODY_MB`                  | 30                | Limite globale corps de requête (calculée avec marge base64).              |
| `PORTAL_RATE_LIMIT_PER_MINUTE`        | 60                | Rate-limit général sur `/api/portal/`*.                                    |
| `PORTAL_UPLOAD_RATE_LIMIT_PER_MINUTE` | 10                | Rate-limit dédié `/api/portal/upload`.                                     |
| `PORTAL_SUBMISSION_DAILY_BUDGET`      | 300               | Quota journalier par `submissionId` (SQLite).                              |
| `PORTAL_FLOW_TIMEOUT_MS`              | 120000            | Timeout HTTP des appels Power Automate.                                    |
| `TRUST_PROXY`                         | *vide*            | `loopback`, `uniquelocal`, IP/CIDR séparés par virgule, ou entier (sauts). |


### 5.3 Renforcement HTTPS / HSTS


| Variable                         | Défaut                               | Description                                                                 |
| -------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| `PORTAL_FORCE_HSTS`              | *auto (true si NODE_ENV=production)* | `true` / `false` pour forcer l'envoi du header HSTS.                        |
| `PORTAL_HSTS_MAX_AGE`            | 31536000 (1 an)                      | `max-age` du header HSTS.                                                   |
| `PORTAL_HSTS_INCLUDE_SUBDOMAINS` | `true`                               | Ajoute `includeSubDomains` au header.                                       |
| `PORTAL_HSTS_PRELOAD`            | `false`                              | Ajoute `preload` (à activer uniquement après soumission à hstspreload.org). |


> Le serveur applicatif émet HSTS, mais en production réelle ce header est
> **aussi** émis par le reverse proxy : conserver la cohérence.

### 5.4 Interdites au build frontend

```text
VITE_CLIENT_PORTAL_LINK_SECRET
VITE_POWER_AUTOMATE_GET_DOCUMENTS_URL
VITE_POWER_AUTOMATE_DOWNLOAD_FILE_URL
VITE_POWER_AUTOMATE_UPLOAD_FILE_URL
VITE_POWER_AUTOMATE_UPDATE_FILE_URL
VITE_POWER_AUTOMATE_DELETE_FILE_URL
```

`scripts/check-public-env.mjs` bloque le build et le serveur quitte au
démarrage si l'une d'elles est détectée.

---

## 6. Reverse proxy (TLS, HSTS, ACL)

### 6.1 Bonnes pratiques générales

- Terminaison TLS au proxy (TLS 1.2 minimum, **TLS 1.3 recommandé**).
- Cipher suite alignée sur l'ANSSI / Mozilla "intermediate" ou "modern".
- Forward des en-têtes `Host`, `X-Forwarded-Proto`, `X-Forwarded-For`.
- Bloc d'ACL pour interdire `/admin`* depuis Internet.
- Activer la compression (gzip/br) pour `/assets/*`.

### 6.2 Modèle Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name portail.entreprise.example;

    ssl_certificate     /etc/ssl/certs/portail.crt;
    ssl_certificate_key /etc/ssl/private/portail.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers off;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Robots-Tag "noindex, nofollow" always;

    client_max_body_size 30m;  # doit matcher PORTAL_MAX_BODY_MB
    proxy_read_timeout   180s; # doit dépasser PORTAL_FLOW_TIMEOUT_MS

    # ACL : interdire /admin* depuis l'extérieur
    location ^~ /admin {
        deny all;
        return 403;
    }

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}

# Redirection HTTP → HTTPS
server {
    listen 80;
    server_name portail.entreprise.example;
    return 301 https://$host$request_uri;
}
```

### 6.3 Modèle IIS (ARR + URL Rewrite)

`web.config` minimal côté reverse proxy IIS :

```xml
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <!-- Bloc /admin -->
        <rule name="Block /admin from Internet" stopProcessing="true">
          <match url="^admin(/.*)?$" />
          <action type="CustomResponse" statusCode="403"
                  statusReason="Forbidden" statusDescription="Admin reserved" />
        </rule>
        <!-- Reverse proxy vers Node -->
        <rule name="ReverseProxyToNode" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:3001/{R:1}" />
        </rule>
      </rules>
      <outboundRules>
        <rule name="HSTS">
          <match serverVariable="RESPONSE_Strict_Transport_Security" pattern=".*" />
          <action type="Rewrite" value="max-age=31536000; includeSubDomains" />
        </rule>
      </outboundRules>
    </rewrite>
    <security>
      <requestFiltering>
        <!-- 30 Mo (doit matcher PORTAL_MAX_BODY_MB) -->
        <requestLimits maxAllowedContentLength="31457280" />
      </requestFiltering>
    </security>
  </system.webServer>
</configuration>
```

Activer également :

- TLS 1.2/1.3 uniquement (registry ou IIS Crypto).
- ARR : Enable Proxy = true.
- Reverse proxy : `preserveHostHeader = true`.

### 6.4 Vérifications post-mise en service

Depuis l'extérieur :

```bash
curl -I https://portail.entreprise.example/depot   # → 403 (lien signé requis)
curl -I https://portail.entreprise.example/admin   # → 403 (ACL proxy)
curl -I https://portail.entreprise.example/health  # → 200 (optionnel : restreindre)
```

Vérifier la présence des en-têtes :

- `Strict-Transport-Security`
- `Content-Security-Policy`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Robots-Tag: noindex, nofollow, ...`

---

## 7. Service système (systemd / NSSM)

### 7.1 systemd (Linux)

`/etc/systemd/system/portail-entreprise.service` :

```ini
[Unit]
Description=Portail Entreprise (Express + SQLite)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=svc-portail
Group=svc-portail
WorkingDirectory=/opt/portail-entreprise
EnvironmentFile=/etc/portail-entreprise/portail.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/portail-entreprise
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
MemoryDenyWriteExecute=true
RestrictRealtime=true
RestrictNamespaces=true
SystemCallFilter=@system-service
CapabilityBoundingSet=

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now portail-entreprise
sudo systemctl status portail-entreprise
```

### 7.2 NSSM (Windows Server)

```powershell
nssm install PortailEntreprise "C:\Program Files\nodejs\node.exe" "C:\apps\portail-entreprise\server\index.js"
nssm set PortailEntreprise AppDirectory "C:\apps\portail-entreprise"
nssm set PortailEntreprise AppEnvironmentExtra `
  "NODE_ENV=production" `
  "PORTAL_LINK_SECRET=..."
nssm set PortailEntreprise AppStdout "C:\logs\portail-entreprise\stdout.log"
nssm set PortailEntreprise AppStderr "C:\logs\portail-entreprise\stderr.log"
nssm set PortailEntreprise AppRotateFiles 1
nssm set PortailEntreprise AppRotateBytes 10485760  # 10 Mo
nssm set PortailEntreprise Start SERVICE_AUTO_START
nssm start PortailEntreprise
```

Exécuter le service sous un compte de service AD dédié (`svc-portail`),
**pas** sous `LocalSystem`.

### 7.3 Tâche planifiée alternative (Windows)

Si NSSM est interdit par la DSI, utiliser le Planificateur de tâches :

- Déclencheur : au démarrage.
- Action : `node.exe`, argument `C:\apps\portail-entreprise\server\index.js`.
- Si la tâche échoue, redémarrer après 1 min, 3 tentatives.
- Compte : `svc-portail` (mot de passe stocké, droit "ouvrir en tant que tâche batch").

---

## 8. Sauvegarde et restauration

### 8.1 Périmètre


| Élément                         | Localisation               | Sensibilité                          | Stratégie                                  |
| ------------------------------- | -------------------------- | ------------------------------------ | ------------------------------------------ |
| `admin.db` (+ `*-wal`, `*-shm`) | `PORTAL_ADMIN_DB_PATH`     | Métier (projets, entreprises, audit) | Sauvegarde quotidienne                     |
| `.env` (production)             | `/etc/portail-entreprise/` | **Secret**                           | Coffre-fort DSI (Vault / KeePass partagé)  |
| Code source                     | `/opt/portail-entreprise`  | Public interne                       | Repo Git, pas besoin de backup additionnel |
| Documents SharePoint            | SharePoint Online          | Métier                               | Hors périmètre — politique SharePoint      |


### 8.2 Procédure SQLite

SQLite avec WAL active : utiliser **toujours** le mode online backup pour
éviter une copie incohérente :

```bash
# Linux
sqlite3 /var/lib/portail-entreprise/admin.db ".backup '/var/backups/portail/admin-$(date +%F).db'"
```

```powershell
# Windows
sqlite3.exe "C:\var\portail\admin.db" ".backup 'D:\backup\portail\admin-$(Get-Date -Format yyyy-MM-dd).db'"
```

Ne **jamais** copier `admin.db` directement avec `cp` / `Copy-Item` pendant
qu'il est ouvert : le `*-wal` n'est pas appliqué et la sauvegarde peut être
corrompue.

### 8.3 Restauration

1. Arrêter le service.
2. Restaurer le fichier `.db` au chemin `PORTAL_ADMIN_DB_PATH`.
3. Supprimer tout `*-wal` / `*-shm` résiduel.
4. Démarrer le service.
5. Vérifier `GET /readyz`.

### 8.4 Fréquence recommandée

- Backup quotidien à 03:00, conservation 30 jours.
- Snapshot supplémentaire avant chaque mise à jour de version.
- Test de restauration trimestriel sur environnement de pré-production.

---

## 9. Supervision, journalisation, métriques

### 9.1 Endpoints de supervision


| Endpoint      | Code attendu | Sens                               |
| ------------- | ------------ | ---------------------------------- |
| `GET /health` | 200          | Liveness — le process répond       |
| `GET /readyz` | 200 / 503    | Readiness — build + secret + flows |


Configurer le superviseur (Centreon, Zabbix, Prometheus + blackbox exporter,
Azure Monitor) avec un seuil :

- 3 échecs `/health` consécutifs → alerte critique.
- `/readyz` ≠ 200 pendant > 5 min → alerte critique.
- Latence `/api/portal/documents` > 10s sur 95e percentile → alerte avertissement.

### 9.2 Logs applicatifs

Le serveur écrit sur `stdout` / `stderr` :

- `Server running on http://localhost:<port>`
- `[startup]` warnings (HTTPS / TTL / DB / etc.)
- `[startup] ERROR` si quit forcé en production
- `[audit] failed: <message>` si l'audit n'a pas pu écrire en base
- `[maintenance]` lignes (purge revoked, scrub audit)
- Stack traces pour les erreurs non rattrapées par `wrap()`

Recommandation DSI :

- Sur Linux : laisser systemd journaliser (`journalctl -u portail-entreprise`).
Forward optionnel vers SIEM via `journal-remote` ou `rsyslog`.
- Sur Windows + NSSM : rotation des fichiers de log (10 Mo, 7 fichiers).
Forward vers Wazuh / Splunk / Sentinel.

### 9.3 Journal d'audit applicatif

Table `audit_log` (SQLite) :


| Colonne       | Contenu                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actorIp`     | IP source (issue de `req.socket.remoteAddress`)                                                                                                                                             |
| `action`      | `admin.invitation.sign`, `admin.invitation.revoke`, `admin.project.upsert`, `admin.company.delete`, `admin.invitations.send`, `admin.invitations.remind`, `admin.maintenance.cleanup`, etc. |
| `payloadHash` | SHA-256 du payload — résiste au scrub                                                                                                                                                       |
| `payload`     | JSON détaillé, **scrubbé après 90 jours** (`scrubOldAuditPayloads`)                                                                                                                         |
| `createdAt`   | UTC ISO 8601                                                                                                                                                                                |


Export hors-bande recommandé pour conservation longue durée (loi
LCEN / RGPD selon nature) : tâche cron quotidienne `sqlite3 admin.db ".dump audit_log"` vers archive immuable.

### 9.4 Métriques (optionnel)

Pas de format Prometheus exposé nativement. Pour aller plus loin, deux
options :

- **Sidecar** : `nginx-prometheus-exporter` côté proxy (latence par route).
- **Monkeypatch** : ajouter `prom-client` + endpoint `/metrics`
(`requireLocalAdmin`) ; non livré par défaut pour minimiser la
surface d'exposition.

---

## 10. Gestion des secrets et rotation

### 10.1 Secrets sous contrôle


| Secret               | Risque si fuite                                                    | Procédure  |
| -------------------- | ------------------------------------------------------------------ | ---------- |
| `PORTAL_LINK_SECRET` | Génération de liens signés sans contrôle admin                     | Voir §10.2 |
| URLs Power Automate  | Appels directs en dehors du portail (POST anonyme depuis Internet) | Voir §10.3 |


### 10.2 Rotation `PORTAL_LINK_SECRET`

1. Générer un nouveau secret (≥32 octets aléatoires).
2. Mettre à jour `.env` ou le secret manager.
3. Redémarrer le service.
4. Constater dans `/readyz` que `signingEnabled: true`.
5. **Régénérer les liens en cours** depuis l'admin (les anciens deviennent
  invalides immédiatement).
6. Notifier les entreprises concernées (les liens précédents retournent
  `403 invalid_sig`).
7. Inscrire l'opération dans le registre des rotations.

### 10.3 Rotation des flows Power Automate

1. Côté Power Automate : régénérer l'URL HTTPS (en réenregistrant le trigger).
2. Mettre à jour la variable `POWER_AUTOMATE_*_URL` correspondante.
3. Redémarrer le service.
4. Tester un cycle complet (upload → list → download → delete).

### 10.4 Coffre-fort

Stocker `.env` et les URLs Power Automate dans :

- HashiCorp Vault, Azure Key Vault, AWS Secrets Manager, ou
- KeePass / Passbolt partagés DSI avec ACL.

Ne **jamais** committer ces valeurs dans Git (vérifié par `.gitignore`
existant et par `scripts/check-public-env.mjs`).

---

## 11. Plan de continuité (DRP / PRA)

### 11.1 Reprise sur incident


| Scénario                           | RTO cible        | RPO cible | Action                                                              |
| ---------------------------------- | ---------------- | --------- | ------------------------------------------------------------------- |
| Crash process                      | < 1 min          | 0         | `Restart=on-failure` (systemd) / NSSM auto-restart                  |
| Corruption `admin.db`              | < 30 min         | 24 h      | Restaurer dernier backup (§8.3)                                     |
| Perte de l'hôte                    | < 4 h            | 24 h      | Réinstaller selon §4, restaurer `admin.db`                          |
| Power Automate indisponible        | dépend Microsoft | 0         | Bandeau dans l'admin : `syncError`. Les uploads échouent avec `503` |
| Compromission `PORTAL_LINK_SECRET` | < 30 min         | 0         | Rotation (§10.2) + revoke en masse                                  |


### 11.2 Multi-instance / haute dispo

Le portail est **mono-instance par défaut** (rate-limiter en mémoire, SQLite
local). Pour passer en multi-instance :

1. Externaliser le rate-limit (`@express-rate-limit/redis-store` ou similaire).
2. Externaliser SQLite vers une base partagée (PostgreSQL, MS SQL) : impose
  un refactor de `server/db.js`.
3. Sticky-session non requis (toutes les routes API sont stateless une fois
  le payload signé reçu).
4. Aligner les horloges (NTP) — l'exp / iat doivent être cohérents.

Voir `[docs/operations-guide.md](operations-guide.md#limitation-du-débit-rate-limit)`
pour les limitations connues du `MemoryStore`.

### 11.3 Bascule de site

Si un PRA inter-site est requis :

- Synchroniser `.env` via le coffre-fort centralisé.
- Répliquer `admin.db` toutes les 15 min (rsync + `.backup`) vers le site B.
- Mettre à jour le DNS portail (TTL court : 300s recommandé).
- Tester la bascule semestriellement.

---

## 12. Conformité, RGPD, durée de rétention

### 12.1 Base légale

L'usage du portail repose sur une **base contractuelle** (relation entreprise
candidate ↔ donneur d'ordre). Les données collectées sont strictement
nécessaires au dépôt documentaire.

### 12.2 Données traitées

Voir §3.3. Aucune donnée sensible au sens RGPD article 9 n'est attendue.
Si une pièce déposée contient incidemment de telles données (ex. RIB
contenant l'IBAN, certificats médicaux), s'appuyer sur la politique
SharePoint du tenant Microsoft 365 (chiffrement au repos, contrôle d'accès,
DLP).

### 12.3 Rétention par défaut


| Donnée                                           | Lieu       | Durée par défaut           | Mécanisme                                                  |
| ------------------------------------------------ | ---------- | -------------------------- | ---------------------------------------------------------- |
| `audit_log.payload`                              | SQLite     | **90 jours**               | `scrubOldAuditPayloads` (auto + endpoint manuel)           |
| `audit_log.payloadHash` + `action` + `createdAt` | SQLite     | À durée de vie applicative | Conservé (intégrité)                                       |
| `revoked_invitations`                            | SQLite     | **30 jours après `exp`**   | `pruneRevokedInvitations`                                  |
| `submission_daily_budget`                        | SQLite     | Indéfini, faible volume    | Purge manuelle si besoin                                   |
| `projects`, `companies`                          | SQLite     | Cycle de vie projet        | Archivage logique (`archivedAt`) puis suppression manuelle |
| Documents                                        | SharePoint | Politique tenant           | Hors périmètre app                                         |


Une purge manuelle d'un projet/entreprise déclenche `audit.project.delete` /
`audit.company.delete`.

### 12.4 Droit d'accès / suppression

L'admin local peut :

- Exporter les projets et entreprises (UI admin + `GET /api/admin/projects`).
- Supprimer un projet ou une entreprise (`DELETE /api/admin/projects/:id` /
`/companies/:id`). Suppression cascade des liens revoqués associés non
prévue : prévoir une purge ciblée si demande RGPD.

### 12.5 Conservation des logs

Aligner sur la politique DSI :

- 6 mois pour logs OS / proxy ;
- 90 jours pour audit applicatif détaillé (rétention par défaut) ;
- 12 mois pour la trace `payloadHash + action + createdAt` (constante).

Pour conserver plus longtemps les payloads d'audit, configurer un export
quotidien hors-bande (cf. §9.3) **avant** la purge automatique.

---

## 13. Procédures de mise à jour

### 13.1 Mise à jour mineure (patch)

```bash
sudo systemctl stop portail-entreprise
cd /opt/portail-entreprise
sudo -u svc-portail git pull --ff-only
sudo -u svc-portail npm ci
sudo -u svc-portail npm run build:all
sudo -u svc-portail npm run audit:prod    # contrôle de surface d'attaque
sudo systemctl start portail-entreprise
curl -fsS http://127.0.0.1:3001/readyz
```

### 13.2 Mise à jour majeure (Node, dépendances)

1. Pré-prod : valider build + smoke tests + cycle complet (upload/update/delete).
2. Sauvegarder `admin.db` (§8.2).
3. Mettre à jour Node.js sur l'hôte.
4. Migrer le code (`git pull`), `npm ci`, `npm run build:all`.
5. Démarrer, vérifier `/readyz` et `[startup]` warnings.
6. Rollback : restaurer le tag git précédent + `admin.db` du backup.

### 13.3 Mise à jour des flows Power Automate

Coordination :

1. Cloner le flow en `v2`.
2. Tester la nouvelle URL via un environnement de pré-prod (POSTman + payload
  `POWER_AUTOMATE_*_URL` redirigé).
3. Basculer la variable d'environnement.
4. Désactiver l'ancien flow après 7 jours.

---

## 14. Checklist Go-Live

Cocher avant ouverture aux entreprises.

### 14.1 Sécurité

- `PORTAL_LINK_SECRET` ≥32 octets, généré aléatoirement.
- Aucune valeur de placeholder (`replace…`, `change…`, etc.) en production.
- `.env` hors du repo Git (`git ls-files | grep .env` → uniquement `.env.example`).
- TLS 1.2+ au reverse proxy ; certificat valide ≥ 30 jours.
- HSTS émis (`curl -I` confirme `Strict-Transport-Security`).
- `/admin` retourne 403 depuis Internet (ACL proxy).
- `/depot` sans signature retourne 403.
- `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`,
`X-Robots-Tag` présents sur toutes les réponses.
- `/readyz` retourne 200, `errors: []`.
- `npm run audit:prod` ne signale aucune CVE non corrigée.

### 14.2 Fonctionnel

- Création d'un projet pilote via `/admin`.
- Ajout d'une entreprise pilote, pièces attendues définies.
- Génération d'un lien signé ; le lien ouvre bien le portail.
- Upload d'un PDF de test ; le fichier apparaît dans SharePoint.
- Remplacement (update) du même PDF.
- Suppression du PDF.
- Si flow DOWNLOAD configuré : prévisualisation OK.
- Email d'invitation reçu (si `SEND_INVITATIONS` configuré).
- Relance reçue uniquement pour les dossiers incomplets.

### 14.3 Exploitation

- Service auto-démarré au boot, redémarre après crash.
- Logs collectés et lisibles (journald / NSSM rotation).
- Supervision `/health` configurée ; alerte sur 3 échecs consécutifs.
- Backup SQLite quotidien planifié.
- Procédure de restauration testée (§8.3).
- Rotation de `PORTAL_LINK_SECRET` documentée et testée (§10.2).
- DRP : RTO/RPO consignés.
- Contacts DSI / métier formalisés (§16).

---

## 15. Désactivation / décommissionnement

1. Arrêter le service.
2. Désactiver l'auto-start (`systemctl disable` / `nssm remove`).
3. Sauvegarder `admin.db` (dernière copie) vers archive immuable.
4. Supprimer le secret du coffre-fort (rotation pour neutraliser les
  liens encore en circulation).
5. Désactiver les flows Power Automate (ou réinitialiser leurs URLs).
6. Mettre une page 410 Gone côté reverse proxy pour `/depot` (3 mois).
7. Supprimer le DNS public.

---

## 16. Contacts et escalade


| Rôle               | Personne / équipe     | Cas d'escalade                                                   |
| ------------------ | --------------------- | ---------------------------------------------------------------- |
| Exploitation N1    | Help Desk DSI         | Échec `/health`, redémarrage service                             |
| Exploitation N2    | Équipe Apps Métier    | Erreurs `flow`, latence, restauration                            |
| Sécurité           | RSSI / SOC            | Compromission secret, abus rate-limit, signalement vulnérabilité |
| Métier             | Équipe Concours / DPM | Création de projets, gestion d'entreprises                       |
| Éditeur applicatif | Équipe développement  | Correctifs majeurs, montée de version                            |


Compléter ce tableau avec les coordonnées internes avant la mise en service.

---

## Annexe — Commandes utiles

```bash
# Vérifier l'état runtime
curl -fsS http://127.0.0.1:3001/readyz | jq

# Lister les liens révoqués (admin local)
curl -fsS http://127.0.0.1:3001/api/admin/invitations/revoked?limit=20 | jq

# Lancer manuellement la purge / scrub
curl -fsS -X POST http://127.0.0.1:3001/api/admin/maintenance/cleanup | jq

# Audit production (CVE sur dépendances runtime uniquement)
npm run audit:prod

# Sauvegarde SQLite à chaud
sqlite3 admin.db ".backup 'admin-$(date +%F).db'"
```

