# Contrat de métadonnées SharePoint

Bibliothèque cible : `BDD_reception_piece`

## Colonnes minimales

| Colonne SharePoint | Type | Champ source |
| --- | --- | --- |
| `Entreprise_depot` | Texte | `companyName` |
| `Type_piece` | Texte | `documentType` |
| `Projet` | Texte | `dossierId` |

Les colonnes standard SharePoint (`Name`, `Modified`, `ServerRelativeUrl`,
`Identifier`, `Size`) restent gerees par SharePoint.

## Metadonnees envoyees par le serveur

Payload metier commun aux flows `UPLOAD`, `UPDATE`, `DELETE`:

```json
{
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
```

## Mapping recommandé dans Power Automate

Après `Create file` ou `Update file`, ajouter `Update file properties` :

| Colonne SharePoint | Expression |
| --- | --- |
| `Entreprise_depot` | `@{triggerBody()?['companyName']}` |
| `Type_piece` | `@{triggerBody()?['documentType']}` |
| `Projet` | `@{triggerBody()?['dossierId']}` |

## Réponse attendue pour GET_DOCUMENTS

Le portail admin et le portail entreprise reconnaissent les champs suivants :

```json
{
  "Name_extension": "kbis-mars-2026.pdf",
  "Identifier": "%252fteams%252fDEPOTS_MOE%252f...",
  "ServerRelativeUrl": "/teams/DEPOTS_MOE/BDD_reception_piece/kbis-mars-2026.pdf",
  "Modified": "2026-03-26T12:30:00Z",
  "Length": 245781,
  "Link": "https://tenant.sharepoint.com/...",
  "Entreprise_depot": "Soconer",
  "Type_piece": "KBIS",
  "Projet": "concours-mediatheque-bordeaux"
}
```

## Pourquoi ce modèle

- Le portail retrouve une pièce par son type, pas par le nom du fichier.
- Un remplacement reste fiable même si le nom du fichier change.
- Le suivi admin peut filtrer par projet, entreprise et type de pièce.
