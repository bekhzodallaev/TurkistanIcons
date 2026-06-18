import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { Env } from '../config/env';

/**
 * Transactional email via Resend (docs/ROADMAP.md M2).
 * When RESEND_API_KEY is unset (local dev / CI) emails are logged instead of
 * sent, so the flows are fully exercisable without external credentials.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly webUrl: string;

  constructor(config: ConfigService<Env, true>) {
    const apiKey = config.get('RESEND_API_KEY', { infer: true });
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.from = config.get('MAIL_FROM', { infer: true });
    this.webUrl = config.get('WEB_URL', { infer: true });
  }

  async sendEmailVerification(to: string, token: string): Promise<void> {
    const link = `${this.webUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.send(
      to,
      'Verify your TurkistanIcons email',
      `<p>Welcome to TurkistanIcons! Confirm your email to activate your account.</p>
       <p><a href="${link}">Verify email</a></p>
       <p>This link expires in 24 hours. If you didn't sign up, ignore this email.</p>`,
    );
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    const link = `${this.webUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.send(
      to,
      'Reset your TurkistanIcons password',
      `<p>We received a request to reset your password.</p>
       <p><a href="${link}">Choose a new password</a></p>
       <p>This link expires in 1 hour. If you didn't request this, you can safely ignore it.</p>`,
    );
  }

  async sendCreatorApproved(to: string, slug: string): Promise<void> {
    const link = `${this.webUrl}/creators/${encodeURIComponent(slug)}`;
    await this.send(
      to,
      'Your TurkistanIcons creator application was approved',
      `<p>Congratulations — you're now a TurkistanIcons creator!</p>
       <p>Your public profile: <a href="${link}">${link}</a></p>
       <p>You can start uploading icons from your creator dashboard.</p>`,
    );
  }

  async sendCreatorRejected(to: string, reason: string): Promise<void> {
    await this.send(
      to,
      'Update on your TurkistanIcons creator application',
      `<p>Thanks for applying to become a TurkistanIcons creator.</p>
       <p>We're not able to approve your application at this time:</p>
       <blockquote>${reason}</blockquote>
       <p>You're welcome to address the feedback and apply again.</p>`,
    );
  }

  async sendIconApproved(to: string, iconName: string): Promise<void> {
    await this.send(
      to,
      `Your icon "${iconName}" was approved`,
      `<p>Good news — your icon <strong>${iconName}</strong> passed review and is now published on TurkistanIcons.</p>`,
    );
  }

  async sendIconRejected(to: string, iconName: string, reason: string): Promise<void> {
    await this.send(
      to,
      `Your icon "${iconName}" was not approved`,
      `<p>Your icon <strong>${iconName}</strong> was reviewed and could not be published:</p>
       <blockquote>${reason}</blockquote>
       <p>You're welcome to address the feedback and upload an updated version.</p>`,
    );
  }

  async sendIconChangesRequested(to: string, iconName: string, reason: string): Promise<void> {
    await this.send(
      to,
      `Changes requested for "${iconName}"`,
      `<p>A reviewer requested changes to your icon <strong>${iconName}</strong>:</p>
       <blockquote>${reason}</blockquote>
       <p>Please update it and it will be re-reviewed.</p>`,
    );
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.resend) {
      this.logger.log(`[dev mailer] to=${to} subject="${subject}"\n${html}`);
      return;
    }
    const { error } = await this.resend.emails.send({ from: this.from, to, subject, html });
    if (error) {
      // Don't leak provider internals to the caller; log and surface generically.
      this.logger.error(`Failed to send "${subject}" to ${to}: ${error.message}`);
      throw new Error('Failed to send email');
    }
  }
}
