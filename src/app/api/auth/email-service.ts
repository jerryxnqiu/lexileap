import { logger } from '@/libs/utils/logger'
import { getSecret } from '@/libs/firebase/secret'
import nodemailer from 'nodemailer'

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  try {
    // 1) Simple Gmail SMTP via App Password (preferred simple path)
    const [smtpEmail, smtpAppPassword] = await Promise.all([
      getSecret('gmail-smtp-email'),
      getSecret('gmail-smtp-password')
    ])

    if (smtpEmail && smtpAppPassword) {
      try {
        const transporter = nodemailer.createTransport({
          host: 'smtp.gmail.com',
          port: 465,
          secure: true,
          auth: { user: smtpEmail, pass: smtpAppPassword }
        })

        await transporter.sendMail({
          from: `"LexiLeap" <${smtpEmail}>`,
          to,
          subject,
          html
        })
        logger.info('Email sent via Gmail SMTP (app password):', { to })
        return true
      } catch (error) {
        logger.error('Gmail SMTP (app password) failed:', error instanceof Error ? error : new Error(String(error)))
        return false
      }
    }

    // No dev fallback: keep minimal
    return false
  } catch (error) {
    logger.error('Email service error:', error instanceof Error ? error : new Error(String(error)))
    return false
  }
}