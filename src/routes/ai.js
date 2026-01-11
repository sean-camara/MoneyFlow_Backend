const express = require('express');
const multer = require('multer');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Configure multer for memory storage (we'll convert to base64)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images are allowed'), false);
    }
  }
});

// OpenRouter API configuration
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Currency formatting helper
const CURRENCY_SYMBOLS = {
  PHP: '₱',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  KRW: '₩',
  SGD: 'S$',
  AUD: 'A$'
};

const formatCurrency = (amount, currency = 'PHP') => {
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

const formatDate = (date) => {
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

const formatShortDate = (date) => {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

// Helper function to call OpenRouter API
const callOpenRouter = async (messages, maxTokens = 1000) => {
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:5173',
      'X-Title': 'FlowMoney'
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
      messages,
      max_tokens: maxTokens,
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
};

// POST /api/ai/scan-receipt - Upload receipt image and extract transactions
router.post('/scan-receipt', auth, upload.single('receipt'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Receipt image is required' });
    }

    // Convert image to base64
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    const messages = [
      {
        role: 'system',
        content: `You are a receipt scanner AI. Analyze the receipt image and extract individual line items (NOT the total).
Return a JSON array of transactions with this format:
[
  {
    "amount": number,
    "category": "Food" | "Transport" | "Bills" | "Entertainment" | "Shopping" | "Health" | "Education" | "Other",
    "note": "item description",
    "type": "EXPENSE"
  }
]
Only extract individual items, not totals or subtotals. Choose the most appropriate category for each item.
If you cannot read the receipt clearly, return an empty array [].
Return ONLY valid JSON, no other text.`
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`
            }
          },
          {
            type: 'text',
            text: 'Extract individual line items from this receipt. Return as JSON array.'
          }
        ]
      }
    ];

    const result = await callOpenRouter(messages, 2000);

    // Parse the JSON response
    let transactions = [];
    try {
      // Try to extract JSON from the response
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        transactions = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
    }

    // Add current date to each transaction
    const today = new Date().toISOString().split('T')[0];
    transactions = transactions.map(t => ({
      ...t,
      date: today,
      currency: req.body.currency || 'PHP'
    }));

    res.json({
      transactions,
      receiptImage: `data:${mimeType};base64,${base64Image}`
    });
  } catch (error) {
    console.error('Scan receipt error:', error);
    res.status(500).json({ error: 'Failed to scan receipt' });
  }
});

// POST /api/ai/parse-transaction - Natural language to transaction
router.post('/parse-transaction', auth, async (req, res) => {
  try {
    const { text, currency = 'PHP' } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const today = new Date();
    const messages = [
      {
        role: 'system',
        content: `You are a transaction parser. Convert natural language into a structured transaction.
Today's date is ${today.toISOString().split('T')[0]}.

Return a JSON object with this format:
{
  "amount": number,
  "category": "Food" | "Transport" | "Bills" | "Entertainment" | "Shopping" | "Health" | "Education" | "Salary" | "Investment" | "Gift" | "Other",
  "note": "description",
  "type": "INCOME" | "EXPENSE",
  "date": "YYYY-MM-DD"
}

Date parsing rules:
- "today" = today's date
- "yesterday" = yesterday's date
- "last week" = 7 days ago
- Specific dates should be parsed correctly

Type rules:
- Salary, Investment, Gift are usually INCOME
- Most other categories are usually EXPENSE
- Context clues like "received", "got paid", "earned" suggest INCOME

Return ONLY valid JSON, no other text.`
      },
      {
        role: 'user',
        content: text
      }
    ];

    const result = await callOpenRouter(messages, 500);

    // Parse the JSON response
    let transaction = null;
    try {
      // Try to extract JSON from the response
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        transaction = JSON.parse(jsonMatch[0]);
        transaction.currency = currency;
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      return res.status(400).json({ error: 'Could not understand the input' });
    }

    if (!transaction) {
      return res.status(400).json({ error: 'Could not parse transaction' });
    }

    res.json(transaction);
  } catch (error) {
    console.error('Parse transaction error:', error);
    res.status(500).json({ error: 'Failed to parse transaction' });
  }
});

// POST /api/ai/insights - Get spending insights
router.post('/insights', auth, async (req, res) => {
  try {
    const { transactions, period = 'month', userQuery, currency = 'PHP' } = req.body;

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ error: 'Transactions data is required' });
    }

    const currencySymbol = CURRENCY_SYMBOLS[currency] || currency;
    const today = new Date();
    const todayFormatted = formatDate(today);

    // Prepare summary for AI
    const totalIncome = transactions
      .filter(t => t.type === 'INCOME')
      .reduce((sum, t) => sum + t.amount, 0);
    
    const totalExpense = transactions
      .filter(t => t.type === 'EXPENSE')
      .reduce((sum, t) => sum + t.amount, 0);

    const balance = totalIncome - totalExpense;

    const categoryBreakdown = {};
    transactions
      .filter(t => t.type === 'EXPENSE')
      .forEach(t => {
        categoryBreakdown[t.category] = (categoryBreakdown[t.category] || 0) + t.amount;
      });

    // Get top spending category
    const topCategory = Object.entries(categoryBreakdown)
      .sort(([,a], [,b]) => b - a)[0];

    // Get recent transactions with notes for context
    const recentTransactions = transactions
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10)
      .map(t => ({
        amount: formatCurrency(t.amount, currency),
        type: t.type,
        category: t.category,
        date: formatShortDate(t.date),
        note: t.note || 'No note'
      }));

    const summary = {
      period,
      totalIncome: formatCurrency(totalIncome, currency),
      totalExpense: formatCurrency(totalExpense, currency),
      balance: formatCurrency(balance, currency),
      balanceRaw: balance,
      categoryBreakdown: Object.entries(categoryBreakdown).map(([cat, amt]) => 
        `${cat}: ${formatCurrency(amt, currency)}`
      ),
      topSpendingCategory: topCategory ? `${topCategory[0]} (${formatCurrency(topCategory[1], currency)})` : 'None',
      transactionCount: transactions.length,
      recentTransactions
    };

    // Build the AI prompt based on whether user has a specific question
    let systemPrompt = `You are "Financial Friend", a warm, supportive, and encouraging personal finance AI assistant for FlowMoney app.

IMPORTANT CONTEXT:
- Today's date is ${todayFormatted}
- User's currency is ${currency} (symbol: ${currencySymbol})
- Always format money with the correct symbol, e.g., "${currencySymbol}1,500"
- Be warm, friendly, and use emojis sparingly to keep the tone light
- Give practical, actionable advice
- Reference specific numbers from their data
- Acknowledge their efforts and progress

RESPONSE STYLE:
- Use a friendly, conversational tone
- Break down complex information into digestible parts
- Use bullet points for lists
- Keep responses concise but helpful (2-4 short paragraphs)
- End with encouragement or a simple tip`;

    let userPrompt;
    if (userQuery) {
      systemPrompt += `\n\nThe user has asked a specific question. Answer it based on their financial data.`;
      userPrompt = `Here's my financial data for this ${period}:
- Total Income: ${summary.totalIncome}
- Total Expenses: ${summary.totalExpense}
- Current Balance: ${summary.balance}
- Top spending: ${summary.topSpendingCategory}
- Categories: ${summary.categoryBreakdown.join(', ')}

Recent transactions:
${summary.recentTransactions.map(t => `• ${t.date}: ${t.type} ${t.amount} (${t.category}) - ${t.note}`).join('\n')}

My question: ${userQuery}`;
    } else {
      userPrompt = `Analyze my ${period} finances and give me a helpful summary:

- Total Income: ${summary.totalIncome}
- Total Expenses: ${summary.totalExpense}
- Current Balance: ${summary.balance}
- Top spending: ${summary.topSpendingCategory}
- Categories: ${summary.categoryBreakdown.join(', ')}
- Number of transactions: ${summary.transactionCount}

Provide:
1. A brief, friendly summary of my financial situation
2. 2-3 specific insights about my spending
3. 1-2 actionable tips
4. Words of encouragement`;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const result = await callOpenRouter(messages, 1500);

    // Return the AI response directly (it's already formatted nicely)
    res.json({
      summary: result,
      insights: [],
      tips: [],
      alerts: [],
      score: balance >= 0 ? Math.min(80 + Math.floor(balance / 1000), 100) : Math.max(20, 50 - Math.floor(Math.abs(balance) / 1000)),
      data: {
        period,
        totalIncome,
        totalExpense,
        balance,
        categoryBreakdown,
        transactionCount: transactions.length,
        currency,
        currentDate: todayFormatted
      }
    });
  } catch (error) {
    console.error('Get insights error:', error);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

// POST /api/ai/help - Help center AI assistant
router.post('/help', auth, async (req, res) => {
  try {
    const { query, context = 'help' } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const systemPrompt = `You are the FlowMoney Help Assistant, a friendly and knowledgeable guide for the FlowMoney personal finance app.

APP FEATURES YOU KNOW ABOUT:
1. **Transactions**: Add income/expenses, categories (Food, Transport, Bills, Entertainment, Shopping, Health, Education, Salary, Investment, Gift, Other), notes, dates
2. **Dashboard**: Overview of balance, income, expenses, recent transactions, quick add button
3. **Joint Accounts**: Shared accounts for couples/roommates/family, invite members by email, everyone can add transactions
4. **Insights**: AI-powered Financial Friend, 50/30/20 budget rule analysis, runway forecast (days until money runs out)
5. **Goals**: Savings goals with progress tracking
6. **Reports**: Monthly/weekly spending reports, category breakdowns, charts
7. **Settings**: Currency (PHP, USD, EUR, GBP, JPY, KRW, SGD, AUD), profile, notifications, password, delete account
8. **AI Features**: Receipt scanning, natural language transaction input, spending insights
9. **Offline Mode**: Personal transactions work offline and sync when back online
10. **Notifications**: Push notifications for joint account invites and transactions

RESPONSE GUIDELINES:
- Be friendly, helpful, and concise
- Use simple, clear language
- Provide step-by-step instructions when explaining how to do something
- Use emojis sparingly to be friendly
- If you don't know something specific, suggest checking the FAQs or general guidance
- Keep responses to 2-3 short paragraphs max`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: query }
    ];

    const result = await callOpenRouter(messages, 800);

    res.json({ response: result });
  } catch (error) {
    console.error('Help AI error:', error);
    res.status(500).json({ error: 'Failed to get help response' });
  }
});

// POST /api/ai/chat - General Financial Friend chat with full context
router.post('/chat', auth, async (req, res) => {
  try {
    const { 
      message, 
      transactions = [], 
      currency = 'PHP',
      balance = 0,
      goals = []
    } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const currencySymbol = CURRENCY_SYMBOLS[currency] || currency;
    const today = new Date();
    const todayFormatted = formatDate(today);
    const currentTime = today.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    // Calculate financial context
    const totalIncome = transactions
      .filter(t => t.type === 'INCOME')
      .reduce((sum, t) => sum + t.amount, 0);
    
    const totalExpense = transactions
      .filter(t => t.type === 'EXPENSE')
      .reduce((sum, t) => sum + t.amount, 0);

    const categoryBreakdown = {};
    transactions
      .filter(t => t.type === 'EXPENSE')
      .forEach(t => {
        categoryBreakdown[t.category] = (categoryBreakdown[t.category] || 0) + t.amount;
      });

    // Recent transactions with notes
    const recentTxns = transactions
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 15)
      .map(t => `${formatShortDate(t.date)}: ${t.type} ${formatCurrency(t.amount, currency)} (${t.category})${t.note ? ` - "${t.note}"` : ''}`);

    const systemPrompt = `You are "Financial Friend", a warm, caring, and insightful AI financial companion in the FlowMoney app.

CURRENT CONTEXT:
📅 Today: ${todayFormatted}
🕐 Time: ${currentTime}
💰 Currency: ${currency} (${currencySymbol})

USER'S FINANCIAL SNAPSHOT:
• Current Balance: ${formatCurrency(balance, currency)}
• This Month's Income: ${formatCurrency(totalIncome, currency)}
• This Month's Expenses: ${formatCurrency(totalExpense, currency)}
• Net: ${formatCurrency(totalIncome - totalExpense, currency)}

SPENDING BY CATEGORY:
${Object.entries(categoryBreakdown).map(([cat, amt]) => `• ${cat}: ${formatCurrency(amt, currency)}`).join('\n') || '• No expenses recorded yet'}

RECENT TRANSACTIONS:
${recentTxns.join('\n') || 'No recent transactions'}

${goals.length > 0 ? `SAVINGS GOALS:\n${goals.map(g => `• ${g.name}: ${formatCurrency(g.currentAmount, currency)} / ${formatCurrency(g.targetAmount, currency)}`).join('\n')}` : ''}

YOUR PERSONALITY:
- Warm, supportive, and encouraging like a good friend
- Reference specific numbers from their data (e.g., "You have ${currencySymbol}X,XXX in your account as of today!")
- Give practical advice based on their actual spending patterns
- Celebrate their wins, no matter how small
- Be honest but gentle about overspending
- Use emojis naturally but not excessively
- Keep responses conversational and easy to read

RESPONSE FORMAT:
- 2-4 short paragraphs max
- Use bullet points for lists
- Always reference their actual data when relevant
- End with encouragement or a simple actionable tip`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message }
    ];

    const result = await callOpenRouter(messages, 1000);

    res.json({ 
      response: result,
      context: {
        balance: formatCurrency(balance, currency),
        income: formatCurrency(totalIncome, currency),
        expenses: formatCurrency(totalExpense, currency),
        date: todayFormatted
      }
    });
  } catch (error) {
    console.error('Chat AI error:', error);
    res.status(500).json({ error: 'Failed to process chat' });
  }
});

module.exports = router;
