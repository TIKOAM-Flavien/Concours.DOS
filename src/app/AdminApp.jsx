import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import AppVersion from "../components/AppVersion";
import AdminLogin from "../components/AdminLogin";
import AdminHistoryPanel from "../components/admin/AdminHistoryPanel";
import AdminInvitationsPanel from "../components/admin/AdminInvitationsPanel";
import AdminOverviewPanel from "../components/admin/AdminOverviewPanel";
import AdminProjectRibbon from "../components/admin/AdminProjectRibbon";
import AdminSummaryKpis from "../components/admin/AdminSummaryKpis";
import AdminTrackingPanel from "../components/admin/AdminTrackingPanel";
import StatusBanner from "../components/StatusBanner";

// Modals are only mounted when opened; defer their cost out of the initial
// admin bundle (saves ~30 KB gzipped on first paint).
const AdminDocumentReviewModal = lazy(
  () => import("../components/admin/AdminDocumentReviewModal")
);
const CompanyModal = lazy(() => import("../components/admin/CompanyModal"));
const ProjectModal = lazy(() => import("../components/admin/ProjectModal"));
import { portalEnv } from "../config/env";
import { createPowerAutomateClient } from "../lib/powerAutomateClient";
import * as api from "../lib/adminApi";
import { useAdminNotice } from "../hooks/useAdminNotice";
import { useAdminOverview } from "../hooks/useAdminOverview";
import { useAdminProjects } from "../hooks/useAdminProjects";
import { useAdminSigning } from "../hooks/useAdminSigning";
import { useAdminStorageStats } from "../hooks/useAdminStorageStats";
import { useAdminLiveEvents } from "../hooks/useAdminLiveEvents";
import { useAdminProjectActivity } from "../hooks/useAdminProjectActivity.js";
import { useAdminTracking } from "../hooks/useAdminTracking";
import { useModalLock } from "../hooks/useModalLock";
import { useProjectRibbon } from "../hooks/useProjectRibbon";

function resolveDepositedRecordId(record) {
  if (record?.localRecordId) return String(record.localRecordId).trim();
  const filePath = String(record?.filePath || "").trim();
  if (filePath.startsWith("local:")) return filePath.slice(6);
  return "";
}

