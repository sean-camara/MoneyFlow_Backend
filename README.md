# FlowMoney Backend

Express.js + MongoDB backend for FlowMoney PWA with Better Auth authentication.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Generate VAPID keys for push notifications:**
   ```bash
   npm run generate-vapid
   # Copy the output to your .env file
   ```

4. **Start MongoDB:**
   Make sure MongoDB is running locally or provide a remote URI.

5. **Run the server:**
   ```bash
   # Development mode (with hot reload)
   npm run dev

   # Production mode
   npm run build
   npm start
   ```

## API Endpoints

### Authentication (Better Auth)
- `POST /api/auth/sign-up/email` - Register with email/password
- `POST /api/auth/sign-in/email` - Login with email/password
- `POST /api/auth/sign-out` - Logout
- `GET /api/auth/session` - Get current session

### Joint Accounts
- `GET /api/joint-accounts` - List user's joint accounts
- `POST /api/joint-accounts` - Create a joint account
- `GET /api/joint-accounts/:id` - Get joint account details
- `PUT /api/joint-accounts/:id` - Update joint account (admin only)
- `POST /api/joint-accounts/:id/invite` - Invite user (admin only)
- `DELETE /api/joint-accounts/:id/members/:memberId` - Remove member (admin only)

### Invites
- `GET /api/joint-accounts/invites/pending` - Get pending invites for current user
- `POST /api/joint-accounts/invites/:inviteId/respond` - Accept/decline invite

### Transactions
- `GET /api/transactions/joint-account/:jointAccountId` - List transactions
- `POST /api/transactions` - Create transaction
- `PUT /api/transactions/:id` - Update transaction
- `DELETE /api/transactions/:id` - Delete transaction
- `POST /api/transactions/bulk-delete` - Bulk delete transactions

### Goals
- `GET /api/goals/joint-account/:jointAccountId` - List goals
- `POST /api/goals` - Create goal
- `PUT /api/goals/:id` - Update goal
- `DELETE /api/goals/:id` - Delete goal

### Subscriptions
- `GET /api/subscriptions/joint-account/:jointAccountId` - List subscriptions
- `POST /api/subscriptions` - Create subscription
- `PUT /api/subscriptions/:id` - Update subscription
- `DELETE /api/subscriptions/:id` - Delete subscription

### Insights (AI)
- `GET /api/insights/analysis/:jointAccountId` - Get financial analysis
- `GET /api/insights/ai/:jointAccountId` - Get AI insights
- `POST /api/insights/chat/:jointAccountId` - AI chat

### Push Notifications
- `GET /api/push/vapid-public-key` - Get VAPID public key
- `POST /api/push/subscribe` - Subscribe to notifications
- `POST /api/push/unsubscribe` - Unsubscribe from notifications

### User
- `GET /api/user/me` - Get current user profile
- `PUT /api/user/preferences` - Update preferences

## Architecture

```
src/
├── config/
│   ├── auth.ts        # Better Auth configuration
│   └── database.ts    # MongoDB connection
├── middleware/
│   ├── auth.ts        # Authentication middleware
│   └── jointAccount.ts # Joint account access control
├── routes/
│   ├── index.ts       # Route exports
│   ├── jointAccounts.ts
│   ├── transactions.ts
│   ├── goals.ts
│   ├── subscriptions.ts
│   ├── insights.ts
│   ├── push.ts
│   └── user.ts
├── services/
│   ├── aiService.ts   # Gemini AI integration
│   └── pushService.ts # Web Push notifications
├── types/
│   └── index.ts       # TypeScript types
└── index.ts           # Entry point
```
