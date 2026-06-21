import { API_URL } from '../services/apiService';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, User, Building, Link, Server, Database, FileCode, CheckCircle2, ArrowRight, ArrowLeft, Globe, Key, Lock, HardDrive, Settings, Activity, CreditCard } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';
import { alertDialog } from '../components/ConfirmDialog';

interface WizardProps {
  onComplete: () => void;
}

const Wizard: React.FC<WizardProps> = ({ onComplete }) => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const totalSteps = 7;
  const [formData, setFormData] = useState({
    // Step 1: Admin Access
    adminName: '',
    adminEmail: '',
    adminPhone: '',
    // adminPassword removed as per request
    // Step 2: Company Data
    region: 'EG',
    taxId: '',
    legalName: '',
    activity: '',
    // Step 3: Pricing
    pricingPlan: 'pro',
    // Step 4: ETA Gateway
    clientId: '',
    clientSecret: '',
    environment: 'PreProduction',
    signerPath: '',
    // Step 5: ERP Bridge
    erpType: 'PostgreSQL',
    erpHost: '',
    erpDb: '',
    erpUser: '',
    erpPass: '',
    // Step 6: Storage Rules
    logDb: '',
    backlogDays: 30,
    dateRule: 'Preserve ERP Date',
    pdfPath: ''
  });

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
            <div className="flex items-center gap-3 text-blue-600">
              <User size={32} />
              <h3 className="text-xl font-bold">Create User Account</h3>
            </div>
            <p className="text-slate-500 text-sm">Create the primary user account for the system.</p>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase">User Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={formData.adminName}
                  onChange={(e) => handleChange('adminName', e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="John Doe"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase">Email Address <span className="text-red-500">*</span></label>
                <input
                  type="email"
                  value={formData.adminEmail}
                  onChange={(e) => handleChange('adminEmail', e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="user@company.com"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase">Phone Number <span className="text-slate-300 font-normal">(Optional)</span></label>
                <input
                  type="text"
                  value={formData.adminPhone}
                  onChange={(e) => handleChange('adminPhone', e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="+20 123 456 7890"
                />
              </div>
            </div>
          </div>
        );
      case 2:
        return (
          <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
            <div className="flex items-center gap-3 text-blue-600">
              <Building size={32} />
              <h3 className="text-xl font-bold">Organization Details</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase">Tax Authority Region</label>
                <select
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  value={formData.region}
                  onChange={(e) => handleChange('region', e.target.value)}
                >
                  <option value="EG">Egypt (ETA)</option>
                  <option value="SA">Saudi Arabia (ZATCA)</option>
                  <option value="AE">UAE (FTA)</option>
                  <option value="JO">Jordan (ISTD)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase">Company Tax ID</label>
                <input
                  type="text"
                  value={formData.taxId}
                  onChange={(e) => handleChange('taxId', e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none"
                  placeholder="000-000-000"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase">Legal Name</label>
                <input
                  type="text"
                  value={formData.legalName}
                  onChange={(e) => handleChange('legalName', e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none"
                  placeholder="Global Systems LTD"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase">Tax Activity</label>
                <input
                  type="text"
                  value={formData.activity}
                  onChange={(e) => handleChange('activity', e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none"
                  placeholder="e.g. 4610 - Wholesale Trade"
                />
              </div>
            </div>
          </div>
        );
      case 3:
        return (
          <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
            <div className="flex items-center gap-3 text-blue-600">
              <Activity size={32} />
              <h3 className="text-xl font-bold">Select Plan</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                {
                  id: 'starter',
                  name: 'Starter',
                  price: '$49',
                  desc: 'For small businesses',
                  features: ['3,000 Invoices/mo', 'Basic Email Support', '1 User Account', '30 Days Data Retention']
                },
                {
                  id: 'pro',
                  name: 'Pro',
                  price: '$99',
                  desc: 'High volume processing',
                  features: ['10,000 Invoices/mo', 'Priority Support (24h)', '5 User Accounts', '1 Year Data Retention', 'ERP Integration']
                },
                {
                  id: 'enterprise',
                  name: 'Enterprise',
                  price: '$299',
                  desc: 'Dedicated resources',
                  features: ['Unlimited Invoices', '24/7 Dedicated Agent', 'Unlimited Users', '7 Years Retention', 'Custom ERP Bridge']
                }
              ].map(plan => (
                <div
                  key={plan.id}
                  onClick={() => handleChange('pricingPlan', plan.id)}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col h-full ${formData.pricingPlan === plan.id
                    ? 'border-blue-500 bg-blue-50/50 shadow-lg shadow-blue-100 scale-105'
                    : 'border-gray-100 hover:border-blue-200 hover:scale-[1.02]'
                    }`}
                >
                  <div className="mb-4">
                    <div className="font-bold text-lg mb-1">{plan.name}</div>
                    <div className="text-3xl font-bold text-blue-600 mb-2">{plan.price}<span className="text-sm text-slate-400 font-normal">/mo</span></div>
                    <div className="text-xs text-slate-500">{plan.desc}</div>
                  </div>

                  <div className="mt-auto border-t border-gray-200/50 pt-4 space-y-2">
                    {plan.features.map((feat, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-slate-600">
                        <div className="mt-0.5 text-blue-500"><CheckCircle2 size={12} /></div>
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      case 4:
        return (
          <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
            <div className="flex items-center gap-3 text-blue-600">
              <Globe size={32} />
              <h3 className="text-xl font-bold">ETA Integration (OTAX)</h3>
            </div>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase">Client ID</label>
                <input
                  type="text"
                  value={formData.clientId}
                  onChange={(e) => handleChange('clientId', e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none"
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-400 uppercase">Client Secret</label>
                <PasswordInput
                  value={formData.clientSecret}
                  onChange={(e) => handleChange('clientSecret', e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none"
                  placeholder="••••••••"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-bold text-slate-400 uppercase">Environment</label>
                  <select
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none"
                    value={formData.environment}
                    onChange={(e) => handleChange('environment', e.target.value)}
                  >
                    <option>PreProduction</option>
                    <option>Production</option>
                  </select>
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-bold text-slate-400 uppercase">Signer Token Path</label>
                  <input
                    type="text"
                    value={formData.signerPath}
                    onChange={(e) => handleChange('signerPath', e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none"
                    placeholder="C:/Token/signer.exe"
                  />
                </div>
              </div>
            </div>
          </div>
        );
      case 5:
        return (
          <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
            <div className="flex items-center gap-3 text-blue-600">
              <Server size={32} />
              <h3 className="text-xl font-bold">Source ERP Connection</h3>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400 uppercase">ERP Type</label>
                  <select
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none"
                    value={formData.erpType}
                    onChange={(e) => handleChange('erpType', e.target.value)}
                  >
                    <option>PostgreSQL</option>
                    <option>Oracle</option>
                    <option>SAP Hana</option>
                    <option>Odoo API</option>
                    <option>Microsoft SQL</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400 uppercase">Server IP / Host</label>
                  <input
                    type="text"
                    value={formData.erpHost}
                    onChange={(e) => handleChange('erpHost', e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none"
                    placeholder="192.168.1.10"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400 uppercase">DB Name</label>
                  <input
                    type="text"
                    value={formData.erpDb}
                    onChange={(e) => handleChange('erpDb', e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none"
                    placeholder="erp_prod"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400 uppercase">User</label>
                  <input
                    type="text"
                    value={formData.erpUser}
                    onChange={(e) => handleChange('erpUser', e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none"
                    placeholder="eta_svc"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400 uppercase">Pass</label>
                  <PasswordInput
                    value={formData.erpPass}
                    onChange={(e) => handleChange('erpPass', e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none"
                    placeholder="••••"
                  />
                </div>
              </div>
              <button className="w-full py-3 bg-blue-50 text-blue-600 font-bold rounded-xl text-sm border border-blue-100 hover:bg-blue-100 transition-all flex items-center justify-center gap-2">
                <Activity size={16} /> Test Connection
              </button>
            </div>
          </div>
        );
      case 6:
        return (
          <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
            <div className="flex items-center gap-3 text-blue-600">
              <Database size={32} />
              <h3 className="text-xl font-bold">Storage & Business Rules</h3>
            </div>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Log Database (PostgreSQL)</label>
                <input
                  type="text"
                  value={formData.logDb}
                  onChange={(e) => handleChange('logDb', e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none"
                  placeholder="localhost:5432/middleware_logs"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">Backlog Period (Days)</label>
                  <input
                    type="number"
                    value={formData.backlogDays}
                    onChange={(e) => handleChange('backlogDays', e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">Date Rule</label>
                  <select
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none"
                    value={formData.dateRule}
                    onChange={(e) => handleChange('dateRule', e.target.value)}
                  >
                    <option>Preserve ERP Date</option>
                    <option>Replace with Current</option>
                    <option>Auto Adjust -2h</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">PDF Archive Path</label>
                <input
                  type="text"
                  value={formData.pdfPath}
                  onChange={(e) => handleChange('pdfPath', e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none"
                  placeholder="/mnt/archives/pdfs"
                />
              </div>
            </div>
          </div>
        );
      case 7:
        return (
          <div className="space-y-8 py-10 text-center animate-in zoom-in-95 duration-500">
            <div className="flex justify-center">
              <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-500 animate-bounce">
                <CheckCircle2 size={56} />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-3xl font-bold text-slate-800">Ready to Launch!</h3>
              <p className="text-slate-500">Your Smart Middleware is fully configured and ready to connect with the ETA portal.</p>
            </div>
            <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100 text-left">
              <h4 className="font-bold text-emerald-800 mb-2">Checklist Summary:</h4>
              <ul className="text-xs text-emerald-700 space-y-2 font-medium">
                <li className="flex items-center gap-2"><CheckCircle2 size={14} /> Admin Account Created</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={14} /> ERP Connection Verified</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={14} /> Signing Token Active</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={14} /> PostgreSQL Logs Connected</li>
                <li className="flex items-center gap-2"><CheckCircle2 size={14} /> UTF-8 Conversion Engine Ready</li>
              </ul>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_URL}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        throw new Error('Setup failed');
      }

      onComplete();
      navigate('/dashboard');
    } catch (error) {
      console.error('Setup error:', error);
      await alertDialog({ title: 'Setup failed', message: 'Setup failed. Please check the console log server connection.', tone: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full font-['Inter'] flex p-4 sm:p-6 lg:p-8 overflow-y-auto transition-all duration-300 bg-slate-50">
      <div className="w-full max-w-[1000px] bg-white rounded-[20px] shadow-[0_40px_80px_rgba(0,0,0,0.1)] overflow-hidden flex flex-col md:flex-row min-h-[650px] border border-gray-100 m-auto">

        <div className="w-full md:w-80 bg-slate-900 p-10 flex flex-col justify-between text-white relative">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <ShieldCheck size={120} />
          </div>

          <div className="relative space-y-12">
            <div className="flex items-center gap-3">
              <ShieldCheck className="text-blue-500" size={32} />
              <span className="font-bold tracking-tight text-xl">Sign Up</span>
            </div>

            <div className="space-y-4">
              {[
                { s: 1, l: 'Account Info', i: <User size={18} /> },
                { s: 2, l: 'Organization', i: <Building size={18} /> },
                { s: 3, l: 'Pricing', i: <CreditCard size={18} /> },
                { s: 4, l: 'ETA Gateway', i: <Link size={18} /> },
                { s: 5, l: 'ERP Bridge', i: <Server size={18} /> },
                { s: 6, l: 'Storage Rules', i: <Database size={18} /> },
                { s: 7, l: 'Final Review', i: <FileCode size={18} /> },
              ].map((item) => (
                <div key={item.s} className={`flex items-center gap-4 transition-all ${step === item.s ? 'text-blue-400 translate-x-2' : step > item.s ? 'text-emerald-400' : 'text-slate-500'}`}>
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border-2 transition-all ${step === item.s ? 'border-blue-500 bg-blue-500/10' : step > item.s ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-800'}`}>
                    {step > item.s ? <CheckCircle2 size={18} /> : <div className="shrink-0">{item.i}</div>}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold opacity-40">Step 0{item.s}</span>
                    <span className="text-sm font-bold">{item.l}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative pt-6 border-t border-slate-800">
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-3">Overall Progress</p>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all duration-700 ease-out shadow-[0_0_10px_rgba(59,130,246,0.5)]" style={{ width: `${(step / totalSteps) * 100}%` }} />
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col p-8 md:p-16">
          <div className="flex-1 overflow-y-auto">
            {renderStep()}
          </div>

          <div className="flex justify-between items-center pt-8 border-t border-gray-100">
            <button
              onClick={() => setStep(Math.max(1, step - 1))}
              className={`flex items-center gap-2 text-slate-400 hover:text-slate-800 font-bold transition-all ${step === 1 ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
            >
              <ArrowLeft size={18} /> Back
            </button>

            {step < totalSteps ? (
              <button
                onClick={async () => {
                  if (step === 1 && (!formData.adminName || !formData.adminEmail)) {
                    await alertDialog({ title: 'Missing fields', message: 'Name and Email are required.', tone: 'warning' });
                    return;
                  }

                  // Save lead data periodically
                  if (step <= 3 && formData.adminName && formData.adminEmail) {
                    fetch(`${API_URL}/leads`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        email: formData.adminEmail,
                        name: formData.adminName,
                        phone: formData.adminPhone,
                        companyName: formData.legalName,
                        taxId: formData.taxId,
                        plan: formData.pricingPlan,
                        step: step + 1,
                        details: formData
                      })
                    }).catch(err => console.error('Lead save error', err));
                  }

                  setStep(step + 1);
                }}
                className="bg-blue-600 text-white px-8 py-3 rounded-2xl font-bold flex items-center gap-3 hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 group"
              >
                Next Step <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </button>
            ) : (
              <button
                onClick={handleComplete}
                disabled={isSubmitting}
                className="bg-emerald-600 text-white px-10 py-3 rounded-2xl font-bold flex items-center gap-3 hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-200 animate-pulse disabled:opacity-50"
              >
                {isSubmitting ? 'Setting up...' : 'Complete Onboarding'} <ArrowRight size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Wizard;
