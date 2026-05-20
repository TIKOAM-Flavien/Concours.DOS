# Feuille de route

## Priorité 1

- Ajouter des tests automatises sur les routes Express critiques:
  signature, validation d'invitation, upload local, acces admin.
- Ajouter une vraie journalisation structuree avec correlation d'une invitation
  a une erreur de depot ou d'e-mail.
- Mettre en place des sauvegardes automatiques PostgreSQL + volume staging portal.
- Externaliser le rate-limit en store partage pour deploiements multi-instances portal.

## Priorité 2

- ~~Remplacer SQLite par PostgreSQL~~ **Livré** : `DATABASE_URL`, déploiement
  `PORTAL_APP_ROLE=admin|portal`, images GHCR séparées.
- ~~Stockage local VPS~~ **Livré** : staging
  `PORTAL_UPLOAD_STAGING_DIR`, finalisation synchrone des depots sur portal.
- Ajouter une authentification forte pour l'admin:
  Entra ID, VPN, ou reverse proxy avec auth.
- Conserver un journal d'audit des actions admin:
  creation projet, ajout entreprise, generation lien, suppression.
- Statuts d'invitation livrés (`generated`, `sent`, `expired`, `reissued`).

## Priorité 3

- Ajouter un scan antivirus / antimalware avant persistance finale des fichiers.
- Gerer des tailles de fichiers importantes via upload multipart et quotas disque.
- Exposer des exports CSV du suivi projet / entreprise.
- Automatiser la planification des relances (cron/Scheduler) en s'appuyant sur
  l'endpoint `POST /api/admin/projects/:id/send-reminders` (l'envoi manuel est
  deja dispo dans le tableau admin, flow `SEND_REMINDERS`).

## Conseil architecture

Architecture cible actuelle:

```text
Navigateur -> API metier (portal) -> PostgreSQL + staging local
Admin        -> API metier (admin)  -> PostgreSQL
Les deux     -> Power Automate     -> e-mails uniquement
```

Pistes d'evolution:

- authentification admin via Entra ID au reverse proxy ;
- observabilite (metrics, traces) sur les depots et envois d'e-mails ;
- retention et purge automatique des fichiers staging selon politique metier.

## Optimisation

Constat actuel:

- le bundle frontend reste raisonnable ;
- le goulet d'etranglement principal est le disque / reseau sur l'instance portal.

Optimisations utiles ensuite:

- compresser les reponses HTTP si le volume augmente ;
- cache court sur les lectures admin si la base grossit ;
- eviter les refresh complets apres chaque action en renvoyant un record
  normalise depuis le serveur ;
- tracer la duree des appels Power Automate pour identifier les flows lents.
