# Contrats des flows Power Automate

Référence unique entre le serveur Express et les flows Power Automate.

## Changement d'architecture

Les flows ne sont plus appeles directement par le navigateur.

```text
Browser -> Express -> Power Automate -> SharePoint
```

Consequences:

- les URLs des flows restent server-only ;
- les controles de signature se font dans Express ;
- les headers CORS ne sont plus requis pour le portail web.

## Flows attendus

Obligatoires (coeur du portail):

- `POWER_AUTOMATE_GET_DOCUMENTS_URL`
- `POWER_AUTOMATE_DOWNLOAD_FILE_URL`
- `POWER_AUTOMATE_UPLOAD_FILE_URL`
- `POWER_AUTOMATE_UPDATE_FILE_URL`
- `POWER_AUTOMATE_DELETE_FILE_URL`

Optionnels (emailing admin, cf. sections 6 et 7):

- `POWER_AUTOMATE_SEND_INVITATIONS_URL`
- `POWER_AUTOMATE_SEND_REMINDERS_URL`

## 1. GET_DOCUMENTS

### Input serveur -> flow

```json
{
  "dossierId": "concours-mediatheque-bordeaux",
  "companyId": "ENT-042",
  "companyName": "Soconer",
  "submissionId": "inv-2026-042"
}
```

`dossierId` est obligatoire.

### Output flow -> serveur

Un tableau JSON:

```json
[
  {
    "Name_extension": "kbis-mars-2026.pdf",
    "ServerRelativeUrl": "/teams/DEPOTS_MOE/BDD_reception_piece/kbis-mars-2026.pdf",
    "Identifier": "%252fteams%252fDEPOTS_MOE%252fBDD_reception_piece%252fkbis.pdf",
    "Link": "https://tenant.sharepoint.com/...",
    "Modified": "2026-03-26T10:18:55Z",
    "Length": 245781,
    "Entreprise_depot": "Soconer",
    "Type_piece": "KBIS",
    "Projet": "concours-mediatheque-bordeaux"
  }
]
```

## 2. DOWNLOAD_FILE

### Input serveur -> flow

```json
{
  "filePath": "/teams/DEPOTS_MOE/BDD_reception_piece/kbis-mars-2026.pdf"
}
```

### Output recommande

```json
{
  "success": true,
  "fileContent": "<base64-du-fichier>",
  "filePath": "/teams/DEPOTS_MOE/BDD_reception_piece/kbis-mars-2026.pdf",
  "fileName": "kbis-mars-2026.pdf"
}
```

## 3. UPLOAD_FILE

### Input serveur -> flow

```json
{
  "fileName": "kbis-mars-2026.pdf",
  "fileContent": "<base64>",
  "folderPath": "/teams/DEPOTS_MOE/BDD_reception_piece",
  "dossierId": "concours-mediatheque-bordeaux",
  "companyId": "ENT-042",
  "companyName": "Soconer",
  "companyEmail": "contact@soconer.example",
  "contactName": "Mme Martin",
  "contestName": "Concours Mediatheque Bordeaux",
  "submissionId": "inv-2026-042",
  "documentType": "KBIS",
  "documentLabel": "Extrait KBIS",
  "source": "client-portal",
  "metadata": {
    "dossierId": "concours-mediatheque-bordeaux",
    "companyId": "ENT-042",
    "companyName": "Soconer",
    "companyEmail": "contact@soconer.example",
    "contactName": "Mme Martin",
    "contestName": "Concours Mediatheque Bordeaux",
    "submissionId": "inv-2026-042",
    "documentType": "KBIS",
    "documentLabel": "Extrait KBIS",
    "source": "client-portal"
  }
}
```

### Output recommande

```json
{
  "success": true,
  "message": "Fichier cree avec succes",
  "fileName": "kbis-mars-2026.pdf",
  "folderPath": "/teams/DEPOTS_MOE/BDD_reception_piece"
}
```

## 4. UPDATE_FILE

### Input serveur -> flow

```json
{
  "fileIdentifier": "%252fteams%252fDEPOTS_MOE%252f...",
  "filePath": "/teams/DEPOTS_MOE/BDD_reception_piece/kbis-mars-2026.pdf",
  "fileName": "kbis-v2.pdf",
  "fileContent": "<base64>",
  "dossierId": "concours-mediatheque-bordeaux",
  "companyId": "ENT-042",
  "companyName": "Soconer",
  "companyEmail": "contact@soconer.example",
  "contactName": "Mme Martin",
  "contestName": "Concours Mediatheque Bordeaux",
  "submissionId": "inv-2026-042",
  "documentType": "KBIS",
  "documentLabel": "Extrait KBIS",
  "source": "client-portal",
  "metadata": {
    "dossierId": "concours-mediatheque-bordeaux",
    "companyId": "ENT-042",
    "companyName": "Soconer",
    "companyEmail": "contact@soconer.example",
    "contactName": "Mme Martin",
    "contestName": "Concours Mediatheque Bordeaux",
    "submissionId": "inv-2026-042",
    "documentType": "KBIS",
    "documentLabel": "Extrait KBIS",
    "source": "client-portal"
  }
}
```

