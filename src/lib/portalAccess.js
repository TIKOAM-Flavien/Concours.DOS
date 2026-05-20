// Server-confirmed access checks for the public portal. Pulled out of
// App.jsx so the access-state machine lives next to its (very specific)
// failure-message catalog instead of inflating the component file.

export function accessFailureFromServer(error) {
  const message = String(error?.message || "");
  const lower = message.toLowerCase();

  if (lower.includes("missing_secret")) {
    return {
      label: "Signature indisponible",
      title: "Configuration serveur incomplete",
      message:
        "La signature serveur n'est pas configuree. Contactez l'administrateur du portail.",
    };
  }

  if (lower.includes("expired")) {
    return {
      label: "Lien expire",
      title: "Invitation expiree",
      message:
        "La validite de ce lien est depassee. Un nouveau lien signe est necessaire pour continuer.",
    };
  }

  if (lower.includes("deadline_passed")) {
    return {
      label: "Echeance depassee",
      title: "Date limite atteinte",
      message:
        "La date limite de depot est passee. Le portail n'est plus accessible pour cette invitation.",
    };
  }

  if (lower.includes("invalid_sig") || lower.includes("invalid signed")) {
    return {
      label: "Signature invalide",
      title: "Lien non valide",
      message:
        "Le serveur n'a pas confirme la signature de ce lien. Utilisez le lien complet transmis par l'administrateur.",
    };
  }

  return {
    label: "Verification refusee",
    title: "Acces non confirme",
    message:
      "Le serveur n'a pas confirme ce lien de depot. Utilisez le lien complet transmis par l'administrateur ou contactez le support.",
  };
}

export async function assessAccess(context, client) {
  const inv = context.link?.inv;
  const sig = context.link?.sig;
  const alg = String(context.link?.alg || "HS256").trim().toUpperCase();

  if (!inv || !sig) {
    return {
      status: "blocked",
      tone: "error",
      label: "Lien securise requis",
      title: "Acces restreint",
      message:
        "Ce portail de production n'accepte que des invitations signees. Utilisez le lien complet transmis par l'administrateur.",
      trustedContext: false,
    };
  }

  if (alg !== "HS256") {
    return {
      status: "blocked",
      tone: "error",
      label: "Algorithme refuse",
      title: "Lien non conforme",
      message:
        "Le format de signature du lien n'est pas supporte. Demandez une nouvelle invitation.",
      trustedContext: false,
    };
  }

  let serverVerification = null;
  try {
    serverVerification = await client.verifyInvitation(context);
  } catch (error) {
    const failure = accessFailureFromServer(error);
    return {
      status: "blocked",
      tone: "error",
      trustedContext: false,
      ...failure,
    };
  }

  return {
    status: "trusted",
    tone: "success",
    label: "Lien signe actif",
    title: "Acces securise",
    message:
      "Le lien signe a ete controle cote serveur. Les depots sont stockes sur le VPS puis synchronises en arriere-plan.",
    trustedContext: true,
    limits: serverVerification?.limits || {},
    invitation: serverVerification?.invitation || null,
  };
}
