const DEFAULT_DOCUMENT_IDS = [
  // 01 - Groupement
  "NOTE_PRESENTATION",
  "NOTE_DEMARCHE_RSE",
  "NOTE_REFERENCES",
  "ORGANIGRAMME_EQUIPE",
  "CADRE_COMPETENCES",
  "CADRE_REFERENCES",

  // 02 - Candidature
  "DUME_PDF",
  "DUME_XML",
  "DC1",
  "DC2",
  "DC4",
  "POUVOIR",

  // 03 - Aptitude
  "DECLARATION_HONNEUR",
  "EXTRAIT_KBIS",
  "INSCRIPTION_ARCHITECTE",

  // 04 - Capacite Economique
  "ATTESTATION_ASSURANCES",
  "DECLARATION_FINANCIERE",

  // 05 - Capacite Technique
  "MOYENS_HUMAINS",
  "MOYENS_TECHNIQUES",
  "QUALIFICATIONS",

  // 06 - References
  "ATTESTATION_REALISATION",
  "REFERENCES",
];

const DOCUMENT_LIBRARY = {
  NOTE_PRESENTATION: {
    id: "NOTE_PRESENTATION",
    category: "01 - Groupement / 01 - Notes",
    label: "Note de presentation",
    summary: "Note de presentation du groupement / de l'entreprise.",
    acceptedFormats: ["PDF"],
    accent: "#305f72",
  },
  NOTE_DEMARCHE_RSE: {
    id: "NOTE_DEMARCHE_RSE",
    category: "01 - Groupement / 01 - Notes",
    label: "Note demarche RSE",
    summary: "Note presentant la demarche RSE (ou equivalent).",
    acceptedFormats: ["PDF"],
    accent: "#2c6b67",
  },
  NOTE_REFERENCES: {
    id: "NOTE_REFERENCES",
    category: "01 - Groupement / 01 - Notes",
    label: "Note references",
    summary: "Note de references / experience pertinente.",
    acceptedFormats: ["PDF"],
    accent: "#466d3d",
  },
  ORGANIGRAMME_EQUIPE: {
    id: "ORGANIGRAMME_EQUIPE",
    category: "01 - Groupement / 02 - Organigramme",
    label: "Organigramme equipe",
    summary: "Organigramme de l'equipe et des intervenants.",
    acceptedFormats: ["PDF"],
    accent: "#38598b",
  },
  CADRE_COMPETENCES: {
    id: "CADRE_COMPETENCES",
    category: "01 - Groupement / 04 - Cadre Competences",
    label: "Cadre competences",
    summary: "Cadre competences (modele fourni) complete.",
    acceptedFormats: ["PDF", "XLSX"],
    accent: "#5c4a72",
  },
  CADRE_REFERENCES: {
    id: "CADRE_REFERENCES",
    category: "01 - Groupement / 05 - Cadre References",
    label: "Cadre references",
    summary: "Cadre references (modele fourni) complete.",
    acceptedFormats: ["PDF", "XLSX"],
    accent: "#7d5a2e",
  },

  DUME_PDF: {
    id: "DUME_PDF",
    category: "02 - Candidature",
    label: "DUME (PDF)",
    summary: "DUME au format PDF.",
    acceptedFormats: ["PDF"],
    accent: "#6b4040",
  },
  DUME_XML: {
    id: "DUME_XML",
    category: "02 - Candidature",
    label: "DUME (XML)",
    summary: "DUME au format XML.",
    acceptedFormats: ["XML"],
    accent: "#6b4040",
  },
  DC1: {
    id: "DC1",
    category: "02 - Candidature",
    label: "Formulaire DC1",
    summary: "Formulaire DC1 (lettre de candidature / habilitation).",
    acceptedFormats: ["PDF"],
    accent: "#9f4a2f",
  },
  DC2: {
    id: "DC2",
    category: "02 - Candidature",
    label: "Formulaire DC2",
    summary: "Formulaire DC2 (declaration du candidat).",
    acceptedFormats: ["PDF"],
    accent: "#38598b",
  },
  DC4: {
    id: "DC4",
    category: "02 - Candidature",
    label: "Formulaire DC4",
    summary: "Formulaire DC4 (declaration de sous-traitance).",
    acceptedFormats: ["PDF"],
    accent: "#7d5a2e",
  },
  POUVOIR: {
    id: "POUVOIR",
    category: "02 - Candidature",
    label: "Pouvoir",
    summary: "Pouvoir / delegation de signature si requis.",
    acceptedFormats: ["PDF"],
    accent: "#4b5563",
  },

  DECLARATION_HONNEUR: {
    id: "DECLARATION_HONNEUR",
    category: "03 - Aptitude",
    label: "Declaration sur l'honneur",
    summary: "Declaration sur l'honneur (aptitude / exclusions).",
    acceptedFormats: ["PDF"],
    accent: "#2c6b67",
  },
  EXTRAIT_KBIS: {
    id: "EXTRAIT_KBIS",
    category: "03 - Aptitude",
    label: "Extrait KBIS",
    summary: "Justificatif d'immatriculation (KBIS ou equivalent).",
    acceptedFormats: ["PDF"],
    accent: "#9f4a2f",
  },
  INSCRIPTION_ARCHITECTE: {
    id: "INSCRIPTION_ARCHITECTE",
    category: "03 - Aptitude",
    label: "Inscription a l'Ordre des architectes",
    summary: "Justificatif d'inscription a l'Ordre (si applicable).",
    acceptedFormats: ["PDF"],
    accent: "#305f72",
  },

  ATTESTATION_ASSURANCES: {
    id: "ATTESTATION_ASSURANCES",
    category: "04 - Capacite Economique",
    label: "Attestation assurances",
    summary: "Attestation(s) d'assurance (RC / decennale selon besoin).",
    acceptedFormats: ["PDF"],
    accent: "#7d5a2e",
  },
  DECLARATION_FINANCIERE: {
    id: "DECLARATION_FINANCIERE",
    category: "04 - Capacite Economique",
    label: "Declaration financiere",
    summary: "Declaration / elements financiers demandes au dossier.",
    acceptedFormats: ["PDF"],
    accent: "#38598b",
  },

  MOYENS_HUMAINS: {
    id: "MOYENS_HUMAINS",
    category: "05 - Capacite Technique",
    label: "Moyens humains",
    summary: "Description des moyens humains.",
    acceptedFormats: ["PDF"],
    accent: "#5c4a72",
  },
  MOYENS_TECHNIQUES: {
    id: "MOYENS_TECHNIQUES",
    category: "05 - Capacite Technique",
    label: "Moyens techniques",
    summary: "Description des moyens techniques.",
    acceptedFormats: ["PDF"],
    accent: "#466d3d",
  },
  QUALIFICATIONS: {
    id: "QUALIFICATIONS",
    category: "05 - Capacite Technique",
    label: "Qualifications",
    summary: "Qualifications / certifications.",
    acceptedFormats: ["PDF"],
    accent: "#5c4a72",
  },

  REFERENCES: {
    id: "REFERENCES",
    category: "06 - References",
    label: "References",
    summary:
      "References recentes de chantier ou dossier de capacite si la consultation le demande.",
    acceptedFormats: ["PDF"],
    accent: "#466d3d",
  },
  ATTESTATION_REALISATION: {
    id: "ATTESTATION_REALISATION",
    category: "06 - References",
    label: "Attestation de realisation",
    summary: "Attestation(s) de realisation si demandee(s).",
    acceptedFormats: ["PDF"],
    accent: "#305f72",
  },
};