## 5. DELETE_FILE

### Input serveur -> flow

```json
{
  "fileIdentifier": "%252fteams%252fDEPOTS_MOE%252f...",
  "dossierId": "concours-mediatheque-bordeaux",
  "companyId": "ENT-042",
  "companyName": "Soconer",
  "companyEmail": "contact@soconer.example",
  "contactName": "Mme Martin",
  "contestName": "Concours Mediatheque Bordeaux",
  "submissionId": "inv-2026-042",
  "documentType": "KBIS",
  "documentLabel": "Extrait KBIS",
  "source": "client-portal",
  "metadata": {
    "dossierId": "concours-mediatheque-bordeaux",
    "companyId": "ENT-042",
    "companyName": "Soconer",
    "companyEmail": "contact@soconer.example",
    "contactName": "Mme Martin",
    "contestName": "Concours Mediatheque Bordeaux",
    "submissionId": "inv-2026-042",
    "documentType": "KBIS",
    "documentLabel": "Extrait KBIS",
    "source": "client-portal"
  }
}
```

## 6. SEND_INVITATIONS (optionnel)

Flow d'envoi groupe des invitations signees. Declenche depuis le bouton
`Envoyer invitations par mail` du tableau admin. Le serveur signe chaque URL
avec `PORTAL_LINK_SECRET` puis transmet un seul payload batch au flow.

### Input serveur -> flow

```json
{
  "type": "invitation",
  "projectId": "project-concours-mediatheque-bordeaux",
  "projectName": "Concours Mediatheque Bordeaux",
  "dossierId": "concours-mediatheque-bordeaux",
  "deadline": "2026-04-30T17:00",
  "portalUrl": "https://portal.example.com/depot",
  "invitations": [
    {
      "companyId": "ENT-042",
      "companyName": "T
      ikoam",
      "companyEmail": "flavien.bessiere@tikoam.com",
      "contactName": "Mme Martin",
      "submissionId": "inv-2026-042",
      "url": "https://portal.example.com/depot?ctx=...&sig=...&alg=HS256",
      "expiresAt": "2026-05-25T12:00:00.000Z"
    }
  ]
}
```

### Comportement cote flow

- Iterer sur `invitations` et envoyer un email personnalise (Outlook, Office 365
  Mail, SMTP, etc.) a chaque `companyEmail`.
- Inclure `url` dans le corps de l'email. Le lien est deja signe et scope a
  l'entreprise.
- Afficher `deadline` (date limite projet) dans le gabarit si present.

### Output attendu

Peu importe, le serveur remonte la reponse brute. Un simple:

```json
{ "success": true }
```

suffit.

### Guide "create flow" (Power Automate)

Objectif: creer un flow HTTP (server-only) qui recoit un batch d'invitations, envoie 1 mail par entree, puis renvoie une reponse JSON.

#### A. Creer le flow et le declencheur HTTP

1) Power Automate -> **Create** -> **Instant cloud flow**
- Nom: `SEND_INVITATIONS`
- Trigger: **When an HTTP request is received**

2) Ouvrir le trigger **When an HTTP request is received** et definir le **Request Body JSON Schema**.
Astuce: coller un exemple de payload (section "Input serveur -> flow") via **Use sample payload to generate schema**.

Schema minimal recommande (a adapter si vous ajoutez des champs):

```json
{
  "type": "object",
  "properties": {
    "type": { "type": "string" },
    "projectId": { "type": "string" },
    "projectName": { "type": "string" },
    "dossierId": { "type": "string" },
    "deadline": { "type": "string" },
    "portalUrl": { "type": "string" },
    "invitations": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "companyId": { "type": "string" },
          "companyName": { "type": "string" },
          "companyEmail": { "type": "string" },
          "contactName": { "type": "string" },
          "submissionId": { "type": "string" },
          "url": { "type": "string" },
          "expiresAt": { "type": "string" }
        },
        "required": ["companyEmail", "url"]
      }
    }
  },
  "required": ["type", "projectId", "projectName", "dossierId", "invitations"]
}
```

#### B. Envoyer un mail par invitation

3) Ajouter une action **Apply to each** sur `invitations`.

