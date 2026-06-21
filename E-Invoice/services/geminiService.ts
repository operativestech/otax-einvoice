/**
 * Smart Assistant Service
 * Calls the backend /api/assistant/chat which uses Gemini function-calling
 * grounded in the user's own invoice / reconciliation / signing data.
 * Falls back to a keyword matcher server-side when no GEMINI_API_KEY is set.
 */

import { API_URL } from './apiService';

const buildHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const user = JSON.parse(localStorage.getItem('invoice_user') || '{}');
    if (user.token) headers['Authorization'] = `Bearer ${user.token}`;
  } catch { /* ignore */ }
  return headers;
};

export const getSmartAssistantResponse = async (prompt: string): Promise<string> => {
  try {
    const response = await fetch(`${API_URL}/assistant/chat`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ message: prompt }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.response || "I'm sorry, I couldn't process that request.";
  } catch (error: any) {
    console.error('Assistant Error:', error);
    return `Error communicating with the assistant: ${error.message || 'network error'}`;
  }
};

