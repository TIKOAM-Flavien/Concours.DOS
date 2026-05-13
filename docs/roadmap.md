# Feuille de route

## Priorité 1

- Ajouter des tests automatises sur les routes Express critiques:
  signature, validation d'invitation, proxy upload/update/delete.
- Ajouter une vraie journalisation structuree avec correlation d'une invitation
  a une erreur de flow.
- Mettre en place des sauvegardes automatiques de `admin.db`.
- Poser une limite de debit sur les routes `/api/portal/*`.

## Priorité 2

- Remplacer SQLite par PostgreSQL si plusieurs operateurs doivent administrer
  le portail en parallele ou si l'hebergement devient distribue.
- Ajouter une authentification forte pour l'admin:
  Entra ID, VPN, ou reverse proxy avec auth.
- Conserver un journal d'audit des actions admin:
  creation projet, ajout entreprise, generation lien, suppression.
- Ajouter un statut d'invitation:
  generee, envoyee, expiree, reemise.

## Priorité 3

- Ajouter un scan antivirus / antimalware avant transmission finale.
- Gerer des tailles de fichiers importantes via upload multipart ou stockage
  temporaire serveur.
- Exposer des exports CSV du suivi projet / entreprise.
- Automatiser la planification des relances (cron/Scheduler) en s'appuyant sur
  l'endpoint `POST /api/admin/projects/:id/send-reminders` (l'envoi manuel est
  deja dispo dans le tableau admin, flow `SEND_REMINDERS`).

## Conseil architecture

Le point cle a moyen terme est d'eviter de faire porter toute la logique
metier a Power Automate. Une cible plus robuste serait:

```text
Navigateur -> API metier -> Stockage/SharePoint -> File d'evenements -> Automatisation
```

Cela permettrait:

- une validation plus fine des droits et du contenu ;
- un meilleur audit ;
- des retries maitrises ;
- une observabilite correcte ;
- moins de couplage aux webhooks directs de Power Automate.

## Optimisation

Constat actuel:

- le bundle frontend reste raisonnable ;
- le vrai goulet d'etranglement est reseau / SharePoint, pas React.

Optimisations utiles ensuite:

- compresser les reponses HTTP si le volume augmente ;
- ajouter un cache court sur les lectures admin si SharePoint est lent ;
- eviter les refresh complets apres chaque action en renvoyant un record
  normalise depuis le serveur ;
- tracer la duree des appels Power Automate pour identifier les flows lents.