4) Dans la boucle, ajouter une action d'envoi d'email (un seul connecteur selon votre tenant):
- Option A: **Office 365 Outlook -> Send an email (V2)**
- Option B: **Outlook.com -> Send an email (V2)**
- Option C: **SMTP -> Send email** (si pas d'Outlook)

Champs recommandes:
- **To**: `items('Apply_to_each')?['companyEmail']`
- **Subject**: `[${triggerBody()?['projectName']}] Invitation depot de pieces`
- **Body** (HTML conseille): inclure au minimum le lien `url` et l'echeance.

Exemple de corps (HTML simple):

```html
Bonjour @{items('Apply_to_each')?['contactName']},
<br/><br/>
Vous etes invite a deposer vos pieces pour le projet <b>@{triggerBody()?['projectName']}</b>.
<br/>
Lien d'acces: <a href="@{items('Apply_to_each')?['url']}">@{items('Apply_to_each')?['url']}</a>
<br/>
Date limite: <b>@{triggerBody()?['deadline']}</b>
<br/><br/>
Cordialement
```

Notes:
- `url` est deja signe (le flow ne doit pas recalculer de signature).
- Si `deadline` n'est pas renseigne, vous pouvez conditionner l'affichage via une action **Condition** avant l'envoi, ou laisser tel quel.

#### C. Repondre au serveur (HTTP Response)

5) En fin de flow (apres la boucle), ajouter l'action **Response**:
- **Status code**: `200`
- **Headers**: `Content-Type: application/json`
- **Body**:

```json
{ "success": true }
```

#### D. Gestion d'erreurs (recommande)

6) Envelopper la boucle dans un **Scope** `Try`, puis creer un **Scope** `Catch`.
- Sur `Catch`, configurer **Run after** (has failed / has timed out) depuis `Try`.
- Dans `Catch`, renvoyer une **Response** `500`:

```json
{ "success": false, "error": "SEND_INVITATIONS failed" }
```

#### E. Recuperer l'URL du flow pour le serveur

7) Dans le flow -> **When an HTTP request is received** -> copier la **HTTP POST URL**.
La renseigner cote serveur en variable d'environnement: `POWER_AUTOMATE_SEND_INVITATIONS_URL`.

## 7. SEND_REMINDERS (optionnel)

Flow d'envoi des relances. Declenche depuis le bouton `Envoyer relances`. Le
serveur interroge `GET_DOCUMENTS` pour le dossier, calcule les pieces
manquantes par entreprise et n'envoie que les entreprises au dossier
incomplet (sauf si l'admin a explicitement selectionne des entreprises).

### Input serveur -> flow

```json
{
  "type": "reminder",
  "projectId": "project-concours-mediatheque-bordeaux",
  "projectName": "Concours Mediatheque Bordeaux",
  "dossierId": "concours-mediatheque-bordeaux",
  "deadline": "2026-04-30T17:00",
  "portalUrl": "https://portal.example.com/depot",
  "reminders": [
    {
      "companyId": "ENT-042",
      "companyName": "Soconer",
      "companyEmail": "contact@soconer.example",
      "contactName": "Mme Martin",
      "submissionId": "inv-2026-042",
      "url": "https://portal.example.com/depot?ctx=...&sig=...&alg=HS256",
      "expiresAt": "2026-05-25T12:00:00.000Z",
      "expectedCount": 4,
      "receivedCount": 2,
      "missingDocuments": [
        { "id": "EXTRAIT_KBIS", "label": "Extrait KBIS" },
        { "id": "ATTESTATION_ASSURANCES", "label": "Attestation assurances" }
      ]
    }
  ]
}
```

### Comportement cote flow

- Iterer sur `reminders` et envoyer un email rappelant les pieces manquantes.
- Utiliser `missingDocuments[].label` pour lister les pieces a fournir.
- Utiliser `deadline` pour souligner l'echeance.

### Output attendu

```json
{ "success": true }
```

### Guide "create flow" (Power Automate)

Objectif: creer un flow HTTP (server-only) qui recoit un batch de relances, envoie 1 mail par entree (avec la liste des pieces manquantes), puis renvoie une reponse JSON.

#### A. Creer le flow et le declencheur HTTP

1) Power Automate -> **Create** -> **Instant cloud flow**
- Nom: `SEND_REMINDERS`
- Trigger: **When an HTTP request is received**

2) Ouvrir le trigger **When an HTTP request is received** et definir le **Request Body JSON Schema**.
Astuce: coller un exemple de payload (section "Input serveur -> flow") via **Use sample payload to generate schema**.

Schema minimal recommande (a adapter si vous ajoutez des champs):

