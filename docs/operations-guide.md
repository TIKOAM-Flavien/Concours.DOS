# Guide d'exploitation

## Workflow admin

1. Ouvrir `http://localhost:3001/admin` depuis l'hote serveur.
2. Creer un projet avec `name`, `dossierId`, `folderPath`, et eventuellement
   `deadline`.
3. Ajouter les entreprises invitees avec leurs pieces attendues.
4. Generer le lien signe pour chaque entreprise.
5. Verifier dans la colonne Invitation si le lien est `Jamais ouvert` ou
   `Ouvert N fois`.
6. Suivre la reception dans le tableau de bord et relancer si necessaire.

## Base de donnees

- Moteur: PostgreSQL (`pg`, `DATABASE_URL` obligatoire).
- Schema: `server/db/schema.sql`, migrations au demarrage.
- Donnees metier partagees entre instances admin et portal.
- `invitation_events`: journal technique des ouvertures et verifications de
  liens signes. Les IPs sont stockees sous forme de hash, pas en clair.

Sauvegarde PostgreSQL (exemple):

```bash
pg_dump "$DATABASE_URL" -Fc -f "portail-$(date +%F).dump"
```

Volume fichiers (instance portal uniquement):

- Staging local: `PORTAL_UPLOAD_STAGING_DIR` (defaut `/data/uploads`).
- Inclure ce volume dans la politique de sauvegarde DSI.

## Sante de service

- `GET /health`: verifie que le process repond.
- `GET /readyz`: verifie build, secret et flows critiques.

Si `readyz` retourne `503`, corriger le point remonte avant de rouvrir le
service.

## Rotation du secret de signature

1. Remplacer `PORTAL_LINK_SECRET`.
2. Redemarrer le serveur.
3. Regenerer les liens d'invitation existants.

Effet attendu:

- les anciens liens ne sont plus valides ;
- les nouveaux liens generes depuis l'admin deviennent la source de verite.

## Expiration et revocation des liens

- Les liens signes portent une date d'expiration `exp`.
- A l'ouverture, le portail relit le projet, l'entreprise et les pieces
  attendues depuis PostgreSQL. Modifier la liste de pieces d'une entreprise
  dans l'admin suffit donc a mettre a jour le portail pour le meme lien signe.
- La generation de lien, l'envoi d'invitation et les relances reutilisent
  l'invitation active de l'entreprise lorsque celle-ci existe encore.
- Par defaut (si `PORTAL_LINK_TTL_MINUTES` n'est pas defini), la validite est de **30 jours**.
- Un plafond est applique a `ttlMinutes` cote serveur: `PORTAL_LINK_TTL_MAX_MINUTES` (defaut **525600** = 1 an). Toute valeur superieure est tronquee.
- `ttlMinutes = 0` (ou negatif) est refuse (HTTP 400) pour eviter les liens sans expiration.
- Un lien peut etre revoque a tout moment cote serveur (PostgreSQL). La revocation reste possible apres `exp` (utile pour tracer un lien divulgue tardivement).

API admin (locale uniquement):

- `POST /api/admin/invitations/sign` avec `context` et `ttlMinutes` (optionnel, borne par le plafond ci-dessus).
- `POST /api/admin/invitations/revoke` avec `inv`, `sig`, `alg` (optionnel, defaut `HS256`) et `reason` (optionnel).
- `GET /api/admin/invitations/revoked?limit=50` pour lister les liens revoques.
- `POST /api/admin/maintenance/cleanup` pour declencher manuellement la purge des liens revoques expires (>30j apres `exp`) et l'effacement du champ `payload` des entrees d'audit de plus de 90 jours. Le `payloadHash` est conserve.

## Limitation du debit (`rate limit`)

- Deux buckets en memoire (express-rate-limit, fenetre de 60s):
  - `/api/portal/*` (hors `/upload`): `PORTAL_RATE_LIMIT_PER_MINUTE` (defaut 60).
  - `/api/portal/upload`: `PORTAL_UPLOAD_RATE_LIMIT_PER_MINUTE` (defaut 10). Ce bucket **ne** deduit **pas** du bucket general.
- Budget quotidien par `submissionId` (PostgreSQL): `PORTAL_SUBMISSION_DAILY_BUDGET` (defaut 300). Un appel reussi consomme 1-2 unites.
- Les appels Power Automate sont bornes par `PORTAL_FLOW_TIMEOUT_MS` (defaut 120000 ms) pour eviter qu'une requete portail reste bloquee indefiniment.
- **Limitation connue (N-07):** le store des deux limiters est en memoire (`MemoryStore` par defaut). Il est remis a zero a chaque redemarrage et n'est **pas partage** entre instances. Pour un deploiement multi-process ou multi-host, substituer un store partage (Redis, Memcached) ou un reverse proxy avec limitation native.

## Depannage rapide

| Symptome | Cause probable | Action |
| --- | --- | --- |
| `403` sur `/depot` | lien invalide, expire, incomplet ou revoque | regenerer le lien depuis l'admin |
| `503` sur `/admin` ou `/depot` | build absent | lancer `npm run build:admin` / `build:portal` |
| `GET /readyz` en erreur | secret ou `DATABASE_URL` manquant | corriger l'env serveur |
| echec upload/update/delete | staging disque indisponible ou quota depasse | verifier `PORTAL_UPLOAD_STAGING_DIR` et l'espace disque portal |
| preview indisponible | fichier absent du staging ou record invalide | verifier `PORTAL_UPLOAD_STAGING_DIR` et les logs portal |
| entreprise non suivie dans l'admin | projet ou entreprise mal rattache | verifier le projet actif et les metadonnees en base |
| lien affiche `Jamais ouvert` | l'entreprise n'a pas encore charge le portail ou le frontend n'a pas appele `/api/portal/verify` | demander a l'entreprise de rouvrir le lien complet, puis actualiser l'admin |
| lien affiche ouvert sans depot | ouverture simple, prechargement mail ou abandon avant upload | verifier `lastOpenedAt`, relancer si le dossier reste incomplet |

## Journaux

Le serveur logge:

- les erreurs applicatives non attrapees ;
- les warnings de configuration au demarrage ;
- les echecs de verification ou d'appel de flow quand ils remontent.

Pour la production, brancher ces logs sur un collecteur central si possible.
