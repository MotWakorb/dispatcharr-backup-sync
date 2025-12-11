import nodemailer from 'nodemailer';
import type {
  NotificationProvider,
  NotificationProviderInput,
  NotificationEvent,
  NotificationGlobalSettings,
  SmtpConfig,
  TelegramConfig,
  DiscordConfig,
  SlackConfig,
} from '../types/notifications.js';
import { notificationStore } from './notificationStore.js';
import { jobManager } from './jobManager.js';
import type { JobLogEntry } from '../types/index.js';

interface SendResult {
  success: boolean;
  message: string;
  providerId: string;
  providerName: string;
}

class NotificationService {
  /**
   * Send notifications to all enabled providers
   */
  async notify(event: NotificationEvent): Promise<SendResult[]> {
    const settings = await notificationStore.getGlobalSettings();

    // Check if this event type should trigger notifications
    if (event.type === 'job_started' && !settings.notifyOnStart) return [];
    if (event.type === 'job_completed' && !settings.notifyOnComplete) return [];
    if (event.type === 'job_failed' && !settings.notifyOnFailure) return [];

    const providers = await notificationStore.getEnabledProviders();
    if (providers.length === 0) return [];

    const results: SendResult[] = [];

    for (const provider of providers) {
      try {
        await this.sendToProvider(provider, event, false, settings);
        results.push({
          success: true,
          message: 'Notification sent successfully',
          providerId: provider.id,
          providerName: provider.name,
        });
      } catch (error: any) {
        console.error(`Failed to send notification via ${provider.name}:`, error.message);
        results.push({
          success: false,
          message: error.message || 'Unknown error',
          providerId: provider.id,
          providerName: provider.name,
        });
      }
    }

    return results;
  }

  /**
   * Test a specific provider with a test message (by ID)
   */
  async testProvider(providerId: string): Promise<{ success: boolean; message: string }> {
    const provider = await notificationStore.getProviderById(providerId);
    if (!provider) {
      return { success: false, message: 'Provider not found' };
    }

    return this.testProviderConfig(provider);
  }

