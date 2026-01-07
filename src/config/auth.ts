import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { emailOTP } from 'better-auth/plugins';
import { getDb, getClient } from './database.js';
import { Currency } from '../types/index.js';
import { sendEmail, getVerificationEmailTemplate, getPasswordResetEmailTemplate } from '../services/emailService.js';

export function createAuth() {
  const db = getDb();
  const client = getClient();
  
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const requireVerification = process.env.REQUIRE_EMAIL_VERIFICATION === 'true';

  return betterAuth({
    database: mongodbAdapter(db, {
      client
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: requireVerification,
      sendResetPassword: async ({ user, url }) => {
        const template = getPasswordResetEmailTemplate(url, user.name);
        await sendEmail({
          to: user.email,
          subject: 'Reset Your FlowMoney Password',
          html: template.html,
          text: template.text,
        });
      },
    },
    account: {
      accountLinking: {
        enabled: true,
      },
    },
    plugins: [
      emailOTP({
        async sendVerificationOTP({ email, otp, type }) {
          // Get user name if available
          const usersCollection = db.collection('user');
          const user = await usersCollection.findOne({ email });
          const userName = user?.name;
          
          if (type === 'email-verification' || type === 'sign-in') {
            const template = getVerificationEmailTemplate(otp, userName);
            await sendEmail({
              to: email,
              subject: 'Your FlowMoney Verification Code',
              html: template.html,
              text: template.text,
            });
          }
        },
        otpLength: 6,
        expiresIn: 600, // 10 minutes
      }),
    ],
    user: {
      additionalFields: {
        primaryCurrency: {
          type: 'string',
          required: false,
          defaultValue: Currency.USD,
        },
        notificationsEnabled: {
          type: 'boolean',
          required: false,
          defaultValue: true,
        },
        pushSubscription: {
          type: 'string', // Stored as JSON string
          required: false,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes
      },
    },
    advanced: {
      crossSubDomainCookies: {
        enabled: true,
      },
      defaultCookieAttributes: {
        sameSite: 'none',
        secure: true,
        httpOnly: true,
        path: '/',
      },
    },
    trustedOrigins: [
      frontendUrl,
      'https://money-flow-six.vercel.app',
      'https://flowmoney-backend.onrender.com',
      'http://localhost:5173',
      'http://localhost:3000',
      // Vercel preview patterns - add common preview URL patterns
      'https://*.vercel.app',
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
