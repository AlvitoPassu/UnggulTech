import React from 'react';
import AlertHistory from '../components/Notifications/AlertHistory';
import TelegramBotCard from '../components/Notifications/TelegramBotCard';
import AlertPreferences from '../components/Notifications/AlertPreferences';

const NotificationsPage = () => {
  return (
    <div className="space-y-10">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-[#1a1c1c] mb-1">Alerts & Messaging</h1>
        <p className="text-base text-[#40493d]">Monitor system anomalies and configure external notification integrations.</p>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-12 gap-6">
        <AlertHistory />
        
        {/* Right Column (Settings & Integrations) */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">
          <TelegramBotCard />
          <AlertPreferences />
        </div>
      </div>
    </div>
  );
};

export default NotificationsPage;
