
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, Lock, User as UserIcon, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { User } from '../types';
import { apiService } from '../services/apiService';
import { useTranslation } from '../i18n';

interface LoginProps {
  onLogin: (user: User) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 2FA flow: when the server says 2FA is required, we keep username+password in
  // state and switch the form to a code-entry view. The user types the 6-digit
  // TOTP and we re-submit with `totpCode` set.
  const [twoFaRequired, setTwoFaRequired] = useState(false);
  const [totpCode, setTotpCode] = useState('');


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const data = await apiService.login(username, password, twoFaRequired ? totpCode : undefined);
      if (data.success) {
        // Determine display role
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

        // Store organization name as company name
        if (data.user.organization?.name) {
          localStorage.setItem('company_name', data.user.organization.name);
        }

        // Super admin → go directly to platform management
        if (data.user.isSuperAdmin) {
          navigate('/super-admin');
        } else {
          // Check if user has completed initial ETA setup
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
      // 2FA pivot: server signalled the password was right but a code is needed.
      // Switch to code-entry mode and surface the message inline.
      if (err.twoFactorRequired) {
        setTwoFaRequired(true);
        // Don't echo "Two-factor code required" if this was the very first request.
        // If we were already in 2FA mode and this came back, the message is "Invalid code" — show it.
        setError(twoFaRequired ? (err.message || t('login.errInvalidCode')) : null);
        setTotpCode('');
      } else {
        setError(err.message || t('login.errConn'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Custom colors derived from user CSS
  const brandPrimary = 'rgb(0,148,218)';

  return (
    <div className="min-h-screen w-full font-['Inter'] flex p-2 sm:p-4 lg:p-6 overflow-y-auto transition-all duration-300" style={{ background: `radial-gradient(circle at top left, rgba(0,148,218,0.15), #020617 60%)` }}>

      <div className="flex flex-col lg:flex-row w-full max-w-[1000px] rounded-[20px] overflow-hidden shadow-[0_40px_80px_rgba(0,0,0,0.35)] bg-transparent transition-all duration-300 m-auto">

        {/* LEFT CARD */}
        <div className="w-full lg:w-[380px] bg-white p-6 md:p-8 flex flex-col justify-center shrink-0 border-b lg:border-b-0 lg:border-r border-slate-100">

          <div className="font-bold text-lg mb-2" style={{ color: brandPrimary }}>OTax</div>

          <h1 className="text-xl md:text-2xl font-normal mb-1" style={{ color: brandPrimary }}>{t('login.welcome')}</h1>
          <p className="text-slate-500 mb-5 text-sm">{t('login.subtitle')}</p>

          <form onSubmit={handleSubmit}>
            {error && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-xs font-bold animate-pulse">
                {error}
              </div>
            )}

            <div className="mb-3">
              <label className="text-xs text-slate-500 font-medium block mb-1.5">{t('login.email')}</label>
              <div className="relative">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('login.emailPh')}
                  className="w-full p-2.5 pl-4 rounded-[10px] border border-gray-200 bg-[#F9FAFB] text-sm focus:outline-none focus:ring-[3px] focus:ring-[#0094da]/15 focus:border-[#0094da] transition-all"
                />
              </div>
            </div>

            <div className="mb-3">
              <div className="flex justify-between mb-1.5">
                <label className="text-xs text-slate-500 font-medium">{t('login.password')}</label>
                <Link to="/forgot-password" className="text-xs no-underline font-medium hover:underline" style={{ color: brandPrimary }}>{t('login.forgot')}</Link>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  className="w-full p-2.5 pl-4 pr-10 rounded-[10px] border border-gray-200 bg-[#F9FAFB] text-sm focus:outline-none focus:ring-[3px] focus:ring-[#0094da]/15 focus:border-[#0094da] transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* 2FA prompt — appears only after the server tells us the user has 2FA on.
                Accepts EITHER a 6-digit TOTP from the authenticator app OR a 10-char
                XXXXX-XXXXX backup code, so a user who lost their phone can still get in. */}
            {twoFaRequired && (
              <div className="mb-3">
                <label className="text-xs text-slate-500 font-medium flex items-center gap-1 mb-1.5">
                  <ShieldCheck size={12} className="text-violet-600" /> {t('login.tfaLabel')}
                </label>
                <input
                  type="text"
                  maxLength={12}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/[^0-9A-Za-z\-]/g, '').toUpperCase())}
                  placeholder={t('login.tfaPh')}
                  autoFocus
                  className="w-full p-2.5 pl-4 rounded-[10px] border-2 border-violet-300 bg-violet-50/30 text-center text-lg font-mono tracking-widest focus:outline-none focus:ring-[3px] focus:ring-violet-300 focus:border-violet-500 transition-all"
                />
                <p className="text-[10px] text-violet-700 mt-1">{t('login.tfaHint')}</p>
              </div>
            )}

