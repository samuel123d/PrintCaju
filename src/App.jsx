import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx'
import Brand from './components/Brand.jsx'
import BrandLoader from './components/BrandLoader.jsx'
import AdminLayout from './layouts/AdminLayout.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import ExternalSalesPage from './pages/ExternalSalesPage.jsx'
import PlannedPage from './pages/PlannedPage.jsx'
import ProductionPage from './pages/ProductionPage.jsx'
import ProductsPage from './pages/ProductsPage.jsx'
import InventoryPage from './pages/InventoryPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import FinancePage from './pages/FinancePage.jsx'
import ReportsPage from './pages/ReportsPage.jsx'
import AgendaPage from './pages/AgendaPage.jsx'
import ClientsPage from './pages/ClientsPage.jsx'
import PublicCustomerFormPage from './pages/PublicCustomerFormPage.jsx'
import PublicGoogleFormPage from './pages/PublicGoogleFormPage.jsx'

function RouteContent() {
  const { user, isAdmin, loading, signOut } = useAuth()

  if (loading) {
    return <BrandLoader message="Verificando seu acesso" fullScreen />
  }

  if (user && !isAdmin) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <Brand />
          <h1>Acesso n�o autorizado</h1>
          <p>Esta conta ainda n�o tem a fun��o admin. No Firestore, crie ou atualize `users/{UID}` com o campo `role` igual a `admin` para liberar o painel.</p>
          <button className="button button-secondary button-full" onClick={signOut}>
            Sair da conta
          </button>
        </section>
      </main>
    )
  }

  return (
    <Routes>
      <Route path="/formulario-cliente/:token" element={<PublicCustomerFormPage />} />
      <Route path="/cadastro-cliente" element={<PublicGoogleFormPage />} />
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={user ? <AdminLayout /> : <Navigate to="/login" replace />}>
        <Route index element={<DashboardPage />} />
        <Route path="/pedidos" element={<Navigate to="/vendas" replace />} />
        <Route path="/vendas" element={<ExternalSalesPage />} />
        <Route path="/clientes" element={<ClientsPage />} />
        <Route path="/financeiro" element={<FinancePage />} />
        <Route path="/produtos" element={<ProductsPage />} />
        <Route path="/producao" element={<ProductionPage />} />
        <Route path="/estoque" element={<InventoryPage />} />
        <Route path="/compras" element={<Navigate to="/financeiro" replace />} />
        <Route path="/relatorios" element={<ReportsPage />} />
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/configuracoes" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
    </Routes>
  )
}

export default function App() {
  return <AuthProvider><RouteContent /></AuthProvider>
}