function AdminAppDashboard({ authSession, onLogout }) {
  const [client] = useState(() => createPowerAutomateClient());
  const adminShellRef = useRef(null);
  const { notice, setNotice } = useAdminNotice();

  const {
    overviewState,
    overviewFilter,
    setOverviewFilter,
    overviewVisible,
    setOverviewVisible,
    refreshOverview,
    overviewItems,
    overviewSummary,
    filteredOverviewItems,
  } = useAdminOverview();

  const handleSigningError = useCallback(
    (error) => {
      setNotice({
        tone: "error",
        title: "Signature indisponible",
        message:
          error.message ||
          "Impossible de verifier la configuration de signature serveur.",
      });
    },
    [setNotice]
  );

  const { signingState, secureLinkEnabled } = useAdminSigning({
    onError: handleSigningError,
  });
  const { storageStats } = useAdminStorageStats();

  const {
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
  } = useAdminProjects({
    defaultFolderPath: portalEnv.defaultFolderPath,
    refreshOverview,
    setNotice,
    secureLinkEnabled,
    signingFlows: signingState.flows,
  });

  const {
    syncState,
    companyTracking,
    filteredCompanyTracking,
    filteredTrackingSummary,
    trackingDocumentOptions,
    trackingRefreshKey,
    trackingSearch,
    setTrackingSearch,
    trackingStatusFilter,
    setTrackingStatusFilter,
    trackingDocumentFilter,
    setTrackingDocumentFilter,
    trackingDocumentStateFilter,
    setTrackingDocumentStateFilter,
    trackingOnlyMissing,
    setTrackingOnlyMissing,
    trackingView,
    setTrackingView,
    trackingManualBusy,
    hasTrackingFilters,
    refreshTrackingManual,
    resetTrackingFilters,
  } = useAdminTracking({
    client,
    selectedProject,
    selectedProjectCustomDocs,
    documentsEnabled: Boolean(signingState.flows.documentsEnabled),
    onTrackingRefresh: refreshInvitationStatuses,
  });

  const {
    items: projectActivityItems,
    loading: projectActivityLoading,
    error: projectActivityError,
    reload: reloadProjectActivity,
  } = useAdminProjectActivity({
    projectId: selectedProject?.id || "",
    refreshKey: trackingRefreshKey,
  });

  // Server-pushed updates: when something changes in the DB (upload from the
  // portal, review, revoke, archive, ...) the relevant slice of admin state
  // is refetched. Events scoped to another project are dropped to avoid
  // re-rendering unrelated panels.
  useAdminLiveEvents({
    enabled: true,
    onInvalidate(event) {
      const eventProjectId = String(event?.projectId || "").trim();
      const currentProjectId = selectedProject?.id || "";
      const scope = String(event?.scope || "");

      if (scope === "projects") {
        refreshProjects();
        refreshOverview();
        return;
      }

      // Per-project scopes: only refresh when this admin tab is viewing the
      // project the event is about (or when the event has no projectId — we
      // can't be sure so we refresh defensively).
      if (eventProjectId && currentProjectId && eventProjectId !== currentProjectId) {
        return;
      }

      if (scope === "invitations") {
        refreshInvitationStatuses();
        refreshOverview();
        return;
      }

      // scope === "documents" (or unknown): pull both the document tracking
      // and the invitation status because upload completion mutates both.
      refreshTrackingManual();
      refreshInvitationStatuses();
    },
  });

  const selectedProjectReceived = useMemo(
    () => companyTracking.reduce((sum, company) => sum + company.receivedCount, 0),
    [companyTracking]
  );
  const selectedProjectExpected = useMemo(
    () => companyTracking.reduce((sum, company) => sum + company.expectedCount, 0),
    [companyTracking]
  );
  const selectedProjectIsComplete = useMemo(() => {
    if (!selectedProject || !companyTracking.length) return false;
    return companyTracking.every(
      (company) => company.expectedCount > 0 && company.receivedCount >= company.expectedCount
    );
  }, [companyTracking, selectedProject]);
  const unfinishedProjects = useMemo(
    () =>
      projects.filter((project) => {
        if (project.id === selectedProjectId) {
          return !selectedProjectIsComplete;
        }
        return true;
      }),
    [projects, selectedProjectId, selectedProjectIsComplete]
  );

  const {
    ribbonSentinelRef,
    ribbonNavRef,
    ribbonTrackRef,
    ribbonStuck,
    ribbonDockedTop,
  } = useProjectRibbon({
    unfinishedCount: unfinishedProjects.length,
    overviewVisible,
  });

  const [documentReview, setDocumentReview] = useState(null);
  const documentReviewRequestIdRef = useRef(0);

  const closeDocumentReview = useCallback(() => {
    setDocumentReview((current) => {
      if (current?.blobUrl) URL.revokeObjectURL(current.blobUrl);
      return null;
    });
  }, []);

  useModalLock(Boolean(documentReview), closeDocumentReview);

  const openDocumentReview = useCallback(async ({ item, company }) => {
    const record = item?.latest;
    const recordId = resolveDepositedRecordId(record);
    if (!recordId) return;

    const requestId = documentReviewRequestIdRef.current + 1;
    documentReviewRequestIdRef.current = requestId;

    setDocumentReview((current) => {
      if (current?.blobUrl) URL.revokeObjectURL(current.blobUrl);
      return {
        recordId,
        documentLabel: item.document.label,
        companyName: company.companyName,
        fileName: record.fileName || "",
        reviewStatus: record.reviewStatus || "pending",
        reviewComment: record.reviewComment || "",
        reviewedAt: record.reviewedAt || "",
        reviewedBy: record.reviewedBy || "",
        blobUrl: null,
        loading: true,
        error: null,
        saving: false,
      };
    });

    try {
      const data = await api.downloadAdminDocument(recordId);
      if (requestId !== documentReviewRequestIdRef.current) return;

      // The blob already carries the right MIME type from the server stream.
      setDocumentReview((current) =>
        current
          ? {
              ...current,
              fileName: data.fileName || current.fileName,
              reviewStatus: data.reviewStatus || current.reviewStatus,
              blobUrl: URL.createObjectURL(data.blob),
              loading: false,
              error: null,
            }
          : null
      );
    } catch (error) {
      if (requestId !== documentReviewRequestIdRef.current) return;
      setDocumentReview((current) =>
        current
          ? {
              ...current,
              loading: false,
              error: error?.message || "Impossible de charger le fichier.",
            }
          : null
      );
    }
  }, []);

  const submitDocumentReview = useCallback(
    async (reviewStatus, reviewComment = "") => {
      if (!documentReview?.recordId) return;

      setDocumentReview((current) =>
        current ? { ...current, saving: true, error: null } : null
      );

      try {
        await api.reviewAdminDocument(documentReview.recordId, {
          reviewStatus,
          reviewComment,
        });
        refreshTrackingManual();
        setNotice({
          tone: reviewStatus === "accepted" ? "success" : "warning",
          title: reviewStatus === "accepted" ? "Piece acceptee" : "Piece refusee",
          message: `${documentReview.documentLabel} · ${documentReview.companyName}`,
        });
        closeDocumentReview();
      } catch (error) {
        setDocumentReview((current) =>
          current
            ? {
                ...current,
                saving: false,
                error: error?.message || "Validation impossible.",
              }
            : null
        );
      }
    },
    [documentReview, refreshTrackingManual, setNotice, closeDocumentReview]
  );

  if (dbLoading) {
    return (
      <div
        className="admin-shell"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}
      >
        <p>Chargement depuis la base de donnees...</p>
      </div>
    );
  }

  return (
    <div className="admin-shell" ref={adminShellRef}>
      <header className="admin-header">
        {authSession?.authMode === "password" ? (
          <div className="admin-header__session">
            <span className="admin-header__session-user">{authSession.username}</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={onLogout}>
              Deconnexion
            </button>
          </div>
        ) : null}
        <div className="admin-header__main">
          <span className="portal-brand">{portalEnv.brandName}</span>
          <h1 className="portal-title admin-header__title">
            <span>Tableau d&apos;administration concours</span>
            <AppVersion className="app-version--header" />
          </h1>
          <p className="admin-header__copy">
            Creez les projets, rattachez les entreprises invitees, definissez les pieces attendues
            et suivez la reception des depots.
          </p>
        </div>
      </header>

      <AdminSummaryKpis
        projects={projects}
        selectedProject={selectedProject}
        selectedProjectReceived={selectedProjectReceived}
        selectedProjectExpected={selectedProjectExpected}
        selectedProjectIsComplete={selectedProjectIsComplete}
        selectedProjectCompanyCount={selectedProjectCompanyCount}
        totalCompanies={totalCompanies}
        totalExpectedPieces={totalExpectedPieces}
        storageStats={storageStats}
        onOpenProjectModal={handleOpenProjectModal}
        onOpenCompanyModal={handleOpenCompanyModal}
      />

      {signingState.status === "disabled" ? (
        <StatusBanner tone="warning" title="Lien securise indisponible">
          <p>
            Configurez <code>PORTAL_LINK_SECRET</code> cote serveur pour signer les invitations
            generees depuis cette page.
          </p>
        </StatusBanner>
      ) : null}

      {notice ? (
        <StatusBanner tone={notice.tone} title={notice.title}>
          <p>{notice.message}</p>
        </StatusBanner>
      ) : null}

      <AdminProjectRibbon
        unfinishedProjects={unfinishedProjects}
        selectedProjectId={selectedProjectId}
        ribbonSentinelRef={ribbonSentinelRef}
        ribbonNavRef={ribbonNavRef}
        ribbonTrackRef={ribbonTrackRef}
        ribbonStuck={ribbonStuck}
        ribbonDockedTop={ribbonDockedTop}
        onSwitchProject={handleSwitchProject}
      />

      <main className="admin-layout admin-layout--single">
        <div className="admin-content">
          <AdminOverviewPanel
            overviewState={overviewState}
            overviewVisible={overviewVisible}
            overviewFilter={overviewFilter}
            overviewItems={overviewItems}
            overviewSummary={overviewSummary}
            filteredOverviewItems={filteredOverviewItems}
            selectedProjectId={selectedProjectId}
            onRefresh={refreshOverview}
            onToggleVisible={() => setOverviewVisible((current) => !current)}
            onFilterChange={setOverviewFilter}
            onSwitchProject={handleSwitchProject}
          />

          <AdminInvitationsPanel
            selectedProject={selectedProject}
            selectedProjectCustomDocs={selectedProjectCustomDocs}
            selectedCompanyIds={selectedCompanyIds}
            invitationStatusByCompanyId={invitationStatusByCompanyId}
            secureLinkEnabled={secureLinkEnabled}
            onToggleSelectAll={toggleSelectAllCompanies}
            onToggleCompany={toggleCompanySelection}
            onEditCompany={handleEditCompany}
            onGenerateLink={handleGenerateLink}
            onDeleteCompany={handleDeleteCompany}
            onRevokeCompanyLinks={handleRevokeCompanyLinks}
            onRevokeAllProjectLinks={handleRevokeAllProjectLinks}
          />

          <AdminTrackingPanel
            selectedProject={selectedProject}
            documentsEnabled={Boolean(signingState.flows.documentsEnabled)}
            secureLinkEnabled={secureLinkEnabled}
            sendInvitationsEnabled={Boolean(signingState.flows.sendInvitationsEnabled)}
            sendRemindersEnabled={Boolean(signingState.flows.sendRemindersEnabled)}
            emailSending={emailSending}
            syncState={syncState}
            companyTracking={companyTracking}
            filteredCompanyTracking={filteredCompanyTracking}
            filteredTrackingSummary={filteredTrackingSummary}
            trackingDocumentOptions={trackingDocumentOptions}
            trackingSearch={trackingSearch}
            onTrackingSearchChange={setTrackingSearch}
            trackingStatusFilter={trackingStatusFilter}
            onTrackingStatusFilterChange={setTrackingStatusFilter}
            trackingDocumentFilter={trackingDocumentFilter}
            onTrackingDocumentFilterChange={setTrackingDocumentFilter}
            trackingDocumentStateFilter={trackingDocumentStateFilter}
            onTrackingDocumentStateFilterChange={setTrackingDocumentStateFilter}
            trackingOnlyMissing={trackingOnlyMissing}
            onTrackingOnlyMissingChange={setTrackingOnlyMissing}
            trackingView={trackingView}
            onTrackingViewChange={setTrackingView}
            hasTrackingFilters={hasTrackingFilters}
            trackingManualBusy={trackingManualBusy}
            invitationStatusByCompanyId={invitationStatusByCompanyId}
            onSendInvitations={handleSendInvitations}
            onSendReminders={handleSendReminders}
            onRefreshTracking={refreshTrackingManual}
            onResetFilters={resetTrackingFilters}
            onOpenDocumentReview={openDocumentReview}
          />

          <AdminHistoryPanel
            selectedProject={selectedProject}
            activityItems={projectActivityItems}
            activityLoading={projectActivityLoading}
            activityError={projectActivityError}
            onRefreshActivity={reloadProjectActivity}
          />
        </div>
      </main>

      <Suspense fallback={null}>
        {projectModalOpen ? (
          <ProjectModal
            open={projectModalOpen}
            projectForm={projectForm}
            projects={projects}
            selectedProjectId={selectedProjectId}
            showArchived={showArchived}
            onClose={handleCloseProjectModal}
            onNewProject={handleNewProject}
            onFieldChange={handleProjectFieldChange}
            onSubmit={handleProjectSubmit}
            onSelectProject={handleSelectProject}
            onArchiveProject={handleArchiveProject}
            onUnarchiveProject={handleUnarchiveProject}
            onDeleteProject={handleDeleteProject}
            onShowArchivedChange={setShowArchived}
          />
        ) : null}

        {companyModalOpen ? (
          <CompanyModal
            open={companyModalOpen}
            selectedProject={selectedProject}
            companyForm={companyForm}
            companySaveStatus={companySaveStatus}
            companyDirectory={companyDirectory}
            directorySearch={directorySearch}
            directorySearchResults={directorySearchResults}
            companyDocumentOptions={companyDocumentOptions}
            companyDocumentGroups={companyDocumentGroups}
            companyDocumentSearch={companyDocumentSearch}
            customDocInput={customDocInput}
            customDocSaving={customDocSaving}
            onClose={handleCloseCompanyModal}
            onReset={handleResetCompanyForm}
            onSubmit={handleCompanySubmit}
            onFieldChange={handleCompanyFieldChange}
            onDirectorySearchChange={setDirectorySearch}
            onSelectFromDirectory={handleSelectFromDirectory}
            onDocumentSearchChange={setCompanyDocumentSearch}
            onDocumentToggle={handleCompanyDocumentToggle}
            onDocumentsBulk={handleCompanyDocumentsBulk}
            onCustomDocInputChange={setCustomDocInput}
            onAddCustomDocument={handleAddCustomDocument}
          />
        ) : null}

        {documentReview ? (
          <AdminDocumentReviewModal
            open={Boolean(documentReview)}
            companyName={documentReview?.companyName || ""}
            documentLabel={documentReview?.documentLabel || ""}
            fileName={documentReview?.fileName || ""}
            reviewStatus={documentReview?.reviewStatus || "pending"}
            reviewComment={documentReview?.reviewComment || ""}
            reviewedAt={documentReview?.reviewedAt || ""}
            reviewedBy={documentReview?.reviewedBy || ""}
            blobUrl={documentReview?.blobUrl || null}
            loading={Boolean(documentReview?.loading)}
            error={documentReview?.error || ""}
            saving={Boolean(documentReview?.saving)}
            onClose={closeDocumentReview}
            onAccept={() => submitDocumentReview("accepted")}
            onReject={(comment) => submitDocumentReview("rejected", comment)}
          />
        ) : null}
      </Suspense>
    </div>
  );
}

