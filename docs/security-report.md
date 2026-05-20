# Rapport de sécurité

Date d'émission : 2026-05-12
Périmètre : `portail-entreprise` (Express 5 + React 18 + PostgreSQL + Power Automate e-mails + stockage local VPS).

Ce document est destiné à la DSI et à l'équipe sécurité. Il décrit
**exhaustivement** :

- Les fonctionnalités exposées au métier (admin + entreprise) ;
- Les contrôles de sécurité implémentés et leur localisation dans le code ;
- Les hypothèses de menace, la surface d'attaque, et les contre-mesures.

Voir aussi :

- [`docs/security-audit-2026-04.md`](security-audit-2026-04.md) : historique
  d'audit (27 findings, état au 2026-04-22).
- [`docs/deployment-guide.md`](deployment-guide.md) : déploiement et exploitation.

---

## 1. Synthèse exécutive

| Domaine | État |
| --- | --- |
| Surface publique | 1 chemin (`/depot`) + assets — toutes les autres routes sont restreintes. |
| Authentification entreprise | Lien signé HMAC-SHA256 — pas de mot de passe, pas de session. |
| Authentification admin | Restreint au socket loopback de l'hôte (`req.socket.remoteAddress`). |
| Chiffrement en transit | HTTPS terminé au reverse proxy + HSTS app. |
| Chiffrement au repos | Métadonnées en PostgreSQL ; fichiers déposés sur le disque local du portal (`PORTAL_UPLOAD_STAGING_DIR`). |
| OWASP Top 10 (2021) couverture | A01..A10 traités, voir §6. |
| CVE production (npm audit) | 0 |
| Auditabilité | Journal `audit_log` SQLite, scrub à 90 j, hash conservé. |
| Conformité RGPD | Base contractuelle, données limitées au strict nécessaire, durée de rétention paramétrable. |
| Mode production durci | Refus de démarrage si secret faible / flow manquant / build absent / variable VITE_* sensible exposée. |

---

## 2. Fonctionnalités exposées

### 2.1 Interface entreprise — `/depot`

| Capacité | Endpoint UX | Endpoint API | Contrôles appliqués |
| --- | --- | --- | --- |
| Ouvrir le portail | `GET /depot?ctx=&sig=&alg=HS256` | — | Signature HMAC, `exp`, `deadline`, payload complet, non révoqué |
| Lister les pièces reçues | onglet "Reçues" | `POST /api/portal/documents` | Signature à nouveau vérifiée, budget journalier, rate-limit |
| Déposer une pièce | bouton "Déposer" | `POST /api/portal/upload` | Signature, document autorisé, taille fichier, rate-limit upload, budget |
| Remplacer une pièce | bouton "Remplacer" | `POST /api/portal/update` | Signature, document autorisé, référence locale vérifiée, type de pièce contrôlé |
| Supprimer une pièce | bouton "Supprimer" | `POST /api/portal/delete` | Signature, document autorisé, identifiant vérifié, audit |
| Prévisualiser / télécharger | bouton "Aperçu" | `POST /api/portal/download` | Signature, `filePath` dans le dossier de l'invitation, type MIME inféré côté client |
| Suivi visuel (progression, échéance, contact) | bandeau & cartes | — | Affichage uniquement après vérification (sinon `AccessGateScreen` minimal) |

### 2.2 Console d'administration — `/admin`

| Capacité | Endpoint UX | Endpoint API |
| --- | --- | --- |
| Lister les projets | tableau "Projets" | `GET /api/admin/projects` |
| Vue overview avec progression | tableau "Vue d'ensemble" | `GET /api/admin/overview` |
| Créer / éditer un projet | formulaire | `PUT /api/admin/projects/:id` |
| Archiver / désarchiver | bouton | `POST /api/admin/projects/:id/archive` |
| Supprimer un projet | bouton (confirmation typée) | `DELETE /api/admin/projects/:id` |
| Ajouter / éditer une entreprise | formulaire | `PUT /api/admin/projects/:projectId/companies/:companyId` |
| Supprimer une entreprise | bouton (confirmation) | `DELETE /api/admin/companies/:id` |
| Générer un lien signé | bouton "Générer le lien" | `POST /api/admin/invitations/sign` |
| Révoquer un lien signé | bouton "Révoquer" | `POST /api/admin/invitations/revoke` |
| Lister les liens révoqués | onglet "Révocations" | `GET /api/admin/invitations/revoked` |
| Envoyer un email d'invitation | bouton "Envoyer invitations" | `POST /api/admin/projects/:id/send-invitations` |
| Envoyer une relance | bouton "Envoyer relances" | `POST /api/admin/projects/:id/send-reminders` |
| Forcer une purge / scrub | bouton "Maintenance" | `POST /api/admin/maintenance/cleanup` |
| État technique | bandeau | `GET /api/admin/security` |
| Inspecter les dépôts locaux pour debug | suivi admin | `GET /api/admin/projects/:id/documents` |

