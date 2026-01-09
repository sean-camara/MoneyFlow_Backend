// OpenRouter AI Service - Using free models
// Model: meta-llama/llama-3.3-70b-instruct:free

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  error?: {
    message: string;
  };
}

export async function callOpenRouter(
  messages: OpenRouterMessage[],
  options?: {
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
  }
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }
  
  const model = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';
  
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.FRONTEND_URL || 'https://money-flow-six.vercel.app',
      'X-Title': 'FlowMoney'
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: options?.maxTokens || 1024,
      temperature: options?.temperature || 0.7,
      response_format: options?.jsonMode ? { type: 'json_object' } : undefined
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('OpenRouter API error:', errorText);
    throw new Error(`OpenRouter API error: ${response.status}`);
  }
  
  const data = await response.json() as OpenRouterResponse;
  
  if (data.error) {
    throw new Error(data.error.message);
  }
  
  return data.choices[0]?.message?.content || '';
}

// Parse natural language input for transactions (Magic Add)
export async function parseNaturalLanguageTransaction(
  input: string,
  categories: string[],
  primaryCurrency: string,
  todayISO: string
): Promise<any> {
  const systemPrompt = `You are a transaction parser for a finance app. Parse user input into transaction data.

Available Categories: ${categories.join(', ')}
Default Currency: ${primaryCurrency}
Default Date: ${todayISO}

RULES:
1. If input is ONLY numbers (e.g. "50" or "50, 20"), REJECT with error=true
2. Input MUST have context: category name, product name, or action verb (food, taxi, uber, salary, paid)
3. For rejected input, provide a helpful suggestion

Return ONLY valid JSON:
{
  "error": boolean,
  "message": "explanation if error",
  "suggestion": "example fix if error",
  "transactions": [
    {
      "amount": number,
      "currency": "string",
      "category": "string from categories",
      "note": "item description",
      "date": "YYYY-MM-DD",
      "type": "EXPENSE" or "INCOME"
    }
  ]
}`;

  const result = await callOpenRouter([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: input }
  ], { jsonMode: true });
  
  try {
    // Try to extract JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { error: true, message: 'Failed to parse response', transactions: [] };
  } catch {
    return { error: true, message: 'Failed to parse AI response', transactions: [] };
  }
}

// Parse receipt image (base64) - Note: Free models may not support images well
export async function parseReceiptImage(
  base64Data: string,
  categories: string[],
  primaryCurrency: string,
  todayISO: string
): Promise<any> {
  // For image parsing, we'd need a vision model. Free tier may be limited.
  // Using text description as fallback
  return {
    error: true,
    message: 'Receipt scanning requires a premium AI model. Please use Magic Add with text instead.',
    transactions: []
  };
}

// Parse subscription info
export async function parseSubscription(
  input: string,
  primaryCurrency: string,
  today: string
): Promise<any> {
  const systemPrompt = `You are a subscription parser. Parse user input into subscription data.

Default Currency: ${primaryCurrency}
Today: ${today}

RULES:
1. If input is ONLY numbers, REJECT with error=true
2. Input MUST contain service name (Netflix, Spotify, Rent, etc.) or context like "Monthly", "Yearly"
3. If cycle not mentioned, assume "Monthly"

Return ONLY valid JSON:
{
  "error": boolean,
  "message": "explanation if error",
  "suggestion": "example fix if error",
  "subscriptions": [
    {
      "name": "service name",
      "amount": number,
      "currency": "string",
      "cycle": "Monthly" or "Yearly",
      "nextDate": "YYYY-MM-DD"
    }
  ]
}`;

  const result = await callOpenRouter([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: input }
  ], { jsonMode: true });
  
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { error: true, message: 'Failed to parse response', subscriptions: [] };
  } catch {
    return { error: true, message: 'Failed to parse AI response', subscriptions: [] };
  }
}

// Generate financial insights
export async function generateInsights(
  transactions: any[],
  analysisData: { income: number; expense: number; topCategory: { name: string; amount: number } },
  goalMetrics?: { name: string; deadline: string; daysLeft: number; remaining: number }
): Promise<string> {
  let goalSection = '';
  if (goalMetrics) {
    goalSection = `
ACTIVE GOAL:
- Name: "${goalMetrics.name}"
- Deadline: ${goalMetrics.deadline} (${goalMetrics.daysLeft} days left)
- Amount Needed: ${goalMetrics.remaining}`;
  }

  const systemPrompt = `You are a warm, friendly financial advisor. Analyze the data and provide insights.

Return ONLY valid JSON:
{
  "generalTip": "Warm observation starting with 'I see...', 'I noticed...', or 'It looks like...' (max 25 words)",
  "budgetHealth": "Comment on spending mix (max 20 words)",
  "runwayAnalysis": "Comment on survival days (max 20 words)",
  "goalAnalysis": "Advice on reaching goal if exists (max 25 words)",
  "goalStatus": "ON_TRACK" or "AT_RISK" or "UNREALISTIC" (only if goal exists)
}`;

  const userPrompt = `Financial Data:
- Total Spent: ${analysisData.expense}
- Total Income: ${analysisData.income}
- Top Expense Category: ${analysisData.topCategory?.name || 'None'} (${analysisData.topCategory?.amount || 0})
- Number of Transactions: ${transactions?.length || 0}
${goalSection}`;

  const result = await callOpenRouter([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], { jsonMode: true, temperature: 0.5 });
  
  // Return the raw AI response string for the frontend to parse
  return result;
}

// AI Chat for financial questions
export async function aiFinancialChat(
  message: string,
  history?: Array<{ role: string; content: string }>
): Promise<string> {
  const systemPrompt = `You are a warm, empathetic financial assistant for FlowMoney.
You are NOT a strict calculator. You are a supportive coach.

TONE: Friendly, Reassuring, Specific.
- Start answers with "I see...", "I noticed...", "Don't worry...", or "Great job..."
- If they mention overspending, be gentle. "It looks like spending might be a bit high, maybe we can find some savings?"
- Never scold the user.

Be friendly, specific, and keep responses under 100 words.
If the user asks about something you don't know, say "I'd need more information about that."

TODAY: ${new Date().toLocaleDateString()}`;

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt }
  ];
  
  // Add conversation history
  if (history && history.length > 0) {
    history.slice(-6).forEach(h => {
      messages.push({
        role: h.role === 'user' ? 'user' : 'assistant',
        content: h.content
      });
    });
  }
  
  messages.push({ role: 'user', content: message });
  
  try {
    return await callOpenRouter(messages, { temperature: 0.7, maxTokens: 500 });
  } catch (error: any) {
    console.error('AI chat error:', error.message);
    return "I'm having trouble connecting right now. Please try again in a moment.";
  }
}
