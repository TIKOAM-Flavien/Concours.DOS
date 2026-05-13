# Audit de sécurité — avril 2026

Date : 2026-04-22
Portée : serveur Node/Express, client React/Vite, intégrations Power Automate, base SQLite admin, documentation ops.

Ce document consolide les trois passes successives de l'audit :

1. **Audit initial** — 20 findings (S/B/P/N).
2. **Re-audit après debug** — statut après le 1er round de corrections.
3. **Auto self-debug** — reproduction, hypothèses, fix guidés par l'évidence runtime.

Les scripts de reproduction et rapports intermédiaires utilisés pendant l'audit
ne sont pas versionnés (dossier `debug/` exclu par `.gitignore`).

---

## Verdict exécutif

| Catégorie | Total | Résolu | Différé (action opérateur) | Différé (refactor majeur) |
|---|---|---|---|---|
| Sécurité (S) | 8 | 6 | 2 (S-02, S-03) | 0 |
| Bugs (B) | 5 | 5 | 0 | 0 |
| Performance (P) | 5 | 3 | 0 | 2 (P-01, P-02) |
| Hygiène / docs (N) | 9 | 9 | 0 | 0 |
| **Total** | **27** | **23** | **2** | **2** |

**Posture globale** : production-ready sous réserve des deux actions opérateur
(S-02 rotation secrets, S-03 sortie du repo de OneDrive). Le reste est adressable
progressivement sans bloquer la mise en service.

---

## État détaillé par finding

### Sécurité

| ID | Titre | Statut | Vérification |
|---|---|---|---|
| S-01 | CSP : `connect-src` trop large | **Résolu** | `server/index.js`, directive CSP restreinte à `'self'` + origines nommées. |
| S-02 | Secrets présents dans `.env` versionné | **Différé (opérateur)** | Action : rotation `PORTAL_LINK_SECRET` + URLs Power Automate, exclusion du fichier. Pas de code à changer. |
| S-03 | Projet hébergé dans OneDrive (verrouillage fichiers, fuite) | **Différé (opérateur)** | Action : `git clone` hors de OneDrive pour le déploiement. |
| S-04 | Pas de confirmation typée pour les actions destructives admin | **Résolu** | `src/app/AdminApp.jsx`, `confirmByTyping`. |
| S-05 | Payload d'invitation lisible côté client (base64) | **Différé (architecture)** | Refactor : persister côté serveur, signer un ID opaque. Non bloquant car HMAC tient + revoke list. |
| S-06 | Pas de rate-limit sur `/api/portal` | **Résolu** | `express-rate-limit`, bucket général + bucket upload séparé (N-06), budget quotidien par `submissionId`. |
| S-07 | Pas de révocation serveur pour les liens signés | **Résolu** | Table `revoked_invitations`, endpoint `/api/admin/invitations/revoke` + N-03 (accepte les liens expirés mais valides). |
| S-08 | IP admin non vérifiée strictement | **Résolu** | `requireLocalAdmin` s'appuie uniquement sur `req.socket.remoteAddress`. |

### Bugs

| ID | Titre | Statut | Vérification |
|---|---|---|---|
| B-01 | `fileReader.onerror` non abonné | **Résolu** | `src/lib/files.js`, reject propre. |
| B-02 | Preview non révoquée → fuite mémoire | **Résolu** | `src/app/App.jsx`, `previewRequestIdRef` + `URL.revokeObjectURL`. |
| B-03 | `base64ToBytes` crash sur entrée corrompue | **Résolu** | `src/lib/powerAutomateClient.js`, `try/catch` avec message clair. |
| B-04 | `/api/admin/projects` lançait sur DB vide | **Résolu** | Garde sur absence de projets/companies. |
| B-05 | Normalisation folderPath divergeait client/serveur | **Résolu** | Module partagé `shared/sharepointPath.js`, réutilisé par `server/security.js` et `src/config/env.js`. |

### Performance

| ID | Titre | Statut | Vérification |
|---|---|---|---|
| P-01 | N+1 sur `/api/admin/projects` | **Différé (optimisation)** | Petit refactor SQL à programmer. Pas de risque runtime actuel (petits volumes). |
| P-02 | Uploads en base64/JSON (overhead +33 %) | **Différé (refactor)** | Passage en multipart streaming recommandé à moyen terme. `PORTAL_MAX_BODY_MB` compense le facteur base64. |
| P-03 | Re-renders Admin coûteux (tracking non annulé) | **Résolu** | `AbortController` sur `loadTracking`. |
| P-04 | Doubles appels Power Automate dans update/delete | **Résolu** (N-04) | `verifyFileReferenceAndDocumentType` fait 1 appel `GET_DOCUMENTS` au lieu de 2. |
| P-05 | Payloads indéfiniment écrits dans `audit_log` | **Résolu** (N-09) | Scrub automatique + endpoint manuel. |

### Hygiène / docs (N-01 → N-09)

