const nodemailer = require('nodemailer');

// Create transporter - using environment variables for configuration
const createTransporter = () => {
  // Support for different email providers
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587');
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    console.warn('⚠️ SMTP credentials not configured. Email functionality will be disabled.');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
};

let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    transporter = createTransporter();
  }
  return transporter;
};

/**
 * Send password reset email
 * @param {string} to - Recipient email
 * @param {string} resetToken - The reset token
 * @param {string} userName - User's name for personalization
 */
const sendPasswordResetEmail = async (to, resetToken, userName = 'User') => {
  const transport = getTransporter();
  
  if (!transport) {
    console.log('📧 Email disabled - Reset token for', to, ':', resetToken);
    // In development without email config, we'll log the token
    return { success: true, message: 'Email disabled - check console for token' };
  }

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

  const mailOptions = {
    from: `"FlowMoney" <${process.env.SMTP_USER}>`,
    to,
    subject: 'Reset Your FlowMoney Password',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #09090b;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #09090b; padding: 40px 20px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 480px; background-color: #18181b; border-radius: 24px; border: 1px solid #27272a;">
                <tr>
                  <td style="padding: 40px;">
                    <!-- Logo -->
                    <div style="text-align: center; margin-bottom: 32px;">
                      <div style="display: inline-block; width: 64px; height: 64px; background: linear-gradient(135deg, #10B981 0%, #059669 100%); border-radius: 16px; line-height: 64px; text-align: center;">
                        <span style="font-size: 36px; font-weight: bold; color: #ffffff;">₱</span>
                      </div>
                      <h1 style="color: #ffffff; font-size: 24px; font-weight: bold; margin: 16px 0 0 0;">FlowMoney</h1>
                    </div>
                    
                    <!-- Content -->
                    <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
                      Hi ${userName},
                    </p>
                    <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                      We received a request to reset your password. Click the button below to create a new password:
                    </p>
                    
                    <!-- Button -->
                    <div style="text-align: center; margin: 32px 0;">
                      <a href="${resetUrl}" style="display: inline-block; padding: 14px 32px; background-color: #10b981; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 12px;">
                        Reset Password
                      </a>
                    </div>
                    
                    <p style="color: #71717a; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0;">
                      This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
                    </p>
                    
                    <p style="color: #71717a; font-size: 14px; line-height: 1.6; margin: 24px 0 0 0;">
                      If the button doesn't work, copy and paste this link into your browser:
                    </p>
                    <p style="color: #10b981; font-size: 12px; word-break: break-all; margin: 8px 0 0 0;">
                      ${resetUrl}
                    </p>
                    
                    <!-- Footer -->
                    <div style="border-top: 1px solid #27272a; margin-top: 32px; padding-top: 24px; text-align: center;">
                      <p style="color: #52525b; font-size: 12px; margin: 0;">
                        © ${new Date().getFullYear()} FlowMoney. All rights reserved.
                      </p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    text: `
      Hi ${userName},
      
      We received a request to reset your password. 
      
      Click the link below to create a new password:
      ${resetUrl}
      
      This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
      
      - FlowMoney Team
    `
  };

  try {
    await transport.sendMail(mailOptions);
    return { success: true };
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error('Failed to send email');
  }
};

/**
 * Send email verification code
 * @param {string} to - Recipient email
 * @param {string} code - 6-digit verification code
 * @param {string} userName - User's name for personalization
 */
const sendVerificationCodeEmail = async (to, code, userName = 'User') => {
  const transport = getTransporter();
  
  if (!transport) {
    console.log('📧 Email disabled - Verification code for', to, ':', code);
    return { success: true, message: 'Email disabled - check console for code' };
  }

  const mailOptions = {
    from: process.env.SMTP_FROM || `"FlowMoney" <${process.env.SMTP_USER}>`,
    to,
    subject: 'Verify Your FlowMoney Account',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #09090b;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #09090b; padding: 40px 20px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 480px; background-color: #18181b; border-radius: 24px; border: 1px solid #27272a;">
                <tr>
                  <td style="padding: 40px;">
                    <!-- Logo -->
                    <div style="text-align: center; margin-bottom: 32px;">
                      <div style="display: inline-block; width: 64px; height: 64px; background: linear-gradient(135deg, #10B981 0%, #059669 100%); border-radius: 16px; line-height: 64px; text-align: center;">
                        <span style="font-size: 36px; font-weight: bold; color: #ffffff;">₱</span>
                      </div>
                      <h1 style="color: #ffffff; font-size: 24px; font-weight: bold; margin: 16px 0 0 0;">FlowMoney</h1>
                    </div>
                    
                    <!-- Content -->
                    <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
                      Hi ${userName},
                    </p>
                    <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                      Welcome to FlowMoney! Please use the verification code below to complete your registration:
                    </p>
                    
                    <!-- Code -->
                    <div style="text-align: center; margin: 32px 0;">
                      <div style="display: inline-block; padding: 20px 40px; background-color: #09090b; border: 2px solid #10b981; border-radius: 16px;">
                        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #10b981;">${code}</span>
                      </div>
                    </div>
                    
                    <p style="color: #71717a; font-size: 14px; line-height: 1.6; margin: 0 0 16px 0; text-align: center;">
                      This code will expire in <strong style="color: #a1a1aa;">10 minutes</strong>.
                    </p>
                    
                    <p style="color: #71717a; font-size: 14px; line-height: 1.6; margin: 24px 0 0 0;">
                      If you didn't create an account with FlowMoney, you can safely ignore this email.
                    </p>
                    
                    <!-- Footer -->
                    <div style="border-top: 1px solid #27272a; margin-top: 32px; padding-top: 24px; text-align: center;">
                      <p style="color: #52525b; font-size: 12px; margin: 0;">
                        © ${new Date().getFullYear()} FlowMoney. All rights reserved.
                      </p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    text: `
      Hi ${userName},
      
      Welcome to FlowMoney! Please use the verification code below to complete your registration:
      
      ${code}
      
      This code will expire in 10 minutes.
      
      If you didn't create an account with FlowMoney, you can safely ignore this email.
      
      - FlowMoney Team
    `
  };

  try {
    await transport.sendMail(mailOptions);
    return { success: true };
  } catch (error) {
    console.error('Error sending verification email:', error);
    throw new Error('Failed to send verification email');
  }
};

