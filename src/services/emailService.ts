import nodemailer from 'nodemailer';

// Create reusable transporter
let transporter: nodemailer.Transporter | null = null;

export function initializeEmailService(): void {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('⚠️ Email service not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env');
    console.warn('   Email verification will not work until configured.');
    return;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for other ports
    auth: {
      user,
      pass,
    },
  });

  // Verify connection
  transporter.verify((error) => {
    if (error) {
      console.error('❌ Email service connection failed:', error.message);
    } else {
      console.log('✅ Email service connected and ready');
    }
  });
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<boolean> {
  if (!transporter) {
    console.error('Email service not initialized');
    return false;
  }

  try {
    const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
    
    await transporter.sendMail({
      from: `"FlowMoney" <${fromEmail}>`,
      to: options.to,
      subject: options.subject,
      text: options.text || options.subject,
      html: options.html,
    });

    console.log(`📧 Email sent to ${options.to}: ${options.subject}`);
    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
}

// Email templates
export function getVerificationEmailTemplate(otp: string, userName?: string): { html: string; text: string } {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email - FlowMoney</title>
</head>
<body style="margin: 0; padding: 0; background-color: #000000; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 480px; width: 100%; border-collapse: collapse;">
          <!-- Logo/Header -->
          <tr>
            <td align="center" style="padding-bottom: 30px;">
              <h1 style="margin: 0; font-size: 32px; color: #ffffff;">
                💰 FlowMoney
              </h1>
            </td>
          </tr>
          
          <!-- Main Content -->
          <tr>
            <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; padding: 40px 30px;">
              <h2 style="margin: 0 0 20px; font-size: 24px; color: #ffffff; text-align: center;">
                Verify Your Email
              </h2>
              
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #a0aec0; text-align: center;">
                ${userName ? `Hi ${userName}! ` : ''}Thanks for signing up for FlowMoney. Enter this code to verify your email:
              </p>
              
              <!-- OTP Code -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <div style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 4px; border-radius: 16px;">
                      <div style="background: #1a1a2e; border-radius: 14px; padding: 20px 40px;">
                        <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #ffffff; font-family: 'Courier New', monospace;">
                          ${otp}
                        </span>
                      </div>
                    </div>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 20px 0 0; font-size: 14px; line-height: 1.6; color: #718096; text-align: center;">
                Enter this 6-digit code in the app to verify your account.
              </p>
              
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #2d3748;">
              
              <p style="margin: 0; font-size: 12px; color: #718096; text-align: center;">
                This code will expire in 10 minutes. If you didn't create an account, you can safely ignore this email.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top: 30px;">
              <p style="margin: 0; font-size: 12px; color: #4a5568;">
                © ${new Date().getFullYear()} FlowMoney. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  const text = `
FlowMoney - Verify Your Email

${userName ? `Hi ${userName}! ` : ''}Thanks for signing up for FlowMoney.

Your verification code is: ${otp}

Enter this 6-digit code in the app to verify your account.

This code will expire in 10 minutes.

If you didn't create an account, you can safely ignore this email.

© ${new Date().getFullYear()} FlowMoney
  `;

  return { html, text };
}

export function getPasswordResetEmailTemplate(resetUrl: string, userName?: string): { html: string; text: string } {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password - FlowMoney</title>
</head>
<body style="margin: 0; padding: 0; background-color: #000000; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 480px; width: 100%; border-collapse: collapse;">
          <!-- Logo/Header -->
          <tr>
            <td align="center" style="padding-bottom: 30px;">
              <h1 style="margin: 0; font-size: 32px; color: #ffffff;">
                💰 FlowMoney
              </h1>
            </td>
          </tr>
          
          <!-- Main Content -->
          <tr>
            <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; padding: 40px 30px;">
              <h2 style="margin: 0 0 20px; font-size: 24px; color: #ffffff; text-align: center;">
                Reset Your Password
              </h2>
              
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #a0aec0;">
                ${userName ? `Hi ${userName}! ` : ''}We received a request to reset your password. Click the button below to create a new password.
              </p>
              
              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="${resetUrl}" 
                       style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; padding: 14px 32px; border-radius: 12px; box-shadow: 0 4px 14px rgba(245, 158, 11, 0.4);">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 20px 0 0; font-size: 14px; line-height: 1.6; color: #718096;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin: 10px 0 0; font-size: 12px; color: #f59e0b; word-break: break-all;">
                ${resetUrl}
              </p>
              
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #2d3748;">
              
              <p style="margin: 0; font-size: 12px; color: #718096; text-align: center;">
                This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top: 30px;">
              <p style="margin: 0; font-size: 12px; color: #4a5568;">
                © ${new Date().getFullYear()} FlowMoney. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  const text = `
FlowMoney - Reset Your Password

${userName ? `Hi ${userName}! ` : ''}We received a request to reset your password.

Click this link to reset your password:
${resetUrl}

This link will expire in 1 hour.

If you didn't request a password reset, you can safely ignore this email.

© ${new Date().getFullYear()} FlowMoney
  `;

  return { html, text };
}