            <div className="flex items-center gap-2 mb-4">
              <input type="checkbox" id="remember" className="w-3.5 h-3.5 rounded border-gray-300 text-[#0094da] focus:ring-[#0094da]" />
              <label htmlFor="remember" className="text-xs text-slate-600 cursor-pointer">{t('login.remember')}</label>
            </div>

            <button
              type="submit"
              disabled={isLoading || (twoFaRequired && totpCode.length < 6)}
              className="w-full p-2.5 rounded-xl border-none text-white font-semibold cursor-pointer transition-transform hover:-translate-y-[1px] shadow-sm hover:shadow-[0_12px_30px_rgba(0,148,218,0.35)] flex items-center justify-center gap-2 disabled:opacity-70 text-sm"
              style={{ background: `linear-gradient(135deg, ${brandPrimary}, rgb(0,110,165))` }}
            >
              {isLoading
                ? t('login.signing')
                : twoFaRequired
                  ? <>{t('login.verify')} <ArrowRight size={16} /></>
                  : <>{t('login.signIn')} <ArrowRight size={16} /></>}
            </button>

            <div className="mt-4 text-center space-y-1">
              <p className="text-xs text-slate-500">{t('login.newToOtax')}</p>
              <button
                type="button"
                onClick={() => navigate('/signup')}
                className="text-sm font-bold text-[#0094da] hover:underline bg-transparent border-none cursor-pointer"
              >
                {t('login.createAccount')}
              </button>
              <p className="text-xs text-slate-400">
                {t('login.haveCode')} <Link to="/join-org" className="font-semibold text-[#0094da] hover:underline no-underline">{t('login.joinOrg')}</Link>
              </p>
            </div>
          </form>

          <div className="mt-5 flex gap-1.5 flex-wrap">
            {['SSL', 'AES-256', 'ETA-CERT'].map((badge) => (
              <span key={badge} className="text-[10px] py-1 px-2 rounded-lg border font-medium whitespace-nowrap" style={{ color: brandPrimary, borderColor: 'rgba(0,148,218,0.3)', background: 'rgba(0,148,218,0.08)' }}>
                {badge}
              </span>
            ))}
          </div>
        </div>

        {/* RIGHT CARD */}
        <div className="flex-1 p-6 md:p-8 text-[#E6F6FF] relative overflow-hidden flex flex-col justify-center min-h-[400px] lg:min-h-auto" style={{ background: `radial-gradient(circle at top right, rgba(0,148,218,0.35), rgba(2,6,23,0.95) 60%)`, backdropFilter: 'blur(14px)' }}>

          <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]" />

          <div className="relative z-10 max-w-[440px] mx-auto lg:mx-0">
            <span className="inline-block py-1 px-3 rounded-full text-[10px] border font-medium mb-4" style={{ borderColor: 'rgba(0,148,218,0.4)', background: 'rgba(0,148,218,0.15)', color: brandPrimary }}>
              {t('login.heroTagline')}
            </span>

            <h2 className="text-[32px] font-extrabold leading-[1.1] mb-6 text-white">
              {t('login.heroTitle1')} <span style={{ color: brandPrimary }}>{t('login.heroTitle2')}</span><br />
              {t('login.heroTitle3')} <span style={{ color: brandPrimary }}>{t('login.heroTitle4')}</span>.
            </h2>

            <div className="space-y-3">
              {[
                { title: t('login.feat1Title'), desc: t('login.feat1Desc'), icon: '⚡' },
                { title: t('login.feat2Title'), desc: t('login.feat2Desc'), icon: '🛡' },
                { title: t('login.feat3Title'), desc: t('login.feat3Desc'), icon: '∞' }
              ].map((feat, i) => (
                <div key={i} className="flex gap-3 p-3 rounded-[12px] border transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_40px_rgba(0,148,218,0.25)] group" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))', borderColor: 'rgba(0,148,218,0.25)' }}>
                  <div className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-base shrink-0" style={{ background: 'rgba(0,148,218,0.15)' }}>
                    {feat.icon}
                  </div>
                  <div>
                    <div className="font-bold text-white text-sm mb-0.5">{feat.title}</div>
                    <div className="text-[12px] opacity-85 leading-relaxed">{feat.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 text-[12px] opacity-75 font-medium">
              {t('login.trustedBy')}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};

export default Login;
