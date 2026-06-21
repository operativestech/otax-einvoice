
/**
 * Smart Assistant Service
 * Calls the backend API for AI responses instead of using client-side API key
 */

export const getSmartAssistantResponse = async (prompt: string): Promise<string> => {
  try {
    // Call the backend API instead of using client-side Gemini
    const response = await fetch('/api/assistant/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: prompt }),
    });

    if (!response.ok) {
      throw new Error('Failed to get response from assistant');
    }

    const data = await response.json();
    return data.response || "I'm sorry, I couldn't process that request.";
  } catch (error) {
    console.error("Assistant Error:", error);
    return "Error communicating with the assistant. Please check your connection.";
  }
};

