import React, { useState } from 'react';
import LoginPage from './pages/LoginPages';
import DashboardPage from './pages/DashboardPage';
import Sidebar from './components/Layout/Sidebar';
import Header from './components/Layout/Header';
import SettingsPage from './pages/SettingsPage';
import NotificationsPage from './pages/NotificationsPage';
import SensorMonitoringPage from './pages/SensorMonitoringPage';
import ReportsPage from './pages/ReportsPage';

const App = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState('login'); // Default to login page

  const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);

  // Standalone pages (no Sidebar/Header)
  if (currentPage === 'login') {
    return <LoginPage onLogin={() => setCurrentPage('dashboard')} />;
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'sensors':
        return <SensorMonitoringPage />;
      case 'ai_chat':
        return <AIChatPage />;
      case 'notifications':
        return <NotificationsPage />;
      case 'reports':
        return <ReportsPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return (
          <div className="flex items-center justify-center h-full">
            <h2 className="text-2xl font-bold text-[#40493d]">Page "{currentPage}" is under construction</h2>
          </div>
        );
    }
  };

  return (
    <div className="bg-[#f9f9f9] text-[#1a1c1c] font-sans overflow-hidden flex h-screen">
      <Sidebar 
        isOpen={isMobileMenuOpen} 
        onClose={() => setIsMobileMenuOpen(false)} 
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        onLogout={() => setCurrentPage('login')}
      />

      {/* Main Content Wrapper */}
      <div className="md:ml-64 flex-1 flex flex-col h-screen overflow-hidden min-w-0">
        <Header onMenuClick={toggleMobileMenu} />

        {/* Scrollable Page Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-12 bg-[#f9f9f9]">
          {renderPage()}
        </main>
      </div>
    </div>
  );
};

export default App;
