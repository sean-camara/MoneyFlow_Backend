import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '../config/database.js';
import { Transaction, Goal, Subscription, TransactionType, Category } from '../types/index.js';

// Helper to get amount category type for 50/30/20 analysis
function getCategoryType(category: string): 'NEED' | 'WANT' | 'SAVINGS' | 'OTHER' {
  switch (category) {
    case Category.HOUSING:
    case Category.FOOD:
    case Category.HEALTH:
    case Category.TRANSPORT:
      return 'NEED';
    case Category.SHOPPING:
    case Category.ENTERTAINMENT:
    case Category.TRAVEL:
      return 'WANT';
    case Category.INVESTMENT:
      return 'SAVINGS';
    default:
      return 'OTHER';
  }
}

export interface FinancialAnalysis {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  breakdown: { NEED: number; WANT: number; SAVINGS: number; OTHER: number };
  topCategory: { name: string; amount: number; percent: number };
  categoryTotals: Record<string, number>;
  userContributions: Array<{ userId: string; userName: string; totalAdded: number; count: number }>;
}

export interface AIInsights {
  generalTip: string;
  budgetHealth: string;
  runwayAnalysis: string;
  goalAnalysis?: string;
  goalStatus?: 'ON_TRACK' | 'AT_RISK' | 'UNREALISTIC';
}

// Analyze financial data for a joint account
export async function analyzeJointAccountFinances(
  jointAccountId: string,
  primaryCurrency: string
): Promise<FinancialAnalysis> {
  const db = getDb();
  
  const transactions = await db.collection<Transaction>('transactions')
    .find({ jointAccountId })
    .toArray();
  
  let income = 0;
  let expense = 0;
  const breakdown = { NEED: 0, WANT: 0, SAVINGS: 0, OTHER: 0 };
  const categoryTotals: Record<string, number> = {};
  const userContributionsMap: Record<string, { userName: string; totalAdded: number; count: number }> = {};
  
  transactions.forEach(t => {
    // Note: In a real app, you'd convert currencies here
    const amount = t.amount;
    
    if (t.type === TransactionType.INCOME) {
      income += amount;
    } else {
      expense += amount;
      const type = getCategoryType(t.category as string);
      breakdown[type] += amount;
      categoryTotals[t.category] = (categoryTotals[t.category] || 0) + amount;
    }
    
    // Track user contributions
    if (!userContributionsMap[t.addedByUserId]) {
      userContributionsMap[t.addedByUserId] = {
        userName: t.addedByUserName,
        totalAdded: 0,
        count: 0
      };
    }
    userContributionsMap[t.addedByUserId].totalAdded += amount;
    userContributionsMap[t.addedByUserId].count += 1;
  });
  
  const sortedCats = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
  const topCat = sortedCats[0] || ['None', 0];
  
  const userContributions = Object.entries(userContributionsMap).map(([userId, data]) => ({
    userId,
    userName: data.userName,
    totalAdded: data.totalAdded,
    count: data.count
  }));
  
  return {
    totalIncome: income,
    totalExpense: expense,
    balance: income - expense,
    breakdown,
    topCategory: {
      name: topCat[0],
      amount: topCat[1],
      percent: expense > 0 ? (topCat[1] / expense) * 100 : 0
    },
    categoryTotals,
    userContributions
  };
}