Toutes ces routes sont protégées par le middleware `requireLocalAdmin`
(`server/index.js:287-293`) qui refuse toute requête dont
`req.socket.remoteAddress` n'est pas `127.0.0.1` ou `::1`.

### 2.3 Supervision

| Endpoint | Méthode | Réponse |
| --- | --- | --- |
| `/health` | GET | `{ ok: true, service, now }` |
| `/readyz` | GET | `{ ok, errors[], warnings[], signingEnabled, buildReady, flows }` |
| `/robots.txt` | GET | `User-agent: *\nDisallow: /` |

`/readyz` retourne `503` si une dépendance critique manque, ce qui empêche
un orchestrateur de basculer du trafic vers une instance non prête.

---

## 3. Architecture de sécurité

### 3.1 Modèle de confiance

- **Aucune** confiance accordée au navigateur entreprise au-delà du payload
  signé (HMAC-SHA256). Toutes les opérations documentaires sont vérifiées
  serveur (signature + appartenance au dossier + type de pièce attendu).
- **Confiance restreinte** accordée à l'admin local : il peut générer ou
  révoquer un lien, mais ne peut pas contourner la signature (la clé
  HMAC reste serveur). Une compromission de l'hôte admin compromet
  toutefois la confidentialité de la clé : voir §10.
- **Confiance étendue** accordée à Power Automate pour l'envoi d'e-mails uniquement.
  Les URLs des flows mail sont des secrets serveurs.

### 3.2 Chaîne de vérification d'une requête entreprise

```
Requête HTTPS
  ↓
Reverse proxy
  - TLS terminaison
  - ACL /admin
  ↓
Express
  - Trust proxy paramétrable
  - express.json (limite PORTAL_MAX_BODY_MB)
  - Rate-limit (/api/portal, bucket dédié /upload)
  - Headers de sécurité (CSP, HSTS, COOP, CORP, X-Frame-Options, X-Robots-Tag)
  - requireTrustedBrowserOrigin (sec-fetch-site + Origin/Host)
  ↓
Route /api/portal/*
  - getVerifiedInvitationFromBody
    - normalize ctx, sig, alg
    - HMAC-SHA256 timing-safe equal
    - exp + deadline
    - payload completness check
    - revoked list check
  - checkSubmissionDailyBudget (avant flow)
  - resolveInvitationDocument (documentId autorisé)
  - verifyFileReferenceAndDocumentType (filePath/fileIdentifier scoped invitation)
  - callFlow Power Automate (timeout 120s)
  - commitSubmissionDailyBudget (après succès)
  ↓
Réponse JSON
```

Tout maillon manquant produit `400`, `403`, `429`, ou `503` selon la nature.

### 3.3 Composants notables (mapping code)

| Composant | Fichier | Référence |
| --- | --- | --- |
| Signature HMAC + vérification | `server/security.js` | `verifySignedInvitation`, `persistAndSignInvitation` |
| Sanitization payload signé | `server/security.js` | `sanitizeInvitationContext` |
| Normalisation chemin dossier | `shared/folderPath.js` | partagé client/serveur |
| Catalogue documents canonique | `src/config/documentCatalog.js` | `normalizeDocumentId`, `resolveDocumentList` |
| Garde locale admin | `server/index.js` | `requireLocalAdmin` |
| Garde signed link HTML | `server/index.js` | `requireSignedDepotLink` |
| Garde signed link Vite dev | `vite.config.js` | plugin `signedPortalGuardPlugin` |
| Headers HTTP | `server/index.js` | bloc CSP + HSTS + Robots |
| Rate-limit | `server/index.js` | `rateLimit` x2 |
| Budget journalier | `server/db.js`, `server/index.js` | `bumpSubmissionDailyUsage` / `checkSubmissionDailyBudget` |
| Revocation list | `server/db.js`, `server/index.js` | `revokeInvitation`, `isInvitationRevoked` |
| Audit log | `server/db.js`, `server/index.js` | `writeAuditLog`, `scrubOldAuditPayloads` |
| Maintenance auto | `server/index.js` | `runScheduledCleanup` (toutes 24h) |
| Gate UI client | `src/app/App.jsx` | `AccessGateScreen` (rendu si non vérifié) |

