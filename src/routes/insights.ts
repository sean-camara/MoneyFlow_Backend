import { Router } from 'express';
import { getDb } from '../config/database.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { requireJointAccountMember } from '../middleware/jointAccount.js';
import { analyzeJointAccountFinances, generateAIInsights, aiChat } from '../services/aiService.js';
import { Auth } from '../config/auth.js';

export function createInsightsRoutes(auth: Auth): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(auth);

  // Get financial analysis for a joint account
  router.get('/analysis/:jointAccountId', authMiddleware, requireJointAccountMember, async (req, res) => {
    try {
      const { jointAccountId } = req.params;
      const primaryCurrency = req.user?.primaryCurrency || 'USD';

      const analysis = await analyzeJointAccountFinances(jointAccountId, primaryCurrency);

      res.json({ success: true, data: analysis });
    } catch (error) {
      console.error('Error fetching analysis:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch financial analysis' });
    }
  });

  // Get AI insights for a joint account
  router.get('/ai/:jointAccountId', authMiddleware, requireJointAccountMember, async (req, res) => {
    try {
      const { jointAccountId } = req.params;
      const primaryCurrency = req.user?.primaryCurrency || 'USD';

      const insights = await generateAIInsights(jointAccountId, primaryCurrency);

      res.json({ success: true, data: insights });
    } catch (error) {
      console.error('Error generating AI insights:', error);
      res.status(500).json({ success: false, error: 'Failed to generate AI insights' });
    }
  });

  // AI Chat for a joint account (specific account context)
  router.post('/chat/:jointAccountId', authMiddleware, requireJointAccountMember, async (req, res) => {
    try {
      const { jointAccountId } = req.params;
      const { message } = req.body;
      const primaryCurrency = req.user?.primaryCurrency || 'USD';

      if (!message) {
        return res.status(400).json({ success: false, error: 'Message is required' });
      }

      const response = await generateAIInsights(jointAccountId, primaryCurrency, message);

      res.json({ success: true, data: { response } });
    } catch (error) {
      console.error('Error in AI chat:', error);
      res.status(500).json({ success: false, error: 'Failed to process chat message' });
    }
  });

  // General AI Chat (no specific account context - uses user's joint accounts)
  router.post('/chat', authMiddleware, async (req, res) => {
    try {
      const { message, history } = req.body;
      const userId = req.user!.id;

      if (!message) {
        return res.status(400).json({ success: false, error: 'Message is required' });
      }

      const response = await aiChat(userId, message, history);

      res.json({ success: true, data: { message: response } });
    } catch (error) {
      console.error('Error in AI chat:', error);
      res.status(500).json({ 
        success: true, 
        data: { 
          message: "I'm sorry, I encountered an error processing your request. This might be because I don't have access to enough data yet. Please try a different question or check if you have any joint accounts set up." 
        } 
      });
    }
  });

  return router;
}