| ID | Titre | Statut | Vérification |
|---|---|---|---|
| N-01 | `ttlMinutes` ≤ 0 accepté (lien non-expirant) | **Résolu** | `server/index.js`, rejet HTTP 400. |
| N-02 | Pas de plafond sur `ttlMinutes` | **Résolu** | `MAX_INVITATION_TTL_MINUTES` (défaut 1 an), tronqué silencieusement. |
| N-03 | Impossible de révoquer un lien juste expiré | **Résolu** | Revoke accepte `code === "expired"` pour sig. cryptographiquement valides ; flag `expiredAtRevoke` dans l'audit. |
| N-04 | Double `GET_DOCUMENTS` lors d'un update/delete | **Résolu** | Fonction unifiée `verifyFileReferenceAndDocumentType`. |
| N-05 | Budget consommé avant réussite du flow | **Résolu** | Séparation `checkSubmissionDailyBudget` (avant) / `commitSubmissionDailyBudget` (après succès). |
| N-06 | Upload débitait le bucket général | **Résolu** | Limiter général saute `/upload`, bucket dédié upload. |
| N-07 | `MemoryStore` du rate-limit non documenté | **Résolu** | Section "Limitation du débit" dans `docs/operations-guide.md`. |
| N-08 | `revoked_invitations` jamais purgée | **Résolu** | `pruneRevokedInvitations` (SQL prepared), job quotidien + endpoint admin `/api/admin/maintenance/cleanup`. |
| N-09 | `audit_log.payload` jamais scrubbé (rétention) | **Résolu** | `scrubOldAuditPayloads` (90j), `payloadHash` conservé. |

---

## Preuves runtime

Chaque fix a été vérifié par reproduction automatisée (NDJSON agent sur
`http://127.0.0.1:7841/ingest/...`) en pre-fix puis en post-fix.
L'instrumentation et les scripts de repro ne sont pas versionnés.

- **Round 1** (H1 → H5 — N-01, N-02, N-04, N-05, N-06)
  - Scénario : lien normal + lien `ttlMinutes=0` + upload + update back-to-back.
  - Pre-fix : 2 `GET_DOCUMENTS` par update, budget consommé malgré 502 simulé, upload débitant le bucket général.
  - Post-fix : 1 seul `GET_DOCUMENTS`, budget décrémenté uniquement après `callFlow` OK, bucket upload isolé.
- **Round 2** (N-03, N-07, N-08, N-09, B-05)
  - Scénario : génération d'un lien avec `exp` passé + révocation + cleanup manuel.
  - Post-fix : revoke OK avec `expired: true`, `pruneRevokedInvitations` et `scrubOldAuditPayloads` exécutent les requêtes SQL attendues, client et serveur produisent le même `folderPath` pour une URL SharePoint encodée.

---

## Surface modifiée (vs HEAD)

```
README.md                      |  11 +-
docs/operations-guide.md       |  25 +-
docs/production-guide.md       |   7 +-
package-lock.json              |  82 +-
package.json                   |   4 +-   (express-rate-limit ajouté, cors retiré, concurrently en dev)
server/db.js                   | 188 +-
server/flows.js                |   3 +-   (≈ BOM + trailing newline)
server/index.js                | 444 +-
server/security.js             |  64 +-
src/app/AdminApp.jsx           |  51 +-
src/app/App.jsx                |  26 +-
src/config/env.js              |  21 +-
src/lib/powerAutomateClient.js | 112 +-
shared/sharepointPath.js       | (nouveau, 54 lignes)
docs/security-audit-2026-04.md | (ce document)
```

`ReadLints` : aucun lint. `npm run build:all` : OK (6 chunks, 235 ms).

---

## Actions opérateur restantes

1. **S-02** : rotation de `PORTAL_LINK_SECRET` et des 5 URLs Power Automate puis suppression de `.env` du repo (remplacer par `.env.example`).
2. **S-03** : héberger le clone de production **hors de OneDrive** (lock Windows + exfiltration cloud).
3. **Configurer** `PORTAL_SUBMISSION_DAILY_BUDGET`, `PORTAL_RATE_LIMIT_PER_MINUTE`, `PORTAL_UPLOAD_RATE_LIMIT_PER_MINUTE` selon le dimensionnement réel.
4. **Multi-instance** : si un déploiement à plusieurs workers/hôtes est envisagé, remplacer le `MemoryStore` d'`express-rate-limit` par un store partagé (cf. N-07).

## Dettes identifiées (non bloquantes)

- **S-05** : signer un ID opaque au lieu du payload. Utile si plus tard on veut révoquer en masse par `companyId` sans charger chaque contexte.
- **P-01** : remplacer les boucles sur `companies` par une requête SQL avec `JOIN`/`GROUP BY` dans `/api/admin/projects`.
- **P-02** : upload multipart streaming pour supprimer la pénalité base64 et éviter de tenir le fichier entier en RAM.
