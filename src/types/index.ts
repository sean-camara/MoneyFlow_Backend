// Database Models / Types for MongoDB Collections

export enum Currency {
  AED = 'AED', ARS = 'ARS', AUD = 'AUD', BDT = 'BDT', BRL = 'BRL',
  CAD = 'CAD', CHF = 'CHF', CLP = 'CLP', CNY = 'CNY', COP = 'COP',
  CZK = 'CZK', DKK = 'DKK', EGP = 'EGP', EUR = 'EUR', GBP = 'GBP',
  HKD = 'HKD', HUF = 'HUF', IDR = 'IDR', ILS = 'ILS', INR = 'INR',
  JPY = 'JPY', KRW = 'KRW', KWD = 'KWD', LKR = 'LKR', MAD = 'MAD',
  MXN = 'MXN', MYR = 'MYR', NGN = 'NGN', NOK = 'NOK', NZD = 'NZD',
  PEN = 'PEN', PHP = 'PHP', PKR = 'PKR', PLN = 'PLN', QAR = 'QAR',
  RON = 'RON', RUB = 'RUB', SAR = 'SAR', SEK = 'SEK', SGD = 'SGD',
  THB = 'THB', TRY = 'TRY', TWD = 'TWD', UAH = 'UAH', USD = 'USD',
  VND = 'VND', ZAR = 'ZAR'
}

export enum TransactionType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE'
}

export enum Category {
  FOOD = 'Food',
  TRANSPORT = 'Transport',
  HOUSING = 'Housing',
  FREELANCE = 'Freelance',
  SALARY = 'Salary',
  ENTERTAINMENT = 'Entertainment',
  TRAVEL = 'Travel',
  SHOPPING = 'Shopping',
  HEALTH = 'Health',
  INVESTMENT = 'Investment',
  OTHER = 'Other'
}

export enum JointAccountRole {
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER'
}

export enum InviteStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED'
}

// User document (extends Better Auth user)
export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image?: string;
  createdAt: Date;
  updatedAt: Date;
  // Extended fields
  primaryCurrency: Currency;
  notificationsEnabled: boolean;
  pushSubscription?: PushSubscriptionData;
}

// Push subscription data (supports both VAPID and FCM)
export interface PushSubscriptionData {
  // VAPID subscription fields
  endpoint?: string;
  keys?: {
    p256dh: string;
    auth: string;
  };
  // FCM token fields
  fcmToken?: string;
  platform?: string;
  // Type indicator
  type?: 'vapid' | 'fcm';
}

// Joint Account document
export interface JointAccount {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  primaryCurrency: Currency;
  adminUserId: string; // The user who created the account
}

// Joint Account Membership (links users to joint accounts)
export interface JointAccountMember {
  id: string;
  jointAccountId: string;
  userId: string;
  role: JointAccountRole;
  joinedAt: Date;
}

// Joint Account Invite
export interface JointAccountInvite {
  id: string;
  jointAccountId: string;
  invitedEmail: string;
  invitedByUserId: string;
  status: InviteStatus;
  createdAt: Date;
  expiresAt: Date;
}

// Transaction document
export interface Transaction {
  id: string;
  jointAccountId: string; // All transactions belong to a joint account
  amount: number;
  currency: Currency;
  type: TransactionType;
  category: Category | string;
  date: string; // ISO date string
  note?: string;
  // User tracking for joint accounts
  addedByUserId: string;
  addedByUserName: string;
  createdAt: Date;
  updatedAt: Date;
}

// Goal document
export interface Goal {
  id: string;
  jointAccountId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  currency: Currency;
  deadline?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Subscription (recurring bill) document
export interface Subscription {
  id: string;
  jointAccountId: string;
  name: string;
  amount: number;
  currency: Currency;
  cycle: 'Monthly' | 'Yearly';
  nextBillingDate: string;
  createdAt: Date;
  updatedAt: Date;
}

// Custom Category document
export interface CustomCategory {
  id: string;
  jointAccountId: string;
  name: string;
  createdAt: Date;
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Notification payload
export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  data?: Record<string, unknown>;
}