---

## 4. Patterns de sécurité détaillés

### 4.1 Authentification capacité-basée (lien signé)

- **Format** : `inv` (UUID opaque, clé en base) + `sig` (HMAC-SHA256 de `inv`, base64url) + `alg=HS256`. Le payload métier est stocké dans `signed_invitations` (PostgreSQL), pas dans l'URL.
- **Comparaison** : `crypto.timingSafeEqual` pour éviter les attaques temporelles.
- **Champs garantis dans le payload** : `companyId`, `companyName`,
  `submissionId`, `dossierId`, `folderPath`, `documents`, `nonce`, `iat`,
  `exp`, `deadline`. Servis au client via `POST /api/portal/verify` après contrôle HMAC.
- **Durée de vie** : `exp` (par défaut 30 jours) + double porte `deadline`
  (cut-off métier indépendant). Plafond serveur 1 an
  (`PORTAL_LINK_TTL_MAX_MINUTES`).
- **Révocation** : table `revoked_invitations` indexée par l'UUID `inv`.
  Vérifiée à chaque appel API et à l'accès HTML.
- **Rotation** : changer `PORTAL_LINK_SECRET` invalide tous les liens
  existants (cf. §10.2 du guide de déploiement).

### 4.2 Confinement par invitation

- Chaque appel API exige le triplet `(inv, sig, alg)`. Le serveur ne se
  fie **jamais** aux paramètres "métier" que le navigateur enverrait en
  parallèle (companyId, folderPath, etc.) : il les **reconstruit depuis le
  payload signé**.
- `resolveInvitationDocument` : le `documentId` envoyé doit appartenir à
  la liste signée. Tout autre type est `403`.
- `ensurePathWithinFolder` + `ensureFileReferenceAllowed` : le `filePath`
  ou `fileIdentifier` envoyé doit être (1) à l'intérieur du `folderPath`
  signé ou (2) reconnu dans les enregistrements locaux du périmètre
  `(dossierId, companyId, submissionId)` signé.
- `verifyFileReferenceAndDocumentType` : sur `update` / `delete`, le type
  réel du document local est croisé avec le `documentId` envoyé pour
  empêcher un attaquant de remplacer un KBIS par un fichier URSSAF.

### 4.3 Headers HTTP durcis

Émis sur **toutes** les réponses (`server/index.js`) :

```
Content-Security-Policy: default-src 'self'; base-uri 'self';
  frame-ancestors 'none'; form-action 'self'; object-src 'none';
  script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' blob:
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: camera=(), geolocation=(), microphone=()
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains   (prod)
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-Robots-Tag: noindex, nofollow, noarchive, nosnippet
Cache-Control: no-store          (sur /api, /health, /readyz, /admin, /depot)
```

Notes :

- `style-src` autorise `'unsafe-inline'` pour permettre les feuilles de
  style injectées par React lors du build. Aucun script inline n'est
  autorisé (`script-src 'self'`).
- `frame-ancestors 'none'` + `X-Frame-Options: DENY` : double protection
  anti-clickjacking.
- `Permissions-Policy` : caméra / géolocalisation / micro désactivés.

### 4.4 Anti-CSRF / cross-origin

- Le portail n'utilise **aucun cookie d'authentification**. La
  signature est dans le corps JSON, donc le navigateur d'un tiers ne peut
  pas la "rejouer" depuis un autre site sans la connaître.
