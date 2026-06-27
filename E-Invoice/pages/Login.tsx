import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ShieldCheck, Check, LogIn, CheckCircle2 } from 'lucide-react';
import { User } from '../types';
import { apiService } from '../services/apiService';
import { useTranslation } from '../i18n';

interface LoginProps {
  onLogin: (user: User) => void;
}

const OTaxLogo: React.FC<{ className?: string }> = ({ className }) => (
  <div className={`flex items-center select-none py-1 ${className || ''}`}>
    <img 
      src="/logo.png" 
      alt="OTax Logo" 
      className="h-8 w-auto object-contain" 
    />
  </div>
);

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [twoFaRequired, setTwoFaRequired] = useState(false);
  const [totpCode, setTotpCode] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const data = await apiService.login(username, password, twoFaRequired ? totpCode : undefined);
      if (data.success) {
        const displayRole = data.user.isSuperAdmin
          ? 'Super Admin'
          : data.user.isOrgAdmin
            ? 'Org Admin'
            : data.user.roles?.[0]?.displayName || 'User';

        onLogin({
          id: data.user.id,
          name: data.user.username,
          username: data.user.username,
          role: displayRole,
          avatar: '',
          isDemo: data.user.isDemo,
          isSuperAdmin: data.user.isSuperAdmin,
          isOrgAdmin: data.user.isOrgAdmin,
          roles: data.user.roles,
          permissions: data.user.permissions,
          organization: data.user.organization,
          properties: data.user.properties,
          token: data.token || data.user.token,
        });

        if (data.user.organization?.name) {
          localStorage.setItem('company_name', data.user.organization.name);
        }

        if (data.user.isSuperAdmin) {
          navigate('/super-admin');
        } else {
          const hasEtaCredentials = data.user.properties?.some(
            (p: any) => (p.property_name === 'signer_preProdClientId' || p.property_name === 'signer_prodClientId') && p.property_value
          );
          if (!hasEtaCredentials) {
            navigate('/settings/compinfo');
          } else {
            navigate('/dashboard');
          }
        }
      }
    } catch (err: any) {
      if (err.twoFactorRequired) {
        setTwoFaRequired(true);
        setError(twoFaRequired ? (err.message || t('login.errInvalidCode')) : null);
        setTotpCode('');
      } else {
        setError(err.message || t('login.errConn'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full font-sans flex items-center justify-center p-4 bg-[#030712] relative overflow-hidden">
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        @keyframes float-delayed {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        @keyframes float-slow {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-12px); }
        }
      `}</style>

      {/* Decorative blurred background shapes */}
      <div className="absolute top-[-25%] left-[-15%] w-[65%] h-[65%] rounded-full bg-blue-500/10 blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-25%] right-[-15%] w-[65%] h-[65%] rounded-full bg-indigo-500/10 blur-[130px] pointer-events-none" />
      <div className="absolute top-[20%] right-[20%] w-[45%] h-[45%] rounded-full bg-purple-500/5 blur-[110px] pointer-events-none" />

      {/* Background grid pattern */}
      <div className="absolute inset-0 opacity-[0.03] bg-[linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

      {/* Main Container */}
      <div className="flex flex-col lg:flex-row w-full max-w-[1140px] items-center justify-between gap-12 lg:gap-16 z-10 px-4 py-8 relative">
        
        {/* LEFT PANEL (Mockup Graphic & Info) */}
        <div className="w-full lg:w-[50%] flex flex-col justify-between min-h-[580px] text-white">
          
          {/* Logo */}
          <div className="relative z-10">
            <OTaxLogo />
          </div>

          {/* Core titles */}
          <div className="relative z-10 my-6">
            <h2 className="text-3xl lg:text-[40px] font-extrabold leading-tight tracking-tight text-white">
              Smart tax operations.<br />
              <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                Seamless e-invoicing.
              </span>
            </h2>
            <p className="text-slate-400 text-sm font-medium leading-relaxed max-w-md mt-4">
              OTax empowers finance and tax teams to comply, export, and grow with confidence.
            </p>
          </div>

          {/* Central floating 3D graphic mockup */}
          <div className="relative w-full max-w-[480px] h-[340px] flex items-center justify-center my-4">
            
            {/* Pedestal Base */}
            <div className="absolute bottom-[35px] w-[260px] h-[70px] rounded-full bg-blue-500/10 border border-blue-500/20 transform scale-y-[0.3] flex items-center justify-center animate-pulse" />
            <div className="absolute bottom-[38px] w-[220px] h-[50px] rounded-full bg-gradient-to-t from-blue-600/40 to-cyan-500/20 blur-sm transform scale-y-[0.3]" />
            <div className="absolute bottom-[41px] w-[180px] h-[30px] rounded-full bg-cyan-400/50 blur-md transform scale-y-[0.3]" />
            
            {/* Concentric rings/grid lines */}
            <div className="absolute bottom-[15px] w-[340px] h-[100px] rounded-full border border-blue-500/10 border-dashed transform scale-y-[0.3] animate-[spin_40s_linear_infinite]" />

            {/* Center Document (E-INVOICE) */}
            <div className="absolute bottom-[55px] bg-gradient-to-b from-blue-950/80 to-slate-950/90 backdrop-blur-lg border border-blue-500/40 rounded-2xl p-4 w-44 shadow-[0_0_30px_rgba(59,130,246,0.3)] z-20 flex flex-col gap-2.5 animate-[float-slow_4s_ease-in-out_infinite] transform transition-transform hover:scale-105 duration-300">
              <div className="flex items-center justify-between border-b border-blue-900/40 pb-2">
                <span className="text-[10px] font-bold text-blue-400 tracking-widest font-sans">E-INVOICE</span>
                <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white shadow-[0_0_8px_rgba(59,130,246,0.5)]">
                  <Check size={10} className="stroke-[3]" />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="w-full h-1.5 bg-blue-900/40 rounded-full" />
                <div className="w-5/6 h-1.5 bg-blue-900/40 rounded-full" />
                <div className="w-2/3 h-1.5 bg-blue-900/40 rounded-full" />
              </div>
              <div className="mt-1.5 pt-2 border-t border-blue-900/40 flex items-center justify-between">
                {/* Signature squiggle SVG */}
                <svg width="28" height="12" viewBox="0 0 28 12" fill="none" className="stroke-blue-400/60 stroke-[1.5]">
                  <path d="M2 10C5 10 6 2 9 2C12 2 13 8 16 8C19 8 20 4 23 4C24.5 4 25.5 7 26 10" />
                </svg>
                <span className="text-[8px] font-mono text-blue-500/80">#E-0842</span>
              </div>
            </div>

            {/* Floating Card 1: Analytics (Top Left) */}
            <div className="absolute left-[10px] top-[20px] bg-[#0b1329]/80 backdrop-blur-md border border-blue-900/50 rounded-xl p-3 flex items-start gap-2.5 shadow-lg w-40 z-30 animate-[float_5.5s_ease-in-out_infinite] transform hover:scale-105 transition-transform duration-300">
              <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20 shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                  <polyline points="16 7 22 7 22 13" />
                </svg>
              </div>
              <div className="text-left min-w-0">
                <div className="text-[9px] font-bold text-white tracking-wide truncate">Analytics</div>
                <div className="text-[7px] text-slate-400 truncate mt-0.5">Real-time insights</div>
                {/* Tiny CSS bar chart */}
                <div className="flex gap-0.5 items-end h-6 mt-1.5">
                  <div className="w-1.5 h-2 bg-blue-500/30 rounded-sm" />
                  <div className="w-1.5 h-4 bg-blue-500/60 rounded-sm" />
                  <div className="w-1.5 h-3 bg-blue-500/40 rounded-sm" />
                  <div className="w-1.5 h-5.5 bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.5)] rounded-sm" />
                </div>
              </div>
            </div>

            {/* Floating Card 2: Secure Data (Bottom Left) */}
            <div className="absolute left-[-15px] bottom-[50px] bg-[#0b1329]/80 backdrop-blur-md border border-blue-900/50 rounded-xl p-2.5 flex items-center gap-2.5 shadow-lg w-38 z-30 animate-[float-delayed_6s_ease-in-out_infinite] transform hover:scale-105 transition-transform duration-300">
              <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20 shrink-0">
                <Lock size={12} className="stroke-[2.5]" />
              </div>
              <div className="text-left min-w-0">
                <div className="text-[9px] font-bold text-white tracking-wide truncate">Secure Data</div>
                <div className="text-[7px] text-slate-400 truncate mt-0.5">End-to-end encryption</div>
              </div>
            </div>

            {/* Floating Card 3: Tax Compliant (Top Right) */}
            <div className="absolute right-[10px] top-[50px] bg-[#0b1329]/80 backdrop-blur-md border border-blue-900/50 rounded-xl p-2.5 flex items-center gap-2.5 shadow-lg w-38 z-30 animate-[float-delayed_5s_ease-in-out_infinite] transform hover:scale-105 transition-transform duration-300">
              <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20 shrink-0">
                <ShieldCheck size={13} className="stroke-[2.5]" />
              </div>
              <div className="text-left min-w-0">
                <div className="text-[9px] font-bold text-white tracking-wide truncate">Tax Compliant</div>
                <div className="text-[7px] text-slate-400 truncate mt-0.5">Stay compliant, stay confident</div>
              </div>
            </div>

            {/* Floating Card 4: Real-time Export (Bottom Right) */}
            <div className="absolute right-[-10px] bottom-[70px] bg-[#0b1329]/80 backdrop-blur-md border border-blue-900/50 rounded-xl p-2.5 flex items-center gap-2.5 shadow-lg w-40 z-30 animate-[float_6.5s_ease-in-out_infinite] transform hover:scale-105 transition-transform duration-300">
              <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20 shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 2v16M19 11l-7 7-7-7M22 22H2" />
                </svg>
              </div>
              <div className="text-left min-w-0">
                <div className="text-[9px] font-bold text-white tracking-wide truncate">Real-time Export</div>
                <div className="text-[7px] text-slate-400 truncate mt-0.5">ETA export operations</div>
              </div>
            </div>
          </div>

          {/* Bottom pills info */}
          <div className="relative z-10 flex gap-3 justify-center lg:justify-start flex-wrap mt-auto pt-6 border-t border-slate-900/30">
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-blue-955 bg-blue-950/20 backdrop-blur-sm">
              <ShieldCheck size={12} className="text-blue-400" />
              <span className="text-[10px] text-slate-300 font-semibold">Secure: <span className="text-slate-400 font-medium">Your data is protected</span></span>
            </div>
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-blue-955 bg-blue-950/20 backdrop-blur-sm">
              <CheckCircle2 size={12} className="text-blue-400" />
              <span className="text-[10px] text-slate-300 font-semibold">Compliant: <span className="text-slate-400 font-medium">Always audit-ready</span></span>
            </div>
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-blue-955 bg-blue-950/20 backdrop-blur-sm">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-blue-400">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span className="text-[10px] text-slate-300 font-semibold">Real-time: <span className="text-slate-400 font-medium">Instant operations</span></span>
            </div>
          </div>

        </div>

        {/* RIGHT PANEL (Sign-In Form Card with Rotating Neon Border) */}
        <div className="w-full lg:w-[460px] relative p-[1.5px] rounded-[32px] overflow-hidden shadow-[0_20px_50px_rgba(59,130,246,0.15)] flex flex-col justify-center">
          
          {/* Rotating border light layer */}
          <div className="absolute inset-[-200%] bg-[conic-gradient(from_0deg,transparent_30%,#3b82f6_45%,#6366f1_55%,transparent_70%)] animate-[spin_4s_linear_infinite] pointer-events-none" />
          
          {/* Main Card Content (Solid dark background inside to overlay the gradient) */}
          <div className="relative w-full h-full bg-[#0b1329] backdrop-blur-xl p-8 lg:p-10 rounded-[31.5px] flex flex-col gap-6">

            <div className="text-center space-y-2">
              <div className="flex justify-center mb-3">
                <OTaxLogo />
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight">{t('login.welcome') || 'Welcome back'}</h2>
              <p className="text-slate-400 text-xs leading-relaxed px-4">
                {t('login.subtitle') || 'Sign in to access your OTax dashboard, invoices, and ETA export operations.'}
              </p>
            </div>

            {error && (
              <div className="p-3.5 bg-rose-950/40 border border-rose-500/30 rounded-xl text-rose-400 text-xs font-bold flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              
              {/* Email field */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                  {t('login.email') || 'Email address'}
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t('login.emailPh') || 'you@company.com'}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-blue-900/50 bg-[#0d172e]/80 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-[#0d172e] transition-all text-white font-medium placeholder-slate-600"
                  />
                </div>
              </div>

              {/* Password field */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                  {t('login.password') || 'Password'}
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-blue-900/50 bg-[#0d172e]/80 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-[#0d172e] transition-all text-white placeholder-slate-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* 2FA Field */}
              {twoFaRequired && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                    {t('login.tfaLabel') || '2FA Authentication Code'}
                  </label>
                  <input
                    type="text"
                    maxLength={12}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/[^0-9A-Za-z\-]/g, '').toUpperCase())}
                    placeholder={t('login.tfaPh') || '000000'}
                    autoFocus
                    className="w-full py-2.5 rounded-xl border border-blue-900/50 bg-[#0d172e]/80 text-center text-lg font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-white placeholder-slate-600"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    {t('login.tfaHint') || 'Enter the code from your authenticator application'}
                  </p>
                </div>
              )}

              {/* Checkbox and Forgot Password */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input 
                    type="checkbox" 
                    id="remember" 
                    className="w-4 h-4 rounded border-blue-900/50 bg-[#0d172e] text-blue-600 focus:ring-blue-500/20 focus:ring-offset-0 transition-all" 
                  />
                  <span className="text-xs font-semibold text-slate-400">{t('login.remember') || 'Remember me'}</span>
                </label>
                <Link to="/forgot-password" className="text-xs font-bold text-blue-500 hover:text-blue-400 hover:underline">
                  {t('login.forgot') || 'Forgot password?'}
                </Link>
              </div>

              {/* Action Buttons */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading || (twoFaRequired && totpCode.length < 6)}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm shadow-[0_4px_25px_rgba(37,99,235,0.4)] transition-all flex items-center justify-center gap-2 disabled:opacity-70 active:scale-[0.98] cursor-pointer"
                >
                  <LogIn size={16} />
                  {isLoading ? (t('login.signing') || 'Signing in...') : (t('login.signIn') || 'Sign In')}
                </button>
              </div>

            </form>

            {/* Separator */}
            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-blue-950/60"></div>
              <span className="flex-shrink mx-4 text-xs font-semibold text-slate-500 uppercase">or</span>
              <div className="flex-grow border-t border-blue-950/60"></div>
            </div>

            {/* Create Account button replacing Microsoft login */}
            <button
              type="button"
              onClick={() => navigate('/signup')}
              className="w-full py-3 rounded-xl border border-blue-500/30 bg-blue-955/20 hover:bg-blue-900/30 text-blue-400 hover:text-blue-300 font-bold text-sm transition-all flex items-center justify-center active:scale-[0.98] cursor-pointer"
            >
              {t('login.createAccount') || 'Create Account'}
            </button>

            {/* Footer information */}
            <div className="mt-2 text-center space-y-3">
              <p className="text-[11px] font-semibold text-slate-500">
                Secure access for finance, tax, and operations teams.
              </p>
              <div className="flex items-center justify-center text-xs font-medium">
                <a href="mailto:support@operativestech.com" className="text-slate-400 hover:text-white transition-colors flex items-center gap-1">
                  Need help? <span className="text-blue-500 font-bold hover:underline">Contact support</span>
                </a>
              </div>
            </div>

          </div>

      </div>
    </div>
  );
};

export default Login;
