import { Router } from 'express';
import { createAuthMiddleware } from '../middleware/auth.js';
import { 
  parseNaturalLanguageTransaction, 
  parseSubscription, 
  generateInsights,
  aiFinancialChat
} from '../services/openRouterService.js';
import { Auth } from '../config/auth.js';

export function createAIRoutes(auth: Auth): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(auth);

  // Magic Add - Parse natural language input into transactions
  router.post('/magic-add', authMiddleware, async (req, res) => {
    try {
      const { input, categories, primaryCurrency, todayISO } = req.body;

      if (!input) {
        return res.status(400).json({ success: false, error: 'Input is required' });
      }

      const defaultCategories = categories || [
        'Food', 'Transport', 'Shopping', 'Entertainment', 'Health',
        'Housing', 'Travel', 'Education', 'Investment', 'Income', 'Other'
      ];
      const currency = primaryCurrency || 'USD';
      const today = todayISO || new Date().toISOString().split('T')[0];

      const result = await parseNaturalLanguageTransaction(input, defaultCategories, currency, today);

      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Magic add error:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to parse input',
        data: { error: true, message: 'AI service unavailable', transactions: [] }
      });
    }
  });

  // Parse subscription info
  router.post('/parse-subscription', authMiddleware, async (req, res) => {
    try {
      const { input, primaryCurrency, today } = req.body;

      if (!input) {
        return res.status(400).json({ success: false, error: 'Input is required' });
      }

      const currency = primaryCurrency || 'USD';
      const todayStr = today || new Date().toISOString().split('T')[0];

      const result = await parseSubscription(input, currency, todayStr);

      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Subscription parsing error:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to parse subscription',
        data: { error: true, message: 'AI service unavailable', subscriptions: [] }
      });
    }
  });

  // Generate AI insights
  router.post('/insights', authMiddleware, async (req, res) => {
    try {
      const { transactions, analysisData, goalMetrics } = req.body;

      if (!analysisData) {
        return res.status(400).json({ success: false, error: 'Analysis data is required' });
      }

      const result = await generateInsights(transactions || [], analysisData, goalMetrics);

      res.json({ success: true, data: { insights: result } });
    } catch (error: any) {
      console.error('Insights generation error:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to generate insights',
        data: {
          insights: JSON.stringify({
            generalTip: "I'm having trouble connecting to the AI service.",
            budgetHealth: "Unable to analyze at this time.",
            runwayAnalysis: "Please try again later."
          })
        }
      });
    }
  });

  // AI Chat for financial advice
  router.post('/chat', authMiddleware, async (req, res) => {
    try {
      const { message, history } = req.body;

      if (!message) {
        return res.status(400).json({ success: false, error: 'Message is required' });
      }

      const result = await aiFinancialChat(message, history || []);

      res.json({ success: true, data: { response: result } });
    } catch (error: any) {
      console.error('AI chat error:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to process chat',
        data: { response: "I'm having trouble connecting to the AI service. Please try again later." }
      });
    }
  });

  return router;
}
