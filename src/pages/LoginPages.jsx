import React, { useState, useEffect } from 'react';

const LoginPage = ({ onLogin }) => {
  const [role, setRole] = useState('admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    // Simulate login
    onLogin();
  };

  return (
    <div 
      className="fixed inset-0 bg-white font-sans overflow-hidden flex items-center justify-center p-4 md:p-12"
    >
      {/* Background Layer */}
      <div className="absolute inset-0 z-0">
        <img 
          alt="Agricultural Landscape" 
          className="w-full h-full object-cover" 
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuBLpNIWMGWwi9N8iJK9yTyrIYaDb24tTsHxbJAB9aaGmbu9I6nJ0xN04v0i9aEr0G338VqhpR8lyCMTitTSrRnN9IdJY63Wd_brrgB-4GayTTwD3OW66PzXPJW_HCwxHzLH4cZ4Zj2KNtkjBtcy4OJp3QoU0G8kJ90egE6LjS-v-AG-CcMvOUkW8dR74KAoRNk9PLgXXAED6QzPAbIGSZVjRpnu_QeuvvIgaAieM8I8Hz4HP16JFuPsLhPSAIoa3ILR36PPlYHZVzRX"
        />
        <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px]"></div>
      </div>

      {/* Login Container */}
      <main 
        className="relative z-10 w-full max-w-[480px]"
      >
        <div className="bg-white/75 backdrop-blur-xl border border-[#0d631b]/15 rounded-xl p-6 md:p-10 flex flex-col gap-6 shadow-[0_8px_32px_0_rgba(46,125,50,0.08)]">
          {/* Brand Identity */}
          <div className="flex flex-col items-center text-center gap-1">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-[#0d631b] text-[40px]" style={{ fontVariationSettings: "'FILL' 1" }}>eco</span>
              <h1 className="text-3xl font-bold text-[#1a1c1c]">AgriTech Pro</h1>
            </div>
            <p className="text-sm font-medium text-[#40493d] tracking-wider uppercase">Precision Farming</p>
          </div>

          {/* Form Section */}
          <form className="flex flex-col gap-6 mt-2" onSubmit={handleSubmit}>
            {/* Role Selector */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-[#40493d] ml-1" htmlFor="role">Select Role</label>
              <div className="relative flex items-center group transition-transform duration-200 focus-within:scale-[1.01]">
                <span className="material-symbols-outlined absolute left-3 text-[#40493d]">badge</span>
                <select 
                  id="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full pl-12 pr-3 py-3 rounded-lg bg-white border border-[#bfcaba] focus:border-[#0d631b] focus:ring-2 focus:ring-[#0d631b]/20 transition-all outline-none appearance-none cursor-pointer text-sm"
                >
                  <option value="admin">Admin</option>
                  <option value="manajer">Manajer</option>
                  <option value="mandor">Mandor</option>
                  <option value="pekerja">Pekerja</option>
                </select>
                <span className="material-symbols-outlined absolute right-3 text-[#40493d] pointer-events-none">expand_more</span>
              </div>
            </div>

            {/* Email Field */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-[#40493d] ml-1" htmlFor="email">Email Address</label>
              <div className="relative flex items-center transition-transform duration-200 focus-within:scale-[1.01]">
                <span className="material-symbols-outlined absolute left-3 text-[#40493d]">mail</span>
                <input 
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="manager@farm.com"
                  className="w-full pl-12 pr-3 py-3 rounded-lg bg-white border border-[#bfcaba] focus:border-[#0d631b] focus:ring-2 focus:ring-[#0d631b]/20 transition-all outline-none text-sm"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-[#40493d] ml-1" htmlFor="password">Password</label>
              <div className="relative flex items-center transition-transform duration-200 focus-within:scale-[1.01]">
                <span className="material-symbols-outlined absolute left-3 text-[#40493d]">lock</span>
                <input 
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-12 pr-10 py-3 rounded-lg bg-white border border-[#bfcaba] focus:border-[#0d631b] focus:ring-2 focus:ring-[#0d631b]/20 transition-all outline-none text-sm"
                />
                <button 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 text-[#40493d] hover:text-[#0d631b] transition-colors"
                >
                  <span className="material-symbols-outlined">{showPassword ? 'visibility_off' : 'visibility'}</span>
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className="relative flex items-center">
                  <input type="checkbox" className="sr-only peer" />
                  <div className="w-5 h-5 border-2 border-[#bfcaba] rounded peer-checked:bg-[#0d631b] peer-checked:border-[#0d631b] transition-all flex items-center justify-center">
                    <span className="material-symbols-outlined text-white text-[16px] hidden peer-checked:block">check</span>
                  </div>
                </div>
                <span className="text-sm font-medium text-[#40493d] group-hover:text-[#1a1c1c] transition-colors">Remember Me</span>
              </label>
              <a className="text-sm font-medium text-[#0d631b] hover:underline transition-all" href="#">Forgot Password?</a>
            </div>

            {/* Primary Submit */}
            <button 
              type="submit"
              className="w-full bg-[#0d631b] text-white py-4 rounded-lg text-lg font-semibold hover:bg-[#0d631b]/90 active:scale-[0.98] transition-all shadow-lg shadow-[#0d631b]/20 flex items-center justify-center gap-2"
            >
              <span>Sign In</span>
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          </form>
        </div>

      </main>
    </div>
  );
};

export default LoginPage;