```json
{
  "type": "object",
  "properties": {
    "type": { "type": "string" },
    "projectId": { "type": "string" },
    "projectName": { "type": "string" },
    "dossierId": { "type": "string" },
    "deadline": { "type": "string" },
    "portalUrl": { "type": "string" },
    "reminders": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "companyId": { "type": "string" },
          "companyName": { "type": "string" },
          "companyEmail": { "type": "string" },
          "contactName": { "type": "string" },
          "submissionId": { "type": "string" },
          "url": { "type": "string" },
          "expiresAt": { "type": "string" },
          "expectedCount": { "type": "number" },
          "receivedCount": { "type": "number" },
          "missingDocuments": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "label": { "type": "string" }
              },
              "required": ["label"]
            }
          }
        },
        "required": ["companyEmail", "url"]
      }
    }
  },
  "required": ["type", "projectId", "projectName", "dossierId", "reminders"]
}
```

#### B. Construire la liste des pieces manquantes (HTML)

3) Ajouter une action **Apply to each** sur `reminders`.

4) Dans la boucle, construire un bloc HTML listant `missingDocuments`:

- Ajouter une action **Initialize variable** (type **String**) dans la boucle:
  - Name: `missingHtml`
  - Value: `<ul>`

- Ajouter une 2e action **Apply to each** (imbriquee) sur:
  - `items('Apply_to_each')?['missingDocuments']`

- Dans cette boucle imbriquee, ajouter **Append to string variable**:
  - Name: `missingHtml`
  - Value: `<li>@{items('Apply_to_each_2')?['label']}</li>`

- Apres la boucle imbriquee, ajouter un **Append to string variable**:
  - Name: `missingHtml`
  - Value: `</ul>`

Si `missingDocuments` peut etre vide, vous pouvez ajouter une **Condition**:
- si `length(items('Apply_to_each')?['missingDocuments'])` = 0 -> afficher "Aucune piece manquante detectee" (ou ne pas envoyer).

#### C. Envoyer un mail par relance

5) Dans la boucle principale, ajouter une action d'envoi d'email (un seul connecteur selon votre tenant):
- Option A: **Office 365 Outlook -> Send an email (V2)**
- Option B: **Outlook.com -> Send an email (V2)**
- Option C: **SMTP -> Send email**

Champs recommandes:
- **To**: `items('Apply_to_each')?['companyEmail']`
- **Subject**: `[${triggerBody()?['projectName']}] Relance depot de pieces`
- **Body** (HTML conseille): inclure lien `url`, echeance `deadline`, compteurs et la liste des pieces manquantes.

Exemple de corps (HTML simple):

```html
Bonjour @{items('Apply_to_each')?['contactName']},
<br/><br/>
Sauf erreur de notre part, votre dossier <b>@{triggerBody()?['projectName']}</b> est incomplet.
<br/>
Pieces recues: <b>@{items('Apply_to_each')?['receivedCount']}</b> / <b>@{items('Apply_to_each')?['expectedCount']}</b>
<br/><br/>
Pieces manquantes:
@{variables('missingHtml')}
<br/>
Lien d'acces: <a href="@{items('Apply_to_each')?['url']}">@{items('Apply_to_each')?['url']}</a>
<br/>
Date limite: <b>@{triggerBody()?['deadline']}</b>
<br/><br/>
Cordialement
```

Notes:
- `url` est deja signe (le flow ne doit pas recalculer de signature).
- Le serveur decide qui relancer (dossier incomplet / selection explicite admin).

#### D. Repondre au serveur (HTTP Response)

6) En fin de flow (apres la boucle), ajouter l'action **Response**:
- **Status code**: `200`
- **Headers**: `Content-Type: application/json`
- **Body**:

```json
{ "success": true }
```

#### E. Gestion d'erreurs (recommande)

7) Envelopper la boucle principale dans un **Scope** `Try`, puis creer un **Scope** `Catch`.
- Sur `Catch`, configurer **Run after** (has failed / has timed out) depuis `Try`.
- Dans `Catch`, renvoyer une **Response** `500`:

```json
{ "success": false, "error": "SEND_REMINDERS failed" }
```

#### F. Recuperer l'URL du flow pour le serveur

8) Dans le flow -> **When an HTTP request is received** -> copier la **HTTP POST URL**.
La renseigner cote serveur en variable d'environnement: `POWER_AUTOMATE_SEND_REMINDERS_URL`.

## Mapping SharePoint

Voir `docs/sharepoint-metadata.md`.

Le minimum attendu dans `Update file properties`:

- `Entreprise_depot <- companyName`
- `Type_piece <- documentType`
- `Projet <- dossierId`

## Notes d'implementation

- Le serveur s'assure que `filePath` reste dans le `folderPath` signe.
- Le serveur s'assure que `documentType` fait partie des pieces autorisees par
  l'invitation.
- Les flows n'ont pas a revalider `ctx` ou `sig`, sauf si une autre integration
  les appelle en direct.