export function normalizeDocumentId(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeAcceptedFormats(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim().toUpperCase())
      .filter(Boolean);
  }

  return String(value || "")
    .split(/[;,|]/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function titleFromId(documentId) {
  return documentId
    .split("_")
    .map((chunk) => chunk.charAt(0) + chunk.slice(1).toLowerCase())
    .join(" ");
}

function buildCustomDocument(entry) {
  const rawId =
    typeof entry === "string"
      ? entry
      : entry?.id || entry?.code || entry?.documentType || entry?.key;
  const documentId = normalizeDocumentId(rawId);
  if (!documentId) return null;

  const base = DOCUMENT_LIBRARY[documentId];
  if (!base) {
    return {
      id: documentId,
      category:
        (typeof entry === "object" && (entry?.category || entry?.group)) ||
        "Pieces",
      label:
        (typeof entry === "object" && entry?.label) || titleFromId(documentId),
      summary:
        (typeof entry === "object" && entry?.summary) ||
        "Piece personnalisee definie dans le lien d'invitation.",
      acceptedFormats:
        typeof entry === "object" && entry?.acceptedFormats
          ? normalizeAcceptedFormats(entry.acceptedFormats)
          : ["PDF"],
      accent:
        (typeof entry === "object" && entry?.accent) || "#4b5563",
    };
  }

  if (typeof entry !== "object" || entry == null) return base;

  return {
    ...base,
    category: entry.category || entry.group || base.category || "Pieces",
    label: entry.label || base.label,
    summary: entry.summary || base.summary,
    acceptedFormats:
      entry.acceptedFormats != null
        ? normalizeAcceptedFormats(entry.acceptedFormats)
        : base.acceptedFormats,
    accent: entry.accent || base.accent,
  };
}

export function resolveDocumentList(entries) {
  const source =
    Array.isArray(entries) && entries.length ? entries : DEFAULT_DOCUMENT_IDS;
  const seen = new Set();

  return source
    .map((entry) => buildCustomDocument(entry))
    .filter(Boolean)
    .filter((document) => {
      if (seen.has(document.id)) return false;
      seen.add(document.id);
      return true;
    });
}

export function getAvailableDocuments() {
  return Object.values(DOCUMENT_LIBRARY).sort((left, right) => {
    const categoryOrder = String(left.category || "").localeCompare(
      String(right.category || "")
    );
    if (categoryOrder !== 0) return categoryOrder;
    return String(left.label || "").localeCompare(String(right.label || ""));
  });
}
