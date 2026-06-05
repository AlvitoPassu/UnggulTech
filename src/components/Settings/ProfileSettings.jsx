import React from 'react';
import SoftInput from './SoftInput';

const ProfileSettings = () => {
  return (
    <section className="bg-white/70 backdrop-blur-md border border-[#0d631b]/20 rounded-xl p-6 md:p-8 transition-colors duration-300 shadow-[0_0_20px_rgba(46,125,50,0.08)]" id="profile">
      <div className="flex items-center gap-3 border-b border-[#0d631b]/10 pb-3 mb-6">
        <span className="material-symbols-outlined text-[#0d631b]">person</span>
        <h2 className="text-2xl font-semibold text-[#1a1c1c]">User Profile</h2>
      </div>
      
      <div className="flex flex-col md:flex-row gap-10">
        <div className="flex flex-col items-center gap-3 shrink-0">
          <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-[#0d631b]/20 relative group cursor-pointer shadow-sm">
            <img 
              alt="Profile Picture" 
              className="w-full h-full object-cover" 
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuBOu3c69CQccxDP6K_r19sLl5gexoja3piIIpRrtbRzIUu9Xhu56XGTVuhKz2kc_ynGAp2MX37ME7wXprdjDlivIjP-IRm5CxCARYZ95Fq934dBidNZhF1vR0QQGdn5JP4dkke27ovCbexg8EefYBe0Lsi00V-LpAe9UtEYXMctj6wfMeYUNtblhnGr2M_4dynBEXHUhqiy4DxNkdTEXYauYSNsfHIHIYj1c-yZ0KzZzuyVbKxDnh6Qg3GzzLdGuFDxQLRSvR7m2Esv"
            />
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="material-symbols-outlined text-white">photo_camera</span>
            </div>
          </div>
          <button className="text-[#0d631b] text-xs font-bold uppercase tracking-wide hover:underline">Change Photo</button>
        </div>
        
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
          <SoftInput label="Full Name" value="John Doe" />
          <SoftInput label="Role" value="Farm Manager" disabled />
          <div className="md:col-span-2">
            <SoftInput label="Email Address" type="email" value="john.doe@agritech.local" />
          </div>
        </div>
      </div>
      
      <div className="mt-8 flex justify-end">
        <button className="bg-[#0d631b] text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#2e7d32] transition-colors shadow-sm">
          Save Profile
        </button>
      </div>
    </section>
  );
};

export default ProfileSettings;