/**
 * Send joint account invitation email
 * @param {string} to - Recipient email
 * @param {string} userName - Invitee's name
 * @param {string} inviterName - Name of the person who sent the invite
 * @param {string} accountName - Name of the joint account
 */
const sendJointAccountInviteEmail = async (to, userName = 'User', inviterName, accountName) => {
  const transport = getTransporter();
  
  if (!transport) {
    console.log('📧 Email disabled - Joint account invite for', to);
    return { success: true, message: 'Email disabled - check console' };
  }

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  const mailOptions = {
    from: process.env.SMTP_FROM || `"FlowMoney" <${process.env.SMTP_USER}>`,
    to,
    subject: `${inviterName} invited you to a joint account on FlowMoney`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #09090b;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #09090b; padding: 40px 20px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 480px; background-color: #18181b; border-radius: 24px; border: 1px solid #27272a;">
                <tr>
                  <td style="padding: 40px;">
                    <!-- Logo -->
                    <div style="text-align: center; margin-bottom: 32px;">
                      <div style="display: inline-block; width: 64px; height: 64px; background: linear-gradient(135deg, #10B981 0%, #059669 100%); border-radius: 16px; line-height: 64px; text-align: center;">
                        <span style="font-size: 36px; font-weight: bold; color: #ffffff;">₱</span>
                      </div>
                      <h1 style="color: #ffffff; font-size: 24px; font-weight: bold; margin: 16px 0 0 0;">FlowMoney</h1>
                    </div>
                    
                    <!-- Content -->
                    <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin: 0 0 16px 0;">
                      Hi ${userName},
                    </p>
                    <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                      <strong style="color: #ffffff;">${inviterName}</strong> has invited you to join a joint account called <strong style="color: #10b981;">"${accountName}"</strong> on FlowMoney.
                    </p>
                    
                    <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                      Joint accounts let you track shared expenses and income with family, friends, or partners. Visit FlowMoney to accept or decline this invitation.
                    </p>
                    
                    <!-- Button -->
                    <div style="text-align: center; margin: 32px 0;">
                      <a href="${frontendUrl}" style="display: inline-block; padding: 14px 32px; background-color: #10b981; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 12px;">
                        View Invitation
                      </a>
                    </div>
                    
                    <p style="color: #71717a; font-size: 14px; line-height: 1.6; margin: 24px 0 0 0; text-align: center;">
                      You can accept or decline this invitation from the notifications bell icon in the app.
                    </p>
                    
                    <!-- Footer -->
                    <div style="border-top: 1px solid #27272a; margin-top: 32px; padding-top: 24px; text-align: center;">
                      <p style="color: #52525b; font-size: 12px; margin: 0;">
                        © ${new Date().getFullYear()} FlowMoney. All rights reserved.
                      </p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    text: `
      Hi ${userName},
      
      ${inviterName} has invited you to join a joint account called "${accountName}" on FlowMoney.
      
      Joint accounts let you track shared expenses and income with family, friends, or partners.
      
      Visit ${frontendUrl} to accept or decline this invitation.
      
      - FlowMoney Team
    `
  };

  try {
    await transport.sendMail(mailOptions);
    return { success: true };
  } catch (error) {
    console.error('Error sending joint account invite email:', error);
    throw new Error('Failed to send invite email');
  }
};

module.exports = {
  sendPasswordResetEmail,
  sendVerificationCodeEmail,
  sendJointAccountInviteEmail,
};