import nodemailer from 'nodemailer';

export function createEmailNotifier({
  smtpHost,
  smtpPort,
  smtpUser,
  smtpPass,
  fromEmail,
  toEmail,
  logger,
}) {
  const enabled = Boolean(smtpHost && smtpPort && fromEmail && toEmail);
  const log = logger;

  let transporter = null;
  if (enabled) {
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort),
      secure: Number(smtpPort) === 465,
      auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
    });
  }

  return {
    enabled,

    async notifyFishbowlFailure({ orderNumber, eventId, topic, shopDomain, errorMessage }) {
      if (!enabled) {
        log?.warn({ orderNumber, eventId, topic, shopDomain, errorMessage }, 'Email alerts disabled; skipping alert');
        return;
      }

      const subject = `Fishbowl fulfillment FAILED for Shopify order ${orderNumber}`;
      const text = [
        `Shopify → Fishbowl fulfillment failed.`,
        ``,
        `Order: ${orderNumber}`,
        `Shop: ${shopDomain ?? 'unknown'}`,
        `Topic: ${topic ?? 'unknown'}`,
        `Event ID: ${eventId ?? 'unknown'}`,
        ``,
        `Error:`,
        errorMessage ?? 'Unknown error',
      ].join('\n');

      await transporter.sendMail({
        from: fromEmail,
        to: toEmail,
        subject,
        text,
      });
    },
  };
}

