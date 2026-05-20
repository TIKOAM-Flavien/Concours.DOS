import { getAvailableDocuments } from "../config/documentCatalog.js";

export const DOCUMENT_OPTIONS = getAvailableDocuments();

export const DEFAULT_EXPECTED_DOCUMENTS = DOCUMENT_OPTIONS.slice(0, 4).map(
  (document) => document.id
);

/** Matches `normalizeCustomProjectDocuments` on the server. */
export const CUSTOM_DOC_CATEGORY = "Pieces specifiques";

export const TRACKING_STATUS_OPTIONS = [
  { value: "all", label: "Tous les statuts" },
  { value: "todo", label: "A demarrer" },
  { value: "progress", label: "En cours" },
  { value: "complete", label: "Complet" },
];

export const OVERVIEW_STATUS_LABELS = {
  complete: "Complet",
  almost: "Presque complet",
  progress: "En cours",
  todo: "A demarrer",
  empty: "Sans piece",
  unknown: "Etat inconnu",
};
