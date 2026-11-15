const digits = (n: string) => n.replace(/[^\d]/g, "");

export const dialUrl = (n: string) => `tel:+${digits(n)}`;
export const whatsappUrl = (n: string) => `https://wa.me/${digits(n)}`;

const enc = encodeURIComponent;

export const mailtoUrl = (to: string, subject = "", body = "") =>
  `mailto:${to}?subject=${enc(subject)}&body=${enc(body)}`;

export const gmailUrl = (to: string, subject = "", body = "") =>
  `https://mail.google.com/mail/?view=cm&to=${enc(to)}&su=${enc(subject)}&body=${enc(body)}`;

export const outlookUrl = (to: string, subject = "", body = "") =>
  `https://outlook.live.com/mail/0/deeplink/compose?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`;

export const outlookWorkUrl = (to: string, subject = "", body = "") =>
  `https://outlook.office.com/mail/deeplink/compose?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`;