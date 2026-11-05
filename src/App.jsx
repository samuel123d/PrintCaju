import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx'
import BrandLoader from './components/BrandLoader.jsx'

const AdminLayout = lazy(() => import('./layouts/AdminLayout.jsx'))
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'))
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'))
const ExternalSalesPage = lazy(() => import('./pages/ExternalSalesPage.jsx'))
const ProductionPage = lazy(() => import('./pages/ProductionPage.jsx'))
const ProductsPage = lazy(() => import('./pages/ProductsPage.jsx'))
const InventoryPage = lazy(() => import('./pages/InventoryPage.jsx'))
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'))
const FinancePage = lazy(() => import('./pages/FinancePage.jsx'))
const ReportsPage = lazy(() => import('./pages/ReportsPage.jsx'))
const AgendaPage = lazy(() => import('./pages/AgendaPage.jsx'))
const ClientsPage = lazy(() => import('./pages/ClientsPage.jsx'))
const PublicCustomerFormPage = lazy(() => import('./pages/PublicCustomerFormPage.jsx'))
const PublicGoogleFormPage = lazy(() => import('./pages/PublicGoogleFormPage.jsx'))
const PublicSitePage = lazy(() => import('./pages/PublicSitePage.jsx'))
const CustomerPortalPage = lazy(() => import('./pages/CustomerPortalPage.jsx'))
const SiteAdminPage = lazy(() => import('./pages/SiteAdminPage.jsx'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'))

function AdminGate() {
  const { user, isAdmin, loading } = useAuth()
  if (loading) return <BrandLoader message="Verificando seu acesso" fullScreen />
  if (!user) return <Navigate to="/admin/login" replace />
  if (!isAdmin) return <Navigate to="/conta" replace />
  return <AdminLayout />
}

function AdminLoginRoute() {
  const { user, isAdmin, loading } = useAuth()
  if (loading && user) return <BrandLoader message="Verificando seu acesso" fullScreen />
  if (user && isAdmin) return <Navigate to="/admin" replace />
  if (user) return <Navigate to="/conta" replace />
  return <LoginPage />
}

function RouteContent() {
  return <Suspense fallback={<BrandLoader message="Carregando página" fullScreen />}>
  <Routes>
    <Route path="/" element={<PublicSitePage />} />
    <Route path="/conta" element={<CustomerPortalPage />} />
    <Route path="/cliente" element={<Navigate to="/conta" replace />} />
    <Route path="/formulario-cliente/:token" element={<PublicCustomerFormPage />} />
    <Route path="/cadastro-cliente" element={<PublicGoogleFormPage />} />
    <Route path="/admin/login" element={<AdminLoginRoute />} />
    <Route path="/login" element={<Navigate to="/admin/login" replace />} />
    <Route path="/pedidos" element={<Navigate to="/admin/vendas" replace />} />
    <Route path="/compras" element={<Navigate to="/admin/financeiro" replace />} />
    <Route path="/admin" element={<AdminGate />}>
      <Route index element={<DashboardPage />} />
      <Route path="vendas" element={<ExternalSalesPage />} />
      <Route path="clientes" element={<ClientsPage />} />
      <Route path="financeiro" element={<FinancePage />} />
      <Route path="produtos" element={<ProductsPage />} />
      <Route path="producao" element={<ProductionPage />} />
      <Route path="estoque" element={<InventoryPage />} />
      <Route path="relatorios" element={<ReportsPage />} />
      <Route path="agenda" element={<AgendaPage />} />
      <Route path="configuracoes" element={<SettingsPage />} />
      <Route path="site" element={<SiteAdminPage />} />
      <Route path="pedidos" element={<Navigate to="/admin/vendas" replace />} />
      <Route path="compras" element={<Navigate to="/admin/financeiro" replace />} />
    </Route>
    <Route path="/vendas" element={<Navigate to="/admin/vendas" replace />} />
    <Route path="/produtos" element={<Navigate to="/admin/produtos" replace />} />
    <Route path="/clientes" element={<Navigate to="/admin/clientes" replace />} />
    <Route path="/financeiro" element={<Navigate to="/admin/financeiro" replace />} />
    <Route path="/producao" element={<Navigate to="/admin/producao" replace />} />
    <Route path="/estoque" element={<Navigate to="/admin/estoque" replace />} />
    <Route path="/relatorios" element={<Navigate to="/admin/relatorios" replace />} />
    <Route path="/agenda" element={<Navigate to="/admin/agenda" replace />} />
    <Route path="/configuracoes" element={<Navigate to="/admin/configuracoes" replace />} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes>
  </Suspense>
}

export default function App() {
  return <AuthProvider><RouteContent /></AuthProvider>
}
