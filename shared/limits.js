// Limits and app settings shared by the browser and the functions.
// Values live in config/app.json so Chris can change them without touching code.
import appConfig from '../config/app.json' with { type: 'json' };

export const config = appConfig;
export const limits = appConfig.limits;

export const MESSAGES = {
  badAccessCode: "That access code isn't recognised. Check Canvas.",
  tooLarge: 'That request is too large. Upload a smaller chart and try again.',
  badRequest: 'Something went wrong sending your work. Try again.',
  notImplemented: 'This step is not available yet.',
  serverMisconfigured: 'Chart Makeover is not set up correctly. Tell your instructor.',
};

/** Footer disclaimer on every screen and the record (spec §1). */
export function footerText() {
  return appConfig.record.footer;
}

/** The student's first name, for greetings: "Hi Chris,". Before setup, just "Hi,". */
export function greeting(name) {
  const first = String(name ?? '').trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : 'Hi,';
}
