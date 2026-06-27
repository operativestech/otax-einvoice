import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ShieldCheck, Shield, Check, ArrowRight, LogIn, LockKeyhole, HelpCircle, CheckCircle2 } from 'lucide-react';
import { User } from '../types';
import { apiService } from '../services/apiService';
import { useTranslation } from '../i18n';

interface LoginProps {
  onLogin: (user: User) => void;
}

const OTaxLogo: React.FC<{ light?: boolean }> = ({ light }) => (
  <div className="flex items-center gap-2">
    <div className="relative w-8 h-8 flex-shrink-0">
      <svg viewBox="0 0 24 24" fill="none" className="w-full h-full drop-shadow-md">
        <path d="M12 2L3.5 7V17L12 22L20.5 17V7L12 2Z" fill="url(#hex-gradient-login)" />
        <path d="M12 6.5L6.5 9.7V14.3L12 17.5L17.5 14.3V9.7L12 6.5Z" fill="white" fillOpacity="0.15" />
        <path d="M12 8.5L8.5 10.5V13.5L12 15.5L15.5 13.5V10.5L12 8.5Z" fill="white" />
        <defs>
          <linearGradient id="hex-gradient-login" x1="3.5" y1="2" x2="20.5" y2="22" gradientUnits="userSpaceOnUse">
            <stop stopColor="#60a5fa" />
            <stop offset="1" stopColor="#2563eb" />
          </linearGradient>
        </defs>
      </svg>
    </div>
    <span className={`text-xl font-bold tracking-tight ${light ? 'text-white' : 'text-slate-900'}`}>OTax</span>
  </div>
);

