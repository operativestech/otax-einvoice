
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Send, X, Bot, Info } from 'lucide-react';
import { getSmartAssistantResponse } from '../services/geminiService';

const Chatbot: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{ text: string; isBot: boolean }[]>([
    { text: "Hi! I'm your OTax assistant. Ask me about your invoices, reconciliation, signing queue, or ETA error codes — in Arabic or English.\n\nاسألني عن فواتيرك، المطابقة، طابور التوقيع، أو أكواد أخطاء ETA.", isBot: true }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { text: userMsg, isBot: false }]);
    setIsLoading(true);

    // Simple keyword navigation mapping
    const navMapping: Record<string, string> = {
      'dashboard': '/dashboard',
      'لوحة المعلومات': '/dashboard',
      'invoice': '/invoices',
      'فواتير': '/invoices',
      'manual': '/manual-invoice',
      'يدوي': '/manual-invoice',
      'setting': '/settings',
      'إعدادات': '/settings',
      'health': '/system-health',
      'حالة': '/system-health',
      'import': '/import',
      'excel': '/import',
      'report': '/reports',
      'master': '/master-data',
    };

    const foundNav = Object.entries(navMapping).find(([keyword]) => userMsg.toLowerCase().includes(keyword));
    if (foundNav) {
      setTimeout(() => {
        setMessages(prev => [...prev, { text: `Sure, I'll take you to the ${foundNav[0]} section now.`, isBot: true }]);
        setIsLoading(false);
        navigate(foundNav[1]);
      }, 500);
      return;
    }

    const botResponse = await getSmartAssistantResponse(userMsg);
    setMessages(prev => [...prev, { text: botResponse, isBot: true }]);
    setIsLoading(false);
  };

  return (
    <div className="fixed bottom-14 right-6 z-[60]">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-blue-600 text-white p-4 rounded-full shadow-2xl hover:bg-blue-700 transition-all hover:scale-110 active:scale-95"
        >
          <MessageSquare size={28} />
        </button>
      ) : (
        <div className="bg-white w-80 sm:w-96 h-[500px] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-blue-600 p-4 text-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bot size={24} />
              <div>
                <h3 className="font-bold text-sm">Smart Assistant</h3>
                <p className="text-[10px] opacity-80">Powered by Gemini AI</p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="hover:bg-blue-500 p-1 rounded-lg transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.isBot ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[85%] p-3 rounded-2xl text-sm whitespace-pre-wrap ${msg.isBot
                    ? 'bg-gray-100 text-slate-800 rounded-tl-none'
                    : 'bg-blue-600 text-white rounded-tr-none'
                  }`}>
                  {msg.text}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 p-3 rounded-2xl rounded-tl-none flex gap-1">
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" />
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Preset question chips — surface common asks */}
          {messages.length <= 1 && (
            <div className="px-4 pb-2 flex flex-wrap gap-1.5">
              {[
                'How many invoices last month?',
                'Show me failed signings',
                'What is my reconciliation match rate?',
                'كام فاتورة غير مطابقة؟',
              ].map(q => (
                <button key={q} onClick={() => setInput(q)}
                  className="text-[11px] px-2 py-1 bg-blue-50 text-blue-700 rounded-full hover:bg-blue-100 border border-blue-100">
                  {q}
                </button>
              ))}
            </div>
          )}

          <div className="p-4 border-t border-gray-100">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask about your invoices, matches, signing..."
                className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
              <button
                onClick={handleSend}
                disabled={isLoading}
                className="bg-blue-600 text-white p-2 rounded-xl hover:bg-blue-700 disabled:opacity-50"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chatbot;
