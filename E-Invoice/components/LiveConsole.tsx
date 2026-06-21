
import React, { useState, useEffect, useRef } from 'react';
import { Terminal, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import { LogEntry } from '../types';

const LiveConsole: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([
    { timestamp: new Date().toLocaleTimeString(), message: 'System initialized. Waiting for events...', type: 'info' },
  ]);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Listen for custom events from the application
    const handleLog = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setLogs(prev => [...prev.slice(-100), {
        timestamp: new Date().toLocaleTimeString(),
        message: detail.message,
        type: detail.type || 'info'
      }]);

      // Auto-open on error
      if (detail.type === 'error') {
        setIsExpanded(true);
      }
    };

    window.addEventListener('live-console-log', handleLog);
    return () => window.removeEventListener('live-console-log', handleLog);
  }, []);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isExpanded]);

  return (
    <div className={`bg-slate-900 border-t border-slate-700 transition-all duration-300 ${isExpanded ? 'h-64' : 'h-10'}`}>
      <div
        className="h-10 px-6 flex items-center justify-between cursor-pointer hover:bg-slate-800 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3 text-slate-400">
          <Terminal size={16} />
          <span className="text-xs font-mono font-medium tracking-wider">LIVE OPERATIONS CONSOLE</span>
          <div className="flex items-center gap-2 ml-4">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] text-green-500 font-bold uppercase">Streaming</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={(e) => { e.stopPropagation(); setLogs([]); }}
            className="text-slate-500 hover:text-white transition-colors"
          >
            <Trash2 size={14} />
          </button>
          {isExpanded ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronUp size={18} className="text-slate-400" />}
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 overflow-y-auto h-[calc(100%-40px)] font-mono text-xs">
          {logs.map((log, idx) => (
            <div key={idx} className="flex gap-4 mb-1">
              <span className="text-slate-500 shrink-0">[{log.timestamp}]</span>
              <span className={`
                ${log.type === 'success' ? 'text-emerald-400' : ''}
                ${log.type === 'error' ? 'text-rose-400' : ''}
                ${log.type === 'warning' ? 'text-amber-400' : ''}
                ${log.type === 'info' ? 'text-sky-300' : ''}
              `}>
                {log.message}
              </span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
};

export default LiveConsole;