const MicrosoftIcon = () => (
  <div className="grid grid-cols-2 gap-[2px] w-4 h-4 mr-2">
    <div className="bg-[#f25022] w-[7px] h-[7px]"></div>
    <div className="bg-[#7fba00] w-[7px] h-[7px]"></div>
    <div className="bg-[#00a4ef] w-[7px] h-[7px]"></div>
    <div className="bg-[#ffb900] w-[7px] h-[7px]"></div>
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
    <div className="min-h-screen w-full font-sans flex items-center justify-center p-4 bg-slate-50 relative overflow-hidden">
      {/* Decorative blurred background shapes */}
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-blue-400/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-400/10 blur-[120px] pointer-events-none" />

      {/* Main glassmorphism container */}
      <div className="flex flex-col lg:flex-row w-full max-w-[1040px] rounded-[32px] overflow-hidden border border-white/60 bg-white/70 backdrop-blur-md shadow-glass m-auto relative z-10 min-h-[640px]">
        
        {/* LEFT PANEL (Mockup Graphic & Info) */}
        <div className="w-full lg:w-[48%] p-8 lg:p-12 text-white flex flex-col justify-between relative overflow-hidden" 
             style={{ background: 'radial-gradient(circle at 80% 20%, #1e40af, #0f172a 75%)' }}>
          
          {/* Subtle grid pattern overlay */}
          <div className="absolute inset-0 opacity-10 bg-[linear-gradient(to_right,#ffffff1a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff1a_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />

          {/* Glowing orb behind central graphic */}
          <div className="absolute top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full bg-blue-500/20 blur-[80px] pointer-events-none animate-pulse" />

          {/* Logo */}
          <div className="relative z-10">
            <OTaxLogo light />
          </div>

          {/* Core titles */}
          <div className="relative z-10 my-8">
            <h2 className="text-3xl lg:text-[34px] font-extrabold leading-tight tracking-tight text-white mb-3">
              Smart tax operations.<br />
              <span className="text-blue-400">Seamless e-invoicing.</span>
            </h2>
            <p className="text-slate-300 text-sm font-medium leading-relaxed max-w-sm">
              OTax empowers finance and tax teams to comply, export, and grow with confidence.
            </p>
          </div>

          {/* Central floating 3D graphic mockup */}
          <div className="relative z-10 flex-1 flex items-center justify-center py-6">
            <div className="relative w-64 h-64 flex items-center justify-center">
              
              {/* Circular base grid lines */}
              <div className="absolute inset-0 rounded-full border-2 border-dashed border-blue-500/10 scale-95 animate-[spin_60s_linear_infinite]" />
              <div className="absolute inset-4 rounded-full border border-blue-500/20 scale-90" />
              
              {/* Glowing base ring */}
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-48 h-8 rounded-full bg-blue-500/30 blur-md border border-blue-400/40 transform scale-y-[0.3]" />
              <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-40 h-6 rounded-full bg-blue-400/40 blur-sm transform scale-y-[0.3]" />

              {/* Main Floating E-Invoice Document */}
              <div className="absolute bg-white/95 backdrop-blur-md rounded-2xl p-4 shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-white/20 w-44 transform -translate-y-4 hover:translate-y-[-20px] transition-transform duration-500 z-20 flex flex-col gap-2">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-[10px] font-bold text-slate-800 tracking-wider">E-INVOICE</span>
                  <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white">
                    <Check size={10} className="stroke-[3]" />
                  </div>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full" />
                <div className="w-3/4 h-2 bg-slate-100 rounded-full" />
                <div className="w-1/2 h-2 bg-slate-100 rounded-full" />
                <div className="mt-2 flex items-center justify-between">
                  <div className="w-10 h-3 bg-blue-100 rounded" />
                  <span className="text-[9px] font-bold text-slate-400">#E-0842</span>
                </div>
              </div>

              {/* Floating Card 1: Secure Data (Left) */}
              <div className="absolute left-[-20px] top-[20%] bg-white/10 backdrop-blur-md border border-white/15 rounded-xl px-3 py-2 flex items-center gap-2 shadow-lg animate-[bounce_4s_ease-in-out_infinite] z-30">
                <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-300">
                  <Lock size={14} className="stroke-[2.5]" />
                </div>
                <div className="text-left">
                  <div className="text-[9px] font-bold text-white tracking-wide">Secure Data</div>
                  <div className="text-[7px] text-slate-300">AES-256 Encrypted</div>
                </div>
              </div>

              {/* Floating Card 2: Tax Compliant (Right) */}
              <div className="absolute right-[-15px] top-[30%] bg-white/10 backdrop-blur-md border border-white/15 rounded-xl px-3 py-2 flex items-center gap-2 shadow-lg animate-[bounce_4s_ease-in-out_infinite_1s] z-30">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-300">
                  <ShieldCheck size={14} className="stroke-[2.5]" />
                </div>
                <div className="text-left">
                  <div className="text-[9px] font-bold text-white tracking-wide">Tax Compliant</div>
                  <div className="text-[7px] text-slate-300">ETA Approved</div>
                </div>
              </div>

              {/* Floating Card 3: Real-time (Bottom-Right) */}
              <div className="absolute right-[10px] bottom-[15%] bg-white/10 backdrop-blur-md border border-white/15 rounded-xl px-3 py-2 flex items-center gap-2 shadow-lg animate-[bounce_4s_ease-in-out_infinite_2s] z-30">
                <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-300">
                  <CheckCircle2 size={14} className="stroke-[2.5]" />
                </div>
                <div className="text-left">
                  <div className="text-[9px] font-bold text-white tracking-wide">Real-time</div>
                  <div className="text-[7px] text-slate-300">Instant Sync</div>
                </div>
              </div>

            </div>
          </div>

          {/* Bottom pills info */}
          <div className="relative z-10 flex gap-2 justify-center lg:justify-start flex-wrap mt-auto">
            {['Secure', 'Compliant', 'Real-time'].map((badge) => (
              <span key={badge} className="text-[10px] py-1 px-3.5 rounded-full border border-white/20 bg-white/10 text-white font-semibold backdrop-blur-sm">
                {badge}
              </span>
            ))}
          </div>

        </div>

        {/* RIGHT PANEL (Sign-In Form) */}
        <div className="flex-1 p-8 lg:p-12 bg-white flex flex-col justify-between">
          
          {/* Logo show on mobile / top */}
          <div className="flex justify-between items-center mb-8 lg:mb-4">
            <div className="lg:hidden">
              <OTaxLogo />
            </div>
          </div>

          <div className="max-w-[420px] w-full mx-auto my-auto space-y-6">
            
            {/* Header info */}
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('login.welcome') || 'Welcome back'}</h1>
              <p className="text-slate-500 text-sm mt-2">
                {t('login.subtitle') || 'Sign in to access your OTax dashboard, invoices, and ETA export operations.'}
              </p>
            </div>

            {error && (
              <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-xs font-bold flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              
              {/* Email field */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block">{t('login.email') || 'Email address'}</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t('login.emailPh') || 'you@company.com'}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all text-slate-800 font-medium"
                  />
                </div>
              </div>

              {/* Password field */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block">{t('login.password') || 'Password'}</label>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* 2FA Field */}
              {twoFaRequired && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide block">{t('login.tfaLabel') || '2FA Authentication Code'}</label>
                  <input
                    type="text"
                    maxLength={12}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/[^0-9A-Za-z\-]/g, '').toUpperCase())}
                    placeholder={t('login.tfaPh') || '000000'}
                    autoFocus
                    className="w-full py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-center text-lg font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-slate-800"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">{t('login.tfaHint') || 'Enter the code from your authenticator application'}</p>
                </div>
              )}

              {/* Checkbox and Forgot Password */}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" id="remember" className="w-4.5 h-4.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500/20 transition-all" />
                  <span className="text-xs font-semibold text-slate-600">{t('login.remember') || 'Remember me'}</span>
                </label>
                <Link to="/forgot-password" className="text-xs font-bold text-blue-600 hover:underline">{t('login.forgot') || 'Forgot password?'}</Link>
              </div>

              {/* Action Buttons */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading || (twoFaRequired && totpCode.length < 6)}
                  className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-sm hover:shadow-[0_8px_20px_rgba(37,99,235,0.3)] transition-all flex items-center justify-center gap-2 disabled:opacity-70 active:scale-[0.98]"
                >
                  <LogIn size={16} />
                  {isLoading ? (t('login.signing') || 'Signing in...') : (t('login.signIn') || 'Sign In')}
                </button>
              </div>

            </form>

            {/* Separator */}
            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-slate-200"></div>
              <span className="flex-shrink mx-4 text-xs font-semibold text-slate-400 uppercase">or</span>
              <div className="flex-grow border-t border-slate-200"></div>
            </div>

            {/* SSO / Microsoft login */}
            <button
              type="button"
              className="w-full py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-sm shadow-sm transition-all flex items-center justify-center active:scale-[0.98]"
            >
              <MicrosoftIcon />
              Sign in with Microsoft
            </button>

          </div>

          {/* Footer information */}
          <div className="mt-8 text-center space-y-3">
            <p className="text-xs font-semibold text-slate-400">
              Secure access for finance, tax, and operations teams.
            </p>
            <div className="flex items-center justify-center gap-4 text-xs text-slate-500 font-medium">
              <a href="mailto:support@operativestech.com" className="hover:underline flex items-center gap-1">
                Need help? Contact support
              </a>
              <span>•</span>
              <button onClick={() => navigate('/signup')} className="hover:underline font-bold text-blue-600">
                {t('login.createAccount') || 'Create account'}
              </button>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};

export default Login;