export default function AdminApp() {
  const [authState, setAuthState] = useState({
    status: "loading",
    authenticated: false,
    authMode: "network",
    username: null,
    error: "",
  });

  const refreshAuthSession = useCallback(async () => {
    setAuthState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const data = await api.fetchAuthSession();
      setAuthState({
        status: "ready",
        authenticated: Boolean(data?.authenticated),
        authMode: data?.authMode === "password" ? "password" : "network",
        username: data?.username || null,
        error: "",
      });
    } catch (error) {
      setAuthState({
        status: "error",
        authenticated: false,
        authMode: "network",
        username: null,
        error: error?.message || "Impossible de verifier la session admin.",
      });
    }
  }, []);

  useEffect(() => {
    refreshAuthSession();
  }, [refreshAuthSession]);

  async function handleLogout() {
    try {
      await api.logoutAdminSession();
    } catch {
      // Clear local state even if the cookie was already gone.
    }
    await refreshAuthSession();
  }

  if (authState.status === "loading") {
    return (
      <div className="admin-login-shell">
        <p>Verification de la session...</p>
      </div>
    );
  }

  if (authState.status === "error") {
    return (
      <div className="admin-login-shell">
        <StatusBanner tone="error" title="Session indisponible">
          <p>{authState.error}</p>
        </StatusBanner>
      </div>
    );
  }

  if (authState.authMode === "password" && !authState.authenticated) {
    return <AdminLogin onSuccess={refreshAuthSession} />;
  }

  if (!authState.authenticated) {
    return (
      <div className="admin-login-shell">
        <div className="admin-login-card">
          <header className="admin-login-card__head">
            <span className="portal-brand">{portalEnv.brandName}</span>
            <h1 className="admin-login-card__title">Acces admin restreint</h1>
          </header>
          <p className="admin-login-card__copy">
            Cette instance n&apos;utilise pas encore de mot de passe admin. Ouvrez `/admin` depuis
            localhost ou configurez `PORTAL_ADMIN_PASSWORD`.
          </p>
        </div>
      </div>
    );
  }

  return <AdminAppDashboard authSession={authState} onLogout={handleLogout} />;
}