  /**
   * Test a provider config directly (without saving)
   */
  async testProviderConfig(input: NotificationProviderInput): Promise<{ success: boolean; message: string }> {
    const testEvent: NotificationEvent = {
      type: 'job_completed',
      scheduleName: 'Test Schedule',
      jobType: 'backup',
      jobId: 'TEST-' + Date.now(),
      timestamp: new Date().toISOString(),
      duration: 125000, // 2m 5s
    };

    // Create a temporary provider object for testing
    const tempProvider: NotificationProvider = {
      id: 'test',
      name: input.name,
      type: input.type,
      enabled: true,
      config: input.config,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await this.sendToProvider(tempProvider, testEvent, true);
      return { success: true, message: 'Test notification sent successfully' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Failed to send test notification' };
    }
  }

  private async sendToProvider(
    provider: NotificationProvider,
    event: NotificationEvent,
    isTest = false,
    settings?: NotificationGlobalSettings
  ): Promise<void> {
    switch (provider.type) {
      case 'smtp':
        await this.sendSmtp(provider.config as SmtpConfig, event, isTest, settings);
        break;
      case 'telegram':
        await this.sendTelegram(provider.config as TelegramConfig, event, isTest);
        break;
      case 'discord':
        await this.sendDiscord(provider.config as DiscordConfig, event, isTest);
        break;
      case 'slack':
        await this.sendSlack(provider.config as SlackConfig, event, isTest);
        break;
      default:
        throw new Error(`Unknown provider type: ${provider.type}`);
    }
  }

  private async sendSmtp(
    config: SmtpConfig,
    event: NotificationEvent,
    isTest: boolean,
    settings?: NotificationGlobalSettings
  ): Promise<void> {
    const transportConfig: any = {
      host: config.host,
      port: config.port || 25,
      secure: config.secure || false,
    };

    // Only add auth if username and password are provided
    if (config.username && config.password) {
      transportConfig.auth = {
        user: config.username,
        pass: config.password,
      };
    }

    const transporter = nodemailer.createTransport(transportConfig);

    // Fetch logs if setting is enabled and not a test
    let logs: JobLogEntry[] = [];
    if (!isTest && settings?.includeLogsInEmail && event.jobId) {
      logs = jobManager.getLogs(event.jobId);
    }

    const { subject, html } = this.formatEmail(event, isTest, logs);

    await transporter.sendMail({
      from: config.fromAddress,
      to: config.toAddress,
      subject,
      html,
    });
  }

  private async sendTelegram(config: TelegramConfig, event: NotificationEvent, isTest: boolean): Promise<void> {
    const message = this.formatTelegram(event, isTest);
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    if (!response.ok) {
      const error = await response.json() as { description?: string };
      throw new Error(error.description || `Telegram API error: ${response.status}`);
    }
  }

  private async sendDiscord(config: DiscordConfig, event: NotificationEvent, isTest: boolean): Promise<void> {
    const payload = this.formatDiscord(event, isTest);

    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Discord webhook error: ${response.status} - ${text}`);
    }
  }

  private async sendSlack(config: SlackConfig, event: NotificationEvent, isTest: boolean): Promise<void> {
    const payload = this.formatSlack(event, isTest);

    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Slack webhook error: ${response.status} - ${text}`);
    }
  }

  // Message formatting methods
  private getStatusEmoji(type: NotificationEvent['type']): string {
    switch (type) {
      case 'job_started':
        return '🚀';
      case 'job_completed':
        return '✅';
      case 'job_failed':
        return '❌';
    }
  }

  private getStatusText(type: NotificationEvent['type']): string {
    switch (type) {
      case 'job_started':
        return 'Started';
      case 'job_completed':
        return 'Completed';
      case 'job_failed':
        return 'Failed';
    }
  }

  private getStatusColor(type: NotificationEvent['type']): number {
    switch (type) {
      case 'job_started':
        return 0x3498db; // Blue
      case 'job_completed':
        return 0x57f287; // Green
      case 'job_failed':
        return 0xed4245; // Red
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  private formatEmail(event: NotificationEvent, isTest: boolean, logs: JobLogEntry[] = []): { subject: string; html: string } {
    const emoji = this.getStatusEmoji(event.type);
    const status = this.getStatusText(event.type);
    const jobType = event.jobType.charAt(0).toUpperCase() + event.jobType.slice(1);
    const testPrefix = isTest ? '[TEST] ' : '';

    const subject = `${testPrefix}[DBAS] ${jobType} ${status} - ${event.scheduleName}`;

    let html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: ${event.type === 'job_failed' ? '#ed4245' : event.type === 'job_completed' ? '#57f287' : '#3498db'};">
          ${emoji} ${jobType} ${status}
        </h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Schedule</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${event.scheduleName}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Job ID</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${event.jobId}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Time</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${new Date(event.timestamp).toLocaleString()}</td>
          </tr>`;

    if (event.duration) {
      html += `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Duration</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${this.formatDuration(event.duration)}</td>
          </tr>`;
    }

    if (event.error) {
      html += `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Error</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; color: #ed4245;">${event.error}</td>
          </tr>`;
    }

    html += `
        </table>`;

    // Include job logs if provided
    if (logs.length > 0) {
      html += `
        <h3 style="margin-top: 20px; color: #333;">Job Log</h3>
        <div style="background: #f5f5f5; padding: 12px; border-radius: 4px; font-family: monospace; font-size: 12px; max-height: 400px; overflow-y: auto;">`;

      for (const log of logs) {
        const time = new Date(log.timestamp).toLocaleTimeString();
        html += `<div style="margin-bottom: 4px;"><span style="color: #666;">[${time}]</span> ${this.escapeHtml(log.message)}</div>`;
      }

      html += `
        </div>`;
    }

    html += `
        <p style="margin-top: 20px; color: #666; font-size: 12px;">
          Sent by Dispatcharr Backup & Sync (DBAS)
        </p>
      </div>`;

    return { subject, html };
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private formatTelegram(event: NotificationEvent, isTest: boolean): string {
    const emoji = this.getStatusEmoji(event.type);
    const status = this.getStatusText(event.type);
    const jobType = event.jobType.charAt(0).toUpperCase() + event.jobType.slice(1);
    const testPrefix = isTest ? '🧪 *TEST* ' : '';

    let message = `${testPrefix}${emoji} *${jobType} ${status}*\n\n`;
    message += `📋 Schedule: ${event.scheduleName}\n`;
    message += `🆔 Job ID: \`${event.jobId}\`\n`;
    message += `🕐 Time: ${new Date(event.timestamp).toLocaleString()}\n`;

    if (event.duration) {
      message += `⏱ Duration: ${this.formatDuration(event.duration)}\n`;
    }

    if (event.error) {
      message += `\n⚠️ *Error:* ${event.error}`;
    }

    return message;
  }

  private formatDiscord(event: NotificationEvent, isTest: boolean): object {
    const emoji = this.getStatusEmoji(event.type);
    const status = this.getStatusText(event.type);
    const jobType = event.jobType.charAt(0).toUpperCase() + event.jobType.slice(1);
    const testPrefix = isTest ? '🧪 TEST: ' : '';

    const fields = [
      { name: 'Schedule', value: event.scheduleName, inline: true },
      { name: 'Job ID', value: event.jobId, inline: true },
    ];

    if (event.duration) {
      fields.push({ name: 'Duration', value: this.formatDuration(event.duration), inline: true });
    }

    if (event.error) {
      fields.push({ name: 'Error', value: event.error, inline: false });
    }

    return {
      embeds: [
        {
          title: `${testPrefix}${emoji} ${jobType} ${status}`,
          color: this.getStatusColor(event.type),
          fields,
          timestamp: event.timestamp,
          footer: {
            text: 'Dispatcharr Backup & Sync',
          },
        },
      ],
    };
  }

  private formatSlack(event: NotificationEvent, isTest: boolean): object {
    const emoji = this.getStatusEmoji(event.type);
    const status = this.getStatusText(event.type);
    const jobType = event.jobType.charAt(0).toUpperCase() + event.jobType.slice(1);
    const testPrefix = isTest ? '🧪 TEST: ' : '';

    const colorMap = {
      job_started: '#3498db',
      job_completed: '#57f287',
      job_failed: '#ed4245',
    };

    const fields = [
      { type: 'mrkdwn', text: `*Schedule:*\n${event.scheduleName}` },
      { type: 'mrkdwn', text: `*Job ID:*\n${event.jobId}` },
    ];

    if (event.duration) {
      fields.push({ type: 'mrkdwn', text: `*Duration:*\n${this.formatDuration(event.duration)}` });
    }

    const blocks: any[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${testPrefix}${emoji} ${jobType} ${status}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields,
      },
    ];

    if (event.error) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Error:*\n${event.error}`,
        },
      });
    }

    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Sent by Dispatcharr Backup & Sync | ${new Date(event.timestamp).toLocaleString()}`,
        },
      ],
    });

    return {
      attachments: [
        {
          color: colorMap[event.type],
          blocks,
        },
      ],
    };
  }
}

export const notificationService = new NotificationService();