// Generate AI insights based on real data
export async function generateAIInsights(
  jointAccountId: string,
  primaryCurrency: string,
  userQuestion?: string
): Promise<AIInsights | string> {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    return {
      generalTip: "I don't have access to AI capabilities right now. Please configure the API key.",
      budgetHealth: "Unable to analyze without AI configuration.",
      runwayAnalysis: "Unable to calculate without AI configuration."
    };
  }
  
  const db = getDb();
  
  // Gather real data
  const analysis = await analyzeJointAccountFinances(jointAccountId, primaryCurrency);
  
  const goals = await db.collection<Goal>('goals')
    .find({ jointAccountId })
    .toArray();
  
  const subscriptions = await db.collection<Subscription>('subscriptions')
    .find({ jointAccountId })
    .toArray();
  
  // Get recent transactions for context
  const recentTransactions = await db.collection<Transaction>('transactions')
    .find({ jointAccountId })
    .sort({ date: -1 })
    .limit(50)
    .toArray();
  
  // Calculate runway
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const recentExpenses = recentTransactions.filter(
    t => t.type === TransactionType.EXPENSE && new Date(t.date) >= thirtyDaysAgo
  );
  
  const totalRecentExpense = recentExpenses.reduce((sum, t) => sum + t.amount, 0);
  const dailyBurn = totalRecentExpense / 30;
  
  const monthlySubscriptionCost = subscriptions.reduce((acc, sub) => {
    return acc + (sub.cycle === 'Yearly' ? sub.amount / 12 : sub.amount);
  }, 0);
  
  const runwayDays = dailyBurn > 0 ? Math.floor(analysis.balance / dailyBurn) : 999;
  
  // Active goal
  const activeGoal = goals.find(g => g.deadline && g.currentAmount < g.targetAmount);
  
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    // If this is a chat question, handle it differently
    if (userQuestion) {
      const transactionHistory = recentTransactions
        .slice(0, 30)
        .map(t => {
          const date = new Date(t.date).toLocaleDateString();
          return `- [${date}] ${t.type}: ${t.amount} ${t.currency} (${t.category}) by ${t.addedByUserName} - Note: ${t.note || 'None'}`;
        })
        .join('\n');
      
      const userContributionsText = analysis.userContributions
        .map(u => `- ${u.userName}: ${u.count} transactions, total ${u.totalAdded} ${primaryCurrency}`)
        .join('\n');
      
      const context = `
        You are a warm, empathetic financial assistant for FlowMoney, a joint account management app.
        You must ONLY use the data provided below to answer questions. If the user asks about something
        not in this data, say "I don't have access to that information."
        
        TONE: Friendly, Reassuring, Specific.
        Keep answers under 100 words.
        
        Current Date: ${new Date().toLocaleDateString()}
        
        ACCOUNT SUMMARY:
        - Balance: ${analysis.balance} ${primaryCurrency}
        - Total Income: ${analysis.totalIncome} ${primaryCurrency}
        - Total Expense: ${analysis.totalExpense} ${primaryCurrency}
        - Daily Burn Rate: ${dailyBurn.toFixed(2)} ${primaryCurrency}
        - Monthly Subscription Costs: ${monthlySubscriptionCost} ${primaryCurrency}
        - Runway: ${runwayDays > 365 ? '1+ Year' : runwayDays + ' Days'}
        
        USER CONTRIBUTIONS:
        ${userContributionsText || 'No contribution data yet.'}
        
        RECENT TRANSACTIONS:
        ${transactionHistory || 'No transactions yet.'}
        
        ${activeGoal ? `ACTIVE GOAL: ${activeGoal.name} - Target: ${activeGoal.targetAmount}, Current: ${activeGoal.currentAmount}, Deadline: ${activeGoal.deadline}` : 'No active goals.'}
      `;
      
      const result = await model.generateContent(`${context}\n\nUser question: ${userQuestion}`);
      return result.response.text();
    }
    
    // Generate structured insights
    let goalSection = '';
    if (activeGoal) {
      const remaining = activeGoal.targetAmount - activeGoal.currentAmount;
      const deadline = new Date(activeGoal.deadline!);
      const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 3600 * 24));
      const dailyNeeded = daysLeft > 0 ? remaining / daysLeft : remaining;
      
      const recentIncome = recentTransactions
        .filter(t => t.type === TransactionType.INCOME && new Date(t.date) >= thirtyDaysAgo)
        .reduce((sum, t) => sum + t.amount, 0);
      const dailySurplus = (recentIncome - totalRecentExpense) / 30;
      
      goalSection = `
        ACTIVE GOAL:
        - Name: "${activeGoal.name}"
        - Days Left: ${daysLeft}
        - Amount Needed: ${remaining} ${primaryCurrency}
        - Daily Savings Required: ${dailyNeeded.toFixed(2)} ${primaryCurrency}
        - Current Daily Surplus: ${dailySurplus.toFixed(2)} ${primaryCurrency}
      `;
    }
    
    const prompt = `
      You are a warm, friendly financial advisor. Analyze this data and return JSON.
      
      DATA:
      - Total Spent: ${analysis.totalExpense} ${primaryCurrency}
      - Total Income: ${analysis.totalIncome} ${primaryCurrency}
      - Balance: ${analysis.balance} ${primaryCurrency}
      - Top Expense Category: ${analysis.topCategory.name} (${analysis.topCategory.amount} ${primaryCurrency})
      - 50/30/20 Split: Needs ${Math.round((analysis.breakdown.NEED / (analysis.totalExpense || 1)) * 100)}%, Wants ${Math.round((analysis.breakdown.WANT / (analysis.totalExpense || 1)) * 100)}%, Savings ${Math.round((analysis.breakdown.SAVINGS / (analysis.totalExpense || 1)) * 100)}%
      - Runway: ${runwayDays > 365 ? '1+ Year' : runwayDays + ' Days'}
      - Monthly Subscriptions: ${monthlySubscriptionCost} ${primaryCurrency}
      ${goalSection}
      
      Return ONLY valid JSON with:
      1. generalTip: Warm observation starting with "I see...", "I noticed...", or "It looks like..." (max 25 words)
      2. budgetHealth: Comment on spending mix (max 20 words)
      3. runwayAnalysis: Comment on survival days (max 20 words)
      4. goalAnalysis: (if goal exists) Advice on reaching goal (max 25 words)
      5. goalStatus: (if goal exists) "ON_TRACK", "AT_RISK", or "UNREALISTIC"
    `;
    
    const result = await model.generateContent(prompt);
    let jsonStr = result.response.text();
    jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
    
    return JSON.parse(jsonStr) as AIInsights;
  } catch (error: any) {
    console.error('AI generation error:', error.message);
    return {
      generalTip: "I'm having trouble connecting to the AI service right now.",
      budgetHealth: "Unable to analyze at this time.",
      runwayAnalysis: "Please try again later."
    };
  }
}