- En complément, `requireTrustedBrowserOrigin` (`server/index.js:331`)
  rejette toute requête mutante avec `Sec-Fetch-Site: cross-site` ou un
  `Origin` qui ne matche pas le `Host` (et l'URL publique configurée).

### 4.5 Rate-limit en couche

| Couche | Mécanisme | Effet |
| --- | --- | --- |
| `/api/portal/*` | `express-rate-limit` (60/min IP, hors `/upload`) | Anti-DoS basique |
| `/api/portal/upload` | `express-rate-limit` (10/min IP) | Limite ingestion lourde |
| `submissionId` quotidien | SQLite `submission_daily_budget` (300/jour) | Anti-abus par invitation, indépendant de l'IP |
| Power Automate timeout | `AbortSignal.timeout` (120 s) | Évite la rétention de threads |
| Body size | `express.json({ limit })` | Refuse les payloads > `PORTAL_MAX_BODY_MB` |
| File size | `maxFileContentChars` | Refuse les `fileContent` base64 > `PORTAL_MAX_FILE_MB` (33% marge) |

Le bucket général **ne pénalise pas** les uploads (`skip` explicite). Le
budget journalier est débité **après** succès du flow (sinon un échec
Power Automate consommerait du quota gratuitement).

### 4.6 Audit, traçabilité, scrub

Actions auditées :
`admin.invitation.sign`, `admin.invitation.revoke`,
`admin.invitations.send`, `admin.invitations.remind`,
`admin.project.upsert`, `admin.project.delete`, `admin.project.archive`,
`admin.project.unarchive`, `admin.company.upsert`, `admin.company.delete`,
`admin.maintenance.cleanup`.

Chaque entrée stocke :

- IP source (`actorIp`)
- action (constante)
- payload JSON détaillé
- `payloadHash` = `sha256(payload)` (résiste au scrub)
- `createdAt`

Après 90 jours, `payload` est remplacé par `'{}'`. Le `payloadHash` et
l'action restent disponibles pour preuve d'intégrité.

### 4.7 Protection contre l'exposition de secrets côté frontend

- Liste noire `SENSITIVE_PUBLIC_ENV_KEYS` interdite au build (script
  `scripts/check-public-env.mjs`).
- Liste noire identique côté serveur (`server/index.js`) : si une telle
  variable est présente à `process.env`, le serveur **quitte** en
  production.
- Diagnostic au démarrage (`getStartupDiagnostics`) :
  - Secret manquant ou faible → erreur (`isWeakSigningSecret` ≥ 32 octets,
    pas de mot interdit).
  - Flows critiques manquants → erreur.
  - Flow DOWNLOAD manquant → warning (preview désactivé).
  - `PORTAL_ADMIN_DB_PATH` non défini → warning (chemin par défaut peu sûr).
  - URL publique non-HTTPS en production → warning.

### 4.8 Robustesse opérationnelle

- **Démarrage** : `process.exit(1)` en production si diagnostics fatals.
- **Arrêt propre** : `SIGINT` / `SIGTERM` → `server.close()` + timeout 10 s.
- **Maintenance scheduling** : `setTimeout(runScheduledCleanup, 30s)` puis
  `setInterval(... , 24h)` (`unref()` pour ne pas bloquer la terminaison).
- **SQLite** : `journal_mode=WAL`, `foreign_keys=ON`, prepared statements.
- **Migrations** : `ensureColumn` pour les colonnes ajoutées après coup
  (`customDocuments`, `archivedAt`).
- **Timer cleanup** : `clearTimeout` + `clearInterval` au shutdown.

### 4.9 Sécurité côté client

- L'écran `AccessGateScreen` s'affiche **avant** tout chargement du shell
  portail tant que le lien n'a pas été vérifié.
  En cas de cache stale ou de bypass futur, l'utilisateur ne voit ni
  marque, ni email de contact, ni structure du portail.
- `URL.revokeObjectURL` systématique sur les previews (anti-fuite mémoire).
- `base64ToBytes` enveloppe `atob` dans un `try/catch` (anti-crash sur
  payload corrompu).
- Pas de `dangerouslySetInnerHTML`, pas d'injection HTML dynamique.

---

## 5. Hypothèses de menace (STRIDE)

| Menace | Surface | Mitigation |
| --- | --- | --- |
| **S**poofing — emprunter une autre entreprise | `/depot`, `/api/portal/*` | Lien signé HMAC unique par entreprise + `companyId` signé |
| **T**ampering — modifier folderPath / documents autorisés | URL `ctx` | HMAC ; toute altération produit `invalid_sig` |
| **R**epudiation — nier avoir déposé / supprimé une pièce | API portail | `audit_log` + `payloadHash` + IP + horodatage |
| **I**nformation disclosure — récupérer un fichier d'une autre entreprise | `/api/portal/download` | `ensureFileReferenceAllowed` + `folderPath` signé + contrôle d'appartenance au record local |
| **D**enial of Service — saturer le portail | `/api/portal/upload` | Rate-limit IP + budget journalier par submissionId + body limit + timeout flow |
| **E**levation of privilege — atteindre l'admin | `/admin`, `/api/admin/*` | `requireLocalAdmin` (socket loopback) + ACL reverse proxy |
| Replay d'un lien valide après remise en main | `/depot` | `exp` + révocation manuelle |
| Replay après expiration | `/depot` | `exp` vérifié serveur + double `deadline` |
| Brute force du HMAC | `sig` | 256 bits, `timingSafeEqual`, secret ≥ 32 octets imposé |
| XSS injection via payload | `companyName`, document labels | Pas de `dangerouslySetInnerHTML`, CSP `script-src 'self'` |
| Clickjacking | `/depot`, `/admin` | `frame-ancestors 'none'` + `X-Frame-Options: DENY` |
| Indexation moteurs | `/depot`, `/admin` | `robots.txt`, `X-Robots-Tag`, `<meta name="robots">` |
| Smuggling via proxy | `/api/portal/*` | `requireTrustedBrowserOrigin` + `TRUST_PROXY` conservateur |
| Exposition secrets au navigateur | build Vite | Liste noire `VITE_*` + check pré-build + check démarrage serveur |
| Compromission de l'hôte admin | `/admin` | Hors périmètre app : politique OS (MFA, AD, bastion) |
| Compromission du disque portal | staging local | Chiffrement disque + sauvegardes + durcissement OS |

---

## 6. Couverture OWASP Top 10 (2021)

| Catégorie | Mitigation |
| --- | --- |
| **A01** Broken Access Control | Lien signé scopé + `requireLocalAdmin` + path & document constraints + revoke list |
| **A02** Cryptographic Failures | HMAC-SHA256, `timingSafeEqual`, secret ≥ 32 octets imposé, TLS au proxy + HSTS |
| **A03** Injection | SQLite **prepared statements only** (`db.prepare`) ; pas d'`eval` ; pas d'innerHTML utilisateur |
| **A04** Insecure Design | Confinement par invitation (capacité), refus de démarrage si config critique manque |
| **A05** Security Misconfiguration | Diagnostics au démarrage, CSP/HSTS/COOP/CORP/X-Frame-Options/X-Robots-Tag, `.env` hors repo |
| **A06** Vulnerable & Outdated Components | `npm audit:prod` zéro CVE, dépendances minimales (5 directes prod), CI conseillée |
| **A07** Identification & Authentication Failures | Pas de session web : capacité signée + révocation + `exp` + `deadline` ; admin via OS |
| **A08** Software & Data Integrity Failures | `package-lock.json` versionné, build immuable (`assets/*` hash) |
| **A09** Security Logging & Monitoring Failures | `audit_log` + endpoints `/health`, `/readyz`, scrub 90j, payloadHash résistant |
| **A10** Server-Side Request Forgery | Les URLs de flow sont fixes dans l'environnement, jamais dérivées du client |

---

## 7. Variables d'environnement (vue sécurité)

| Variable | Confidentialité | Conséquence si fuite |
| --- | --- | --- |
| `PORTAL_LINK_SECRET` | **Critique** | Génération de liens d'accès illégitimes — rotation requise |
| `POWER_AUTOMATE_*_URL` | **Élevée** | Appel direct anonyme aux flows depuis Internet — régénérer les triggers |
| `PORTAL_ADMIN_DB_PATH` | Faible | Localise un fichier dont l'accès est déjà restreint par l'OS |
| `CLIENT_PORTAL_PUBLIC_URL` | Aucune | Donnée publique |
| `VITE_*` (branding) | Aucune | Donnée déjà visible dans le bundle |
| `TRUST_PROXY` | Faible | Mauvaise valeur expose des IP forgées dans les logs |
| `PORTAL_HSTS_*` | Faible | Erreur de configuration HSTS (rollback de TLS difficile si `preload`) |

---

## 8. Limites connues et choix conscients

1. **Pas d'authentification forte côté admin** : choix volontaire pour
   simplifier le déploiement on-prem ; remplacé par contrôle d'accès OS.
   Mention dans la roadmap (Entra ID ou reverse proxy auth).
2. **SQLite mono-instance** : suffisant pour des dizaines de projets et
   centaines d'entreprises. Pour passer à l'échelle, refactor vers
   PostgreSQL (cf. roadmap P2).
3. **Rate-limit en mémoire** : reset à chaque redémarrage et non partagé.
   Pour un déploiement multi-instances, brancher un store partagé
   (cf. N-07 dans `security-audit-2026-04.md`).
4. **Pas de scan antivirus intégré** : les fichiers sont stockés tels quels
   sur le disque local. Antivirus = responsabilité de l'hôte / DSI.
5. **Upload base64/JSON** : surcoût RAM +33%. Refactor multipart streaming
   prévu (P-02 dans l'audit 2026-04).
6. **N+1 sur `/api/admin/projects`** : volumes attendus faibles, refactor
   SQL prévu (P-01).
7. **Payload du lien lisible côté client** (base64) : l'HMAC garantit
   l'intégrité, pas la confidentialité. Si le besoin émerge de cacher
   `submissionId` ou `documents` au porteur du lien, signer un ID
   opaque côté serveur (S-05 dans l'audit).

---

## 9. Mises à jour récentes (2026-05-12)

- **Dépendances** : `express-rate-limit` mis à jour pour fermer l'avis
  modéré `ip-address` (GHSA-v2v4-37r5-5v8g). `postcss` mis à jour
  (GHSA-qx2v-qp2m-jg93, build-time uniquement). `npm audit` retourne
  zéro vulnérabilité (prod et dev).
- **HSTS** : header `Strict-Transport-Security` émis par défaut en
  production. Trois variables d'ajustement
  (`PORTAL_FORCE_HSTS`, `PORTAL_HSTS_MAX_AGE`, `PORTAL_HSTS_INCLUDE_SUBDOMAINS`,
  `PORTAL_HSTS_PRELOAD`).
- **`X-Robots-Tag`** : header `noindex, nofollow, noarchive, nosnippet`
  systématique sur toutes les réponses applicatives.
- **`/robots.txt`** : nouvel endpoint serveur (`User-agent: *\nDisallow: /`).
- **`<meta name="robots">`** : ajouté aux entrées `index.html` et
  `admin.html`.
- **Documentation** : ajout de `docs/deployment-guide.md` et du
  présent rapport.
- **Réorganisation des docs** : `POWER AUTOMATE FLOW.md` déplacé en
  `docs/security-audit-2026-04.md` ; titres harmonisés en français.

---

## 10. Recommandations à 12 mois

| Recommandation | Priorité | Lien |
| --- | --- | --- |
| Authentifier l'admin via Entra ID / reverse proxy SSO | Haute | Roadmap P2 |
| Externaliser `admin.db` (PostgreSQL) en multi-instance | Moyenne | Roadmap P2 |
| Antivirus sur les pièces déposées (Defender / scan ICAP) | Moyenne | Roadmap P3 |
| Upload streaming multipart (suppression overhead base64) | Moyenne | Audit P-02 |
| Export hors-bande de `audit_log` (SIEM) | Moyenne | Cf. DSI §9.3 |
| CI : `npm audit:prod` + build à chaque PR | Moyenne | À implémenter |
| Tests automatisés sur signature / vérification / scoping | Moyenne | Roadmap P1 |
| Signer un ID opaque au lieu du payload (révocation par lot) | Basse | Audit S-05 |

---

## Annexe — Empreinte de surface réseau

| Service exposé | Listener par défaut | Authentification | Sensibilité |
| --- | --- | --- | --- |
| Node Express | `0.0.0.0:3001` (ou loopback selon proxy) | Aucune sur HTTP, déléguée à la couche signature | Doit rester derrière le reverse proxy |
| SQLite | Filesystem local | Filesystem (compte de service) | Métadonnées et audit |

Aucun port additionnel n'est ouvert par l'application. Aucune écoute UDP.
Aucun socket Unix custom. Aucun thread worker externe.
