
import React, { useState } from 'react';
import { ShieldCheck, Cpu, MemoryStick as Memory, AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from '../i18n';

const SystemHealth: React.FC = () => {
  const { t } = useTranslation();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 1500);
  };

  const statusItems: any[] = [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t('sysh.title')}</h1>
          <p className="text-slate-500 text-sm">{t('sysh.subtitle')}</p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-all shadow-sm"
        >
          <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
          {t('sysh.refresh')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-emerald-50 rounded-xl">
            <Cpu className="text-emerald-500" size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">{t('sysh.cpuUsage')}</p>
            <h3 className="text-2xl font-bold text-slate-800">0%</h3>
            <div className="w-32 h-1 bg-gray-100 rounded-full mt-2">
              <div className="w-0 h-full bg-emerald-500 rounded-full" />
            </div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-blue-50 rounded-xl">
            <Memory className="text-blue-500" size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">{t('sysh.memory')}</p>
            <h3 className="text-2xl font-bold text-slate-800">0 GB <span className="text-sm font-normal text-slate-400">/ 0 GB</span></h3>
            <div className="w-32 h-1 bg-gray-100 rounded-full mt-2">
              <div className="w-0 h-full bg-blue-500 rounded-full" />
            </div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="p-3 bg-emerald-50 rounded-xl">
            <ShieldCheck className="text-emerald-500" size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">{t('sysh.security')}</p>
            <h3 className="text-2xl font-bold text-slate-800">{t('sysh.protected')}</h3>
            <p className="text-[10px] text-emerald-600 font-bold">{t('sysh.firewallActive')}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-800">{t('sysh.activeComponents')}</h3>
          <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-bold uppercase">{t('sysh.allNominal')}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">{t('sysh.colComponent')}</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">{t('sysh.colStatus')}</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">{t('sysh.colLatency')}</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">{t('sysh.colUptime')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {statusItems.map((item, i) => (
                <tr key={i} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="text-slate-400">{item.icon}</div>
                      <span className="font-semibold text-slate-800 text-sm">{item.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${item.status === 'Healthy' || item.status === 'Connected' ? 'bg-emerald-500 animate-pulse' :
                          item.status === 'Syncing' ? 'bg-blue-500' : 'bg-slate-400'
                        }`} />
                      <span className="text-sm font-medium">{item.status}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">{item.latency}</td>
                  <td className="px-6 py-4 text-sm font-mono text-slate-500">{item.uptime}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 p-6 rounded-2xl flex gap-4">
        <AlertTriangle className="text-amber-500 shrink-0" size={24} />
        <div>
          <h4 className="font-bold text-amber-800">{t('sysh.maintTitle')}</h4>
          <p className="text-sm text-amber-700 mt-1">
            {t('sysh.maintMsg')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default SystemHealth;
