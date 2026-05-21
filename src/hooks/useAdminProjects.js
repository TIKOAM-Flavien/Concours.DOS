import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { portalEnv } from "../config/env.js";
import {
  CUSTOM_DOC_CATEGORY,
  DEFAULT_EXPECTED_DOCUMENTS,
  DOCUMENT_OPTIONS,
} from "../lib/adminConstants.js";
import {
  buildCompanyDirectory,
  buildCompanyDocumentGroups,
  buildCompanyDocumentOptions,
  countTotalCompanies,
  filterDirectoryResults,
  sumExpectedPieces,
} from "../lib/adminCompanyDocuments.js";
import {
  createEmptyCompanyForm,
  createEmptyProjectForm,
  toCompanyForm,
  toProjectForm,
} from "../lib/adminForms.js";
import {
  buildCompanyId,
  buildProjectId,
  buildSubmissionId,
  confirmByTyping,
  dedupe,
  slugify,
  uniqueSuffix,
} from "../lib/adminUtils.js";
import * as api from "../lib/adminApi.js";
import { useAdminInvitationStatuses } from "./useAdminInvitationStatuses.js";
import { useModalLock } from "./useModalLock.js";

export function useAdminProjects({
  defaultFolderPath,
  refreshOverview,
  setNotice,
  secureLinkEnabled,
  signingFlows = {},
}) {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectForm, setProjectForm] = useState(() => createEmptyProjectForm());
  const [companyForm, setCompanyForm] = useState(() => createEmptyCompanyForm());
  const [dbLoading, setDbLoading] = useState(true);
  const [companyDocumentSearch, setCompanyDocumentSearch] = useState("");
  const [customDocInput, setCustomDocInput] = useState("");
  const [customDocSaving, setCustomDocSaving] = useState(false);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [companySaveStatus, setCompanySaveStatus] = useState({ phase: "idle", mode: "create" });
  const companySaveTimerRef = useRef(null);
  const companyModalOpenRef = useRef(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState(() => new Set());
  const [emailSending, setEmailSending] = useState(null);
  const [directorySearch, setDirectorySearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const firstLoadRef = useRef(true);
  const projectsRequestIdRef = useRef(0);
  const projectsAbortRef = useRef(null);

  const { invitationStatusByCompanyId, refreshInvitationStatuses } =
    useAdminInvitationStatuses(selectedProjectId);

  const refreshProjects = useCallback(async () => {
    const requestId = projectsRequestIdRef.current + 1;
    projectsRequestIdRef.current = requestId;

    if (projectsAbortRef.current) {
      projectsAbortRef.current.abort();
    }
    const controller = new AbortController();
    projectsAbortRef.current = controller;

    try {
      const data = await api.fetchProjects(
        { includeArchived: showArchived },
        { signal: controller.signal }
      );
      if (controller.signal.aborted || requestId !== projectsRequestIdRef.current) {
        return null;
      }
      setProjects(data);
      return data;
    } catch (err) {
      if (err?.name === "AbortError" || requestId !== projectsRequestIdRef.current) {
        return null;
      }
      console.error("Failed to load projects from DB:", err);
      setNotice({ tone: "error", title: "Erreur base de donnees", message: err.message });
      return [];
    } finally {
      if (projectsAbortRef.current === controller) {
        projectsAbortRef.current = null;
      }
    }
  }, [setNotice, showArchived]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const selectedProjectCustomDocs = useMemo(
    () => (Array.isArray(selectedProject?.customDocuments) ? selectedProject.customDocuments : []),
    [selectedProject]
  );

  const companyDocumentOptions = useMemo(
    () => buildCompanyDocumentOptions(DOCUMENT_OPTIONS, selectedProjectCustomDocs),
    [selectedProjectCustomDocs]
  );

  const companyDocumentGroups = useMemo(
    () => buildCompanyDocumentGroups(companyDocumentOptions, companyDocumentSearch),
    [companyDocumentOptions, companyDocumentSearch]
  );

  const companyDirectory = useMemo(() => buildCompanyDirectory(projects), [projects]);

  const directorySearchResults = useMemo(
    () => filterDirectoryResults(companyDirectory, selectedProject, directorySearch),
    [companyDirectory, directorySearch, selectedProject]
  );

  const totalExpectedPieces = useMemo(() => sumExpectedPieces(projects), [projects]);
  const totalCompanies = useMemo(() => countTotalCompanies(projects), [projects]);
  const selectedProjectCompanyCount = useMemo(() => {
    if (!selectedProject) return null;
    return (selectedProject.companies || []).length;
  }, [selectedProject]);

  useEffect(() => {
    refreshProjects().then((data) => {
      if (!firstLoadRef.current) return;
      if (!Array.isArray(data)) return;
      firstLoadRef.current = false;
      setDbLoading(false);
      if (data.length) {
        setSelectedProjectId(data[0].id);
        setProjectForm(toProjectForm(data[0]));
        refreshOverview();
      }
    });
  }, [refreshOverview, refreshProjects]);

  useEffect(() => {
    if (!projects.length) {
      setSelectedProjectId("");
      setProjectForm(createEmptyProjectForm());
      return;
    }
    if (!selectedProjectId) return;
    if (projects.some((project) => project.id === selectedProjectId)) return;
    const project = projects[0];
    setSelectedProjectId(project.id);
    setProjectForm(toProjectForm(project));
  }, [defaultFolderPath, projects, selectedProjectId]);

  useEffect(() => {
    const validIds = new Set((selectedProject?.companies || []).map((company) => company.id));
    setSelectedCompanyIds((current) => {
      if (!current.size) return current;
      const next = new Set(Array.from(current).filter((companyId) => validIds.has(companyId)));
      return next.size === current.size ? current : next;
    });
  }, [selectedProject]);

  function resetCompanySaveUi({ mode = "create" } = {}) {
    if (companySaveTimerRef.current) {
      clearTimeout(companySaveTimerRef.current);
      companySaveTimerRef.current = null;
    }
    setCompanySaveStatus({ phase: "idle", mode });
  }

  useEffect(() => {
    companyModalOpenRef.current = companyModalOpen;
  }, [companyModalOpen]);

  useEffect(() => {
    if (companyModalOpen) return;
    resetCompanySaveUi({ mode: "create" });
  }, [companyModalOpen]);

  useEffect(() => {
    return () => {
      if (companySaveTimerRef.current) {
        clearTimeout(companySaveTimerRef.current);
        companySaveTimerRef.current = null;
      }
      if (projectsAbortRef.current) {
        projectsAbortRef.current.abort();
        projectsAbortRef.current = null;
      }
    };
  }, []);

  function handleProjectFieldChange(field, value) {
    setProjectForm((current) => ({ ...current, [field]: value }));
  }

  function handleCompanyFieldChange(field, value) {
    setCompanyForm((current) => ({ ...current, [field]: value }));
  }

  function handleCompanyDocumentToggle(documentId) {
    setCompanyForm((current) => {
      const next = new Set(current.expectedDocuments || []);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return { ...current, expectedDocuments: Array.from(next) };
    });
  }

  function handleCompanyDocumentsBulk(documentIds, shouldSelect) {
    const ids = Array.from(documentIds || []);
    if (!ids.length) return;
    setCompanyForm((current) => {
      const next = new Set(current.expectedDocuments || []);
      if (shouldSelect) {
        for (const id of ids) next.add(id);
      } else {
        for (const id of ids) next.delete(id);
      }
      return { ...current, expectedDocuments: Array.from(next) };
    });
  }

  async function handleAddCustomDocument() {
    const label = String(customDocInput || "").trim();
    if (!label || customDocSaving) return;
    if (!selectedProject) {
      setNotice({
        tone: "warning",
        title: "Projet requis",
        message: "Selectionnez un projet avant d'ajouter une piece specifique.",
      });
      return;
    }

    setCustomDocSaving(true);
    try {
      const existing = Array.isArray(selectedProject.customDocuments)
        ? selectedProject.customDocuments
        : [];
      const nextCustomDocs = [
        ...existing.map((doc) => ({
          label: String(doc?.label || "").trim(),
          category: doc?.category || CUSTOM_DOC_CATEGORY,
        })),
        { label, category: CUSTOM_DOC_CATEGORY },
      ];

      const saved = await api.saveProject({
        id: selectedProject.id,
        name: selectedProject.name || "",
        dossierId: selectedProject.dossierId || "",
        folderPath: defaultFolderPath || selectedProject.folderPath || "",
        deadline: selectedProject.deadline || "",
        customDocuments: nextCustomDocs,
      });
      await refreshProjects();

      const newDoc = (saved.customDocuments || []).find(
        (doc) => String(doc?.label || "").trim().toLowerCase() === label.toLowerCase()
      );
      if (newDoc?.id) {
        setCompanyForm((current) => {
          const set = new Set(current.expectedDocuments || []);
          set.add(newDoc.id);
          return { ...current, expectedDocuments: Array.from(set) };
        });
      }
      setCustomDocInput("");
    } catch (err) {
      setNotice({ tone: "error", title: "Erreur", message: err.message });
    } finally {
      setCustomDocSaving(false);
    }
  }

  function handleSwitchProject(projectId) {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) return;
    setSelectedProjectId(project.id);
    setProjectForm(toProjectForm(project));
    setCompanyForm(createEmptyCompanyForm());
    setSelectedCompanyIds(new Set());
  }

  function handleSelectProject(projectId) {
    handleSwitchProject(projectId);
    setProjectModalOpen(true);
  }

  function handleNewProject() {
    setSelectedProjectId("");
    setProjectForm(createEmptyProjectForm());
    setCompanyForm(createEmptyCompanyForm());
    setSelectedCompanyIds(new Set());
    setProjectModalOpen(true);
  }

  function toggleCompanySelection(companyId) {
    setSelectedCompanyIds((current) => {
      const next = new Set(current);
      if (next.has(companyId)) next.delete(companyId);
      else next.add(companyId);
      return next;
    });
  }

  function toggleSelectAllCompanies() {
    if (!selectedProject) return;
    const companies = selectedProject.companies || [];
    setSelectedCompanyIds((current) => {
      if (current.size === companies.length && companies.length > 0) return new Set();
      return new Set(companies.map((company) => company.id));
    });
  }

  async function handleSendInvitations() {
    if (!selectedProject) return;
    if (!secureLinkEnabled) {
      setNotice({
        tone: "warning",
        title: "Signature inactive",
        message: "Configurez PORTAL_LINK_SECRET avant l'envoi des invitations.",
      });
      return;
    }
    if (!signingFlows.sendInvitationsEnabled) {
      setNotice({
        tone: "warning",
        title: "Flow absent",
        message:
          "Configurez POWER_AUTOMATE_SEND_INVITATIONS_URL cote serveur pour envoyer les invitations par email.",
      });
      return;
    }

    const companies = selectedProject.companies || [];
    const selected = Array.from(selectedCompanyIds);
    const hasSelection = selected.length > 0;
    const targets = hasSelection ? selected : companies.map((c) => c.id);

    if (!targets.length) {
      setNotice({
        tone: "warning",
        title: "Aucune entreprise",
        message: "Ajoutez au moins une entreprise avant l'envoi.",
      });
      return;
    }

    const scopeLabel = hasSelection
      ? `${targets.length} entreprise(s) selectionnee(s)`
      : `les ${targets.length} entreprises du projet`;
    if (
      !window.confirm(
        `Envoyer par email le lien securise a ${scopeLabel} du projet "${selectedProject.name}" ?`
      )
    ) {
      return;
    }

    setEmailSending("invitations");
    try {
      const result = await api.sendInvitationEmails(selectedProject.id, targets);
      await refreshInvitationStatuses();
      setNotice({
        tone: "success",
        title: "Invitations envoyees",
        message: `${result.count || 0} email(s) transmis au flow Power Automate.`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        title: "Envoi impossible",
        message: error.message || "Impossible d'envoyer les invitations.",
      });
    } finally {
      setEmailSending(null);
    }
  }

  async function handleSendReminders() {
    if (!selectedProject) return;
    if (!secureLinkEnabled) {
      setNotice({
        tone: "warning",
        title: "Signature inactive",
        message: "Configurez PORTAL_LINK_SECRET avant l'envoi des relances.",
      });
      return;
    }
    if (!signingFlows.sendRemindersEnabled) {
      setNotice({
        tone: "warning",
        title: "Flow absent",
        message:
          "Configurez POWER_AUTOMATE_SEND_REMINDERS_URL cote serveur pour envoyer les relances par email.",
      });
      return;
    }

    const selected = Array.from(selectedCompanyIds);
    const hasSelection = selected.length > 0;
    const scopeLabel = hasSelection
      ? `${selected.length} entreprise(s) selectionnee(s)`
      : "toutes les entreprises incompletes du projet";
    if (
      !window.confirm(
        `Envoyer une relance a ${scopeLabel} du projet "${selectedProject.name}" ?`
      )
    ) {
      return;
    }

    setEmailSending("reminders");
    try {
      const result = await api.sendReminderEmails(
        selectedProject.id,
        hasSelection ? selected : []
      );
      if (!result.count) {
        setNotice({
          tone: "success",
          title: "Aucune relance necessaire",
          message:
            result.message || "Toutes les entreprises ciblees ont deja depose leurs pieces.",
        });
      } else {
        setNotice({
          tone: "success",
          title: "Relances envoyees",
          message: `${result.count} relance(s) transmise(s) au flow Power Automate.`,
        });
      }
      await refreshInvitationStatuses();
    } catch (error) {
      setNotice({
        tone: "error",
        title: "Envoi impossible",
        message: error.message || "Impossible d'envoyer les relances.",
      });
    } finally {
      setEmailSending(null);
    }
  }

  async function handleProjectSubmit(event) {
    event.preventDefault();

    if (!projectForm.name.trim() || !projectForm.dossierId.trim()) {
      setNotice({
        tone: "warning",
        title: "Projet incomplet",
        message: "Renseignez le nom et le code dossier du projet.",
      });
      return;
    }

    if (!defaultFolderPath.trim()) {
      setNotice({
        tone: "warning",
        title: "Configuration manquante",
        message:
          "Le chemin dossier par defaut n'est pas configure (VITE_CLIENT_PORTAL_DEFAULT_FOLDER_PATH au build).",
      });
      return;
    }

    const isUpdate = Boolean(projectForm.id);
    const projectId = projectForm.id || buildProjectId(projectForm);

    try {
      const saved = await api.saveProject({
        id: projectId,
        name: projectForm.name.trim(),
        dossierId: projectForm.dossierId.trim(),
        folderPath: defaultFolderPath,
        deadline: projectForm.deadline ? projectForm.deadline.trim() : "",
        customDocuments: projectForm.customDocumentsText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      });
      await refreshProjects();
      await refreshOverview();
      setSelectedProjectId(saved.id);
      setProjectForm(toProjectForm(saved));
      setProjectModalOpen(true);
      setNotice({
        tone: "success",
        title: isUpdate ? "Projet mis a jour" : "Projet cree",
        message: `${saved.name} est disponible dans le tableau d'administration.`,
      });
    } catch (err) {
      setNotice({ tone: "error", title: "Erreur", message: err.message });
    }
  }

  async function handleDeleteProject(projectId) {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) return;
    const ok = confirmByTyping({
      title: `Suppression du projet "${project.name}"`,
      expectedText: project.name,
    });
    if (!ok) {
      setNotice({
        tone: "warning",
        title: "Suppression annulee",
        message: "La confirmation saisie ne correspond pas au nom du projet.",
      });
      return;
    }

    try {
      await api.deleteProject(projectId);
      await refreshProjects();
      await refreshOverview();
      setCompanyForm(createEmptyCompanyForm());
      setNotice({
        tone: "success",
        title: "Projet supprime",
        message: `${project.name} a ete retire du tableau.`,
      });
    } catch (err) {
      setNotice({ tone: "error", title: "Erreur", message: err.message });
    }
  }

  async function handleArchiveProject(projectId) {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) return;
    if (
      !window.confirm(
        `Archiver le projet "${project.name}" ? Il sera masque de l'interface et TOUS les liens signes actifs seront revoques (definitif, le desarchivage ne les restaure pas).`
      )
    ) {
      return;
    }
    try {
      const archived = await api.archiveProject(projectId);
      if (selectedProjectId === projectId) {
        setSelectedProjectId("");
        setProjectForm(createEmptyProjectForm());
        setCompanyForm(createEmptyCompanyForm());
      }
      await refreshProjects();
      await refreshOverview();
      const revokedCount = Number(archived?.autoRevokedInvitations) || 0;
      setNotice({
        tone: "success",
        title: "Projet archive",
        message:
          revokedCount > 0
            ? `${project.name} a ete archive. ${revokedCount} lien(s) revoque(s).`
            : `${project.name} a ete archive et masque de l'interface.`,
      });
    } catch (err) {
      setNotice({ tone: "error", title: "Erreur", message: err.message });
    }
  }

  async function handleUnarchiveProject(projectId) {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) return;
    try {
      await api.unarchiveProject(projectId);
      await refreshProjects();
      await refreshOverview();
      setNotice({
        tone: "success",
        title: "Projet desarchive",
        message: `${project.name} est de nouveau visible dans l'interface. Les liens revoques ne sont pas restaures, generez-en de nouveaux si besoin.`,
      });
    } catch (err) {
      setNotice({ tone: "error", title: "Erreur", message: err.message });
    }
  }

  async function handleRevokeAllProjectLinks(project) {
    const target = project || selectedProject;
    if (!target) return;
    if (
      !window.confirm(
        `Revoquer TOUS les liens actifs du projet "${target.name}" ? Action definitive : les destinataires devront recevoir un nouveau lien pour acceder au portail.`
      )
    ) {
      return;
    }
    try {
      const result = await api.revokeAllProjectInvitations(target.id);
      await refreshInvitationStatuses();
      setNotice({
        tone: "success",
        title: "Liens revoques",
        message:
          result.revoked > 0
            ? `${result.revoked} lien(s) du projet ${target.name} revoque(s).`
            : `Aucun lien actif a revoquer sur ${target.name}.`,
      });
    } catch (err) {
      setNotice({ tone: "error", title: "Erreur", message: err.message });
    }
  }

  async function handleRevokeCompanyLinks(company) {
    if (!selectedProject || !company) return;
    if (
      !window.confirm(
        `Revoquer les liens actifs de "${company.companyName}" ? Action definitive : un nouveau lien devra etre genere pour redonner acces.`
      )
    ) {
      return;
    }
    try {
      const result = await api.revokeAllCompanyInvitations(
        selectedProject.id,
        company.companyId || company.id
      );
      await refreshInvitationStatuses();
      setNotice({
        tone: "success",
        title: "Liens revoques",
        message:
          result.revoked > 0
            ? `${result.revoked} lien(s) revoque(s) pour ${company.companyName}.`
            : `Aucun lien actif a revoquer pour ${company.companyName}.`,
      });
    } catch (err) {
      setNotice({ tone: "error", title: "Erreur", message: err.message });
    }
  }

  async function handleCompanySubmit(event) {
    event.preventDefault();

    if (!selectedProject) {
      setNotice({
        tone: "warning",
        title: "Projet requis",
        message: "Creez ou ouvrez un projet avant d'ajouter une entreprise.",
      });
      return;
    }

    if (
      !companyForm.companyName.trim() ||
      !companyForm.contactName.trim() ||
      !companyForm.companyEmail.trim() ||
      !companyForm.expectedDocuments.length
    ) {
      setNotice({
        tone: "warning",
        title: "Entreprise incomplete",
        message:
          "Renseignez l'entreprise, le contact, l'email et au moins une piece attendue.",
      });
      return;
    }

    const companyId = companyForm.companyId.trim() || buildCompanyId(companyForm);
    const nextCompany = {
      id: companyForm.id || `company-${slugify(companyId)}-${uniqueSuffix()}`,
      companyId,
      companyName: companyForm.companyName.trim(),
      contactName: companyForm.contactName.trim(),
      companyEmail: companyForm.companyEmail.trim(),
      submissionId:
        companyForm.submissionId.trim() || buildSubmissionId(selectedProject, companyForm),
      expectedDocuments: dedupe(companyForm.expectedDocuments),
    };

    const mode = companyForm.id ? "update" : "create";

    if (companySaveTimerRef.current) {
      clearTimeout(companySaveTimerRef.current);
      companySaveTimerRef.current = null;
    }
    setCompanySaveStatus({ phase: "saving", mode });

    try {
      await api.saveCompany(selectedProject.id, nextCompany);
      if (!companyModalOpenRef.current) return;

      await refreshProjects();
      await refreshOverview();
      setNotice({
        tone: "success",
        title: mode === "update" ? "Entreprise mise a jour" : "Entreprise ajoutée",
        message: `${nextCompany.companyName} est rattachee au projet ${selectedProject.name}.`,
      });
      setCompanySaveStatus({ phase: "saved", mode });
      companySaveTimerRef.current = setTimeout(() => {
        companySaveTimerRef.current = null;
        if (!companyModalOpenRef.current) return;
        setCompanyForm(createEmptyCompanyForm());
        setCompanyModalOpen(false);
      }, 1200);
    } catch (err) {
      if (companyModalOpenRef.current) {
        setCompanySaveStatus({ phase: "idle", mode });
      }
      setNotice({ tone: "error", title: "Erreur", message: err.message });
    }
  }

  function handleEditCompany(company) {
    resetCompanySaveUi({ mode: "update" });
    setCompanyForm(toCompanyForm(company));
    setDirectorySearch("");
    setCompanyDocumentSearch("");
    setCustomDocInput("");
    setCompanyModalOpen(true);
  }

  function handleSelectFromDirectory(entry) {
    if (!entry || entry.alreadyAttached) return;
    const validDocIds = new Set(companyDocumentOptions.map((doc) => doc.id));
    const carriedDocs = (entry.expectedDocuments || []).filter((id) => validDocIds.has(id));
    setCompanyForm({
      id: "",
      companyName: entry.companyName,
      companyId: entry.companyId,
      contactName: entry.contactName,
      companyEmail: entry.companyEmail,
      submissionId: "",
      expectedDocuments: carriedDocs.length ? carriedDocs : [...DEFAULT_EXPECTED_DOCUMENTS],
    });
    resetCompanySaveUi({ mode: "create" });
    setDirectorySearch("");
    setCompanyModalOpen(true);
  }

  function handleResetCompanyForm() {
    resetCompanySaveUi({ mode: "create" });
    setCompanyForm(createEmptyCompanyForm());
    setDirectorySearch("");
    setCompanyDocumentSearch("");
    setCustomDocInput("");
    setCompanyModalOpen(true);
  }

  function handleOpenCompanyModal() {
    resetCompanySaveUi({ mode: companyForm.id ? "update" : "create" });
    if (!companyForm.id) setCompanyForm(createEmptyCompanyForm());
    setDirectorySearch("");
    setCompanyDocumentSearch("");
    setCustomDocInput("");
    setCompanyModalOpen(true);
  }

  function handleCloseCompanyModal() {
    resetCompanySaveUi({ mode: "create" });
    setDirectorySearch("");
    setCompanyDocumentSearch("");
    setCustomDocInput("");
    setCompanyModalOpen(false);
  }

  function handleOpenProjectModal() {
    setProjectModalOpen(true);
  }

  function handleCloseProjectModal() {
    setProjectModalOpen(false);
  }

  useModalLock(projectModalOpen, handleCloseProjectModal);
  useModalLock(companyModalOpen, handleCloseCompanyModal);

  async function handleDeleteCompany(companyId) {
    if (!selectedProject) return;

    const company = (selectedProject.companies || []).find((entry) => entry.id === companyId);
    if (!company) return;
    const ok = confirmByTyping({
      title: `Suppression de l'entreprise "${company.companyName}"`,
      expectedText: company.companyName,
    });
    if (!ok) {
      setNotice({
        tone: "warning",
        title: "Suppression annulee",
        message: "La confirmation saisie ne correspond pas au nom de l'entreprise.",
      });
      return;
    }

    try {
      await api.deleteCompany(companyId);
      setSelectedCompanyIds((current) => {
        if (!current.has(companyId)) return current;
        const next = new Set(current);
        next.delete(companyId);
        return next;
      });
      await refreshProjects();
      await refreshOverview();
      setCompanyForm(createEmptyCompanyForm());
      setNotice({
        tone: "success",
        title: "Entreprise supprimee",
        message: `${company.companyName} a ete retiree du projet.`,
      });
    } catch (err) {
      setNotice({ tone: "error", title: "Erreur", message: err.message });
    }
  }

  async function handleGenerateLink(company) {
    if (!selectedProject) return;

    if (!secureLinkEnabled) {
      setNotice({
        tone: "warning",
        title: "Signature inactive",
        message: "Configurez PORTAL_LINK_SECRET cote serveur pour generer un lien securise.",
      });
      return;
    }

    try {
      const customById = new Map(
        (selectedProjectCustomDocs || [])
          .filter((doc) => doc && typeof doc === "object" && doc.id)
          .map((doc) => [doc.id, doc])
      );
      const invitationDocuments = dedupe(company.expectedDocuments).map(
        (documentId) => customById.get(documentId) || documentId
      );
      const result = await api.generateSignedInvitationLink({
        context: {
          projectId: selectedProject.id,
          companyDbId: company.id,
          companyId: company.companyId,
          companyName: company.companyName,
          companyEmail: company.companyEmail,
          contactName: company.contactName,
          submissionId: company.submissionId,
          contestName: selectedProject.name,
          dossierId: selectedProject.dossierId,
          folderPath: defaultFolderPath || selectedProject.folderPath,
          deadline: selectedProject.deadline,
          supportEmail: portalEnv.supportEmail,
          supportPhone: portalEnv.supportPhone,
          websiteUrl: portalEnv.websiteUrl,
          documents: invitationDocuments,
        },
      });

      try {
        await navigator.clipboard.writeText(result.url);
        setNotice({
          tone: "success",
          title: "Lien copie",
          message: `Le lien signe de ${company.companyName} a ete copie dans le presse-papiers.`,
        });
      } catch {
        window.prompt(`Copiez le lien signe de ${company.companyName}`, result.url);
        setNotice({
          tone: "success",
          title: "Lien genere",
          message: `Le lien signe de ${company.companyName} est pret.`,
        });
      }
      await refreshInvitationStatuses();
    } catch (error) {
      setNotice({
        tone: "error",
        title: "Generation impossible",
        message: error.message || "Le lien securise n'a pas pu etre genere.",
      });
    }
  }

  return {
    projects,
    selectedProjectId,
    selectedProject,
    selectedProjectCustomDocs,
    projectForm,
    companyForm,
    dbLoading,
    showArchived,
    setShowArchived,
    companyDocumentSearch,
    setCompanyDocumentSearch,
    customDocInput,
    setCustomDocInput,
    customDocSaving,
    companyModalOpen,
    companySaveStatus,
    projectModalOpen,
    selectedCompanyIds,
    emailSending,
    invitationStatusByCompanyId,
    directorySearch,
    setDirectorySearch,
    companyDocumentOptions,
    companyDocumentGroups,
    companyDirectory,
    directorySearchResults,
    totalExpectedPieces,
    totalCompanies,
    selectedProjectCompanyCount,
    handleProjectFieldChange,
    handleCompanyFieldChange,
    handleCompanyDocumentToggle,
    handleCompanyDocumentsBulk,
    handleAddCustomDocument,
    handleSwitchProject,
    handleSelectProject,
    handleNewProject,
    toggleCompanySelection,
    toggleSelectAllCompanies,
    handleSendInvitations,
    handleSendReminders,
    handleProjectSubmit,
    handleDeleteProject,
    handleArchiveProject,
    handleUnarchiveProject,
    handleRevokeAllProjectLinks,
    handleRevokeCompanyLinks,
    handleCompanySubmit,
    handleEditCompany,
    handleSelectFromDirectory,
    handleResetCompanyForm,
    handleOpenCompanyModal,
    handleCloseCompanyModal,
    handleOpenProjectModal,
    handleCloseProjectModal,
    handleDeleteCompany,
    handleGenerateLink,
    refreshInvitationStatuses,
    refreshProjects,
  };
}