// General AI Chat for user (aggregates data from all user's joint accounts)
export async function aiChat(
  userId: string,
  message: string,
  history?: Array<{ role: string; content: string }>
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    return "I don't have access to AI capabilities right now. The API key hasn't been configured. Please contact support.";
  }
  
  const db = getDb();
  
  // Get all joint accounts the user is part of
  const memberships = await db.collection('jointAccountMembers')
    .find({ userId })
    .toArray();
  
  const jointAccountIds = memberships.map(m => m.jointAccountId);
  
  if (jointAccountIds.length === 0) {
    // User has no joint accounts - provide limited help
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      
      const prompt = `
        You are a friendly financial assistant for FlowMoney.
        The user doesn't have any joint accounts set up yet, so you don't have access to their financial data.
        
        Answer their question as helpfully as possible, but be honest when you don't have data.
        If they ask about their spending/transactions, explain that they need to set up a joint account first.
        
        Keep responses under 100 words. Be warm and helpful.
        
        User: ${message}
      `;
      
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      console.error('AI chat error:', error);
      return "I'm having trouble connecting right now. Please try again in a moment.";
    }
  }
  
  // Gather financial data from all joint accounts
  let allTransactions: Transaction[] = [];
  let allGoals: Goal[] = [];
  let allSubscriptions: Subscription[] = [];
  
  for (const accountId of jointAccountIds) {
    const transactions = await db.collection<Transaction>('transactions')
      .find({ jointAccountId: accountId })
      .sort({ date: -1 })
      .limit(50)
      .toArray();
    allTransactions = allTransactions.concat(transactions);
    
    const goals = await db.collection<Goal>('goals')
      .find({ jointAccountId: accountId })
      .toArray();
    allGoals = allGoals.concat(goals);
    
    const subs = await db.collection<Subscription>('subscriptions')
      .find({ jointAccountId: accountId })
      .toArray();
    allSubscriptions = allSubscriptions.concat(subs);
  }
  
  // Sort transactions by date
  allTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  allTransactions = allTransactions.slice(0, 100); // Limit to recent 100
  
  // Calculate summary
  let totalIncome = 0;
  let totalExpense = 0;
  const categoryTotals: Record<string, number> = {};
  
  allTransactions.forEach(t => {
    if (t.type === TransactionType.INCOME) {
      totalIncome += t.amount;
    } else {
      totalExpense += t.amount;
      categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
    }
  });
  
  const transactionSummary = allTransactions.slice(0, 20).map(t => {
    return `[${new Date(t.date).toLocaleDateString()}] ${t.type === TransactionType.INCOME ? '+' : '-'}${t.amount} ${t.currency} (${t.category})${t.note ? ` - "${t.note}"` : ''}`;
  }).join('\n');
  
  const goalsSummary = allGoals.map(g => {
    const progress = Math.round((g.currentAmount / g.targetAmount) * 100);
    return `- ${g.name}: ${progress}% (${g.currentAmount}/${g.targetAmount} ${g.currency})${g.deadline ? ` Due: ${g.deadline}` : ''}`;
  }).join('\n');
  
  const subsSummary = allSubscriptions.map(s => {
    return `- ${s.name}: ${s.amount} ${s.currency}/${s.cycle}`;
  }).join('\n');
  
  const categoryBreakdown = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cat, amt]) => `- ${cat}: ${amt}`)
    .join('\n');
  
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const context = `
      You are a warm, empathetic financial assistant for FlowMoney.
      You MUST only answer based on the data provided below. If asked about something not in this data,
      say "I don't have access to that information in my current data."
      
      Be friendly, specific, and keep responses under 100 words.
      
      TODAY: ${new Date().toLocaleDateString()}
      
      USER'S FINANCIAL SUMMARY:
      - Total Income (recent): ${totalIncome}
      - Total Expenses (recent): ${totalExpense}
      - Balance: ${totalIncome - totalExpense}
      - Number of Accounts: ${jointAccountIds.length}
      
      TOP EXPENSE CATEGORIES:
      ${categoryBreakdown || 'No expense data yet.'}
      
      RECENT TRANSACTIONS:
      ${transactionSummary || 'No transactions yet.'}
      
      SAVINGS GOALS:
      ${goalsSummary || 'No goals set.'}
      
      SUBSCRIPTIONS:
      ${subsSummary || 'No subscriptions tracked.'}
    `;
    
    let conversationHistory = '';
    if (history && history.length > 0) {
      conversationHistory = '\n\nCONVERSATION HISTORY:\n' + 
        history.slice(-6).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    }
    
    const prompt = `${context}${conversationHistory}\n\nUser: ${message}\n\nAssistant:`;
    
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (error: any) {
    console.error('AI chat error:', error.message);
    return "I'm having trouble connecting to my AI service right now. Please try again in a moment.";
  }
}
