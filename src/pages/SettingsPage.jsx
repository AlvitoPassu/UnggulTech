import React, { useState, useEffect } from 'react';
import SettingsSidebar from '../components/Settings/SettingsSidebar';
import ProfileSettings from '../components/Settings/ProfileSettings';
import ConnectivitySettings from '../components/Settings/ConnectivitySettings';

const SettingsPage = () => {
  const [activeSection, setActiveSection] = useState('profile');

  useEffect(() => {
    const handleScroll = () => {
      const sections = ['profile', 'connectivity', 'api', 'preferences', 'account'];
      const scrollPosition = window.scrollY + 150;

      for (const sectionId of sections) {
        const element = document.getElementById(sectionId);
        if (element) {
          const offsetTop = element.offsetTop;
          const offsetHeight = element.offsetHeight;

          if (scrollPosition >= offsetTop && scrollPosition < offsetTop + offsetHeight) {
            setActiveSection(sectionId);
            break;
          }
        }
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="max-w-[1200px] mx-auto flex flex-col lg:flex-row gap-10 items-start">
      <SettingsSidebar activeSection={activeSection} />
      
      <div className="flex-1 w-full flex flex-col gap-10">
        <ProfileSettings />
        <ConnectivitySettings />
        
        {/* Placeholder for other sections */}
        <section className="bg-white/70 backdrop-blur-md border border-[#0d631b]/20 rounded-xl p-8 shadow-[0_0_20px_rgba(46,125,50,0.08)]" id="api">
          <div className="flex items-center gap-3 border-b border-[#0d631b]/10 pb-3 mb-6">
            <span className="material-symbols-outlined text-[#0d631b]">api</span>
            <h2 className="text-2xl font-semibold text-[#1a1c1c]">API Management</h2>
          </div>
          <p className="text-sm text-[#40493d]">API key management and third-party integration settings will appear here.</p>
        </section>

        <section className="bg-white/70 backdrop-blur-md border border-[#0d631b]/20 rounded-xl p-8 shadow-[0_0_20px_rgba(46,125,50,0.08)]" id="preferences">
          <div className="flex items-center gap-3 border-b border-[#0d631b]/10 pb-3 mb-6">
            <span className="material-symbols-outlined text-[#0d631b]">tune</span>
            <h2 className="text-2xl font-semibold text-[#1a1c1c]">Preferences</h2>
          </div>
          <p className="text-sm text-[#40493d]">Display settings, language, and theme preferences will appear here.</p>
        </section>

        <section className="bg-white/70 backdrop-blur-md border border-[#0d631b]/20 rounded-xl p-8 shadow-[0_0_20px_rgba(46,125,50,0.08)]" id="account">
          <div className="flex items-center gap-3 border-b border-[#0d631b]/10 pb-3 mb-6">
            <span className="material-symbols-outlined text-[#0d631b]">manage_accounts</span>
            <h2 className="text-2xl font-semibold text-[#1a1c1c]">Account</h2>
          </div>
          <p className="text-sm text-[#40493d]">Security, password reset, and account deletion options will appear here.</p>
        </section>
      </div>
    </div>
  );
};

export default SettingsPage;
