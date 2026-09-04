import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/misc';
import { LandingPage } from '@/pages/landing';

/**
 * The marketing landing page loads eagerly because it is the first paint for
 * every anonymous visitor. Everything behind authentication is split per route,
 * so a contractor opening the estimate workspace does not first download the
 * CRM, the reports and the settings screens.
 */
const AppShell = lazy(() => import('@/components/layout/app-shell').then((m) => ({ default: m.AppShell })));
const AuthPage = lazy(() => import('@/pages/auth').then((m) => ({ default: m.AuthPage })));
const PricingPage = lazy(() => import('@/pages/pricing').then((m) => ({ default: m.PricingPage })));
const DashboardPage = lazy(() => import('@/pages/app/dashboard').then((m) => ({ default: m.DashboardPage })));
const EstimatesPage = lazy(() => import('@/pages/app/estimates').then((m) => ({ default: m.EstimatesPage })));
const EstimateWorkspacePage = lazy(() => import('@/pages/app/estimate-workspace').then((m) => ({ default: m.EstimateWorkspacePage })));
const PlansPage = lazy(() => import('@/pages/app/plans').then((m) => ({ default: m.PlansPage })));
const ProjectsPage = lazy(() => import('@/pages/app/projects').then((m) => ({ default: m.ProjectsPage })));
const ProjectDetailPage = lazy(() => import('@/pages/app/project-detail').then((m) => ({ default: m.ProjectDetailPage })));
const ProposalsPage = lazy(() => import('@/pages/app/proposals').then((m) => ({ default: m.ProposalsPage })));
const FleetPage = lazy(() => import('@/pages/app/fleet').then((m) => ({ default: m.FleetPage })));
const WorkforcePage = lazy(() => import('@/pages/app/workforce').then((m) => ({ default: m.WorkforcePage })));
const SchedulePage = lazy(() => import('@/pages/app/schedule').then((m) => ({ default: m.SchedulePage })));
const FinancePage = lazy(() => import('@/pages/app/finance').then((m) => ({ default: m.FinancePage })));
const ProcurementPage = lazy(() => import('@/pages/app/procurement').then((m) => ({ default: m.ProcurementPage })));
const SafetyPage = lazy(() => import('@/pages/app/safety').then((m) => ({ default: m.SafetyPage })));
const SurveyPage = lazy(() => import('@/pages/app/survey').then((m) => ({ default: m.SurveyPage })));
const ClaimsPage = lazy(() => import('@/pages/app/claims').then((m) => ({ default: m.ClaimsPage })));
const NetworkPage = lazy(() => import('@/pages/app/network').then((m) => ({ default: m.NetworkPage })));
const ApiAccessPage = lazy(() => import('@/pages/app/api-access').then((m) => ({ default: m.ApiAccessPage })));
const NotificationsPage = lazy(() => import('@/pages/app/notifications').then((m) => ({ default: m.NotificationsPage })));
const CrmPage = lazy(() => import('@/pages/app/crm').then((m) => ({ default: m.CrmPage })));
const LibrariesPage = lazy(() => import('@/pages/app/libraries').then((m) => ({ default: m.LibrariesPage })));
const ReportsPage = lazy(() => import('@/pages/app/reports').then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import('@/pages/app/settings').then((m) => ({ default: m.SettingsPage })));
const BillingPage = lazy(() => import('@/pages/app/billing').then((m) => ({ default: m.BillingPage })));
const NotFoundPage = lazy(() => import('@/pages/not-found').then((m) => ({ default: m.NotFoundPage })));

/** Shown only for the moment a route chunk is in flight. */
function RouteFallback() {
  return (
    <div className="flex min-h-64 items-center justify-center p-10" role="status" aria-live="polite">
      <span className="size-6 animate-spin rounded-full border-2 border-charcoal-200 border-t-yellow-500" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function App() {
  return (
    <TooltipProvider delayDuration={200}>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* Public */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/signup" element={<AuthPage mode="signup" />} />
          <Route path="/reset-password" element={<AuthPage mode="reset" />} />

          {/* Authenticated application */}
          <Route path="/app" element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="estimates" element={<EstimatesPage />} />
            <Route path="estimates/:estimateId" element={<EstimateWorkspacePage />} />
            <Route path="plans" element={<PlansPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:projectId" element={<ProjectDetailPage />} />
            <Route path="proposals" element={<ProposalsPage />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="fleet" element={<FleetPage />} />
            <Route path="workforce" element={<WorkforcePage />} />
            <Route path="procurement" element={<ProcurementPage />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="safety" element={<SafetyPage />} />
            <Route path="survey" element={<SurveyPage />} />
            <Route path="claims" element={<ClaimsPage />} />
            <Route path="network" element={<NetworkPage />} />
            <Route path="api" element={<ApiAccessPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="crm" element={<CrmPage />} />
            <Route path="libraries" element={<LibrariesPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="billing" element={<BillingPage />} />
          </Route>

          <Route path="/dashboard" element={<Navigate to="/app" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </TooltipProvider>
  );
}
