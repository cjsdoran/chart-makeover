// Number formats for the redraw (spec §9.2): the spec's Excel-style `numberFormat` ("0", "0.0",
// "#,##0", "0%", "£#,##0m") is used as is in the .pptx and applied here for the text boxes and the
// preview, so both show the same figures.

/**
 * Reads an Excel-style format. A percentage format on values that are already in percent (45, not
 * 0.45) becomes a literal "%" suffix, so Excel's "0%" doesn't show 4500%.
 * @param {string} code
 * @param {number[]} values the values it will format, to tell 0.45 from 45
 */
export function parseFormat(code, values = []) {
  const raw = String(code || '0');
  const unquoted = raw.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1');
  const first = unquoted.search(/[#0]/);
  const lastDigit = Math.max(unquoted.lastIndexOf('0'), unquoted.lastIndexOf('#'));
  const prefix = first > 0 ? unquoted.slice(0, first) : '';
  let suffix = lastDigit >= 0 ? unquoted.slice(lastDigit + 1) : '';
  const body = first >= 0 ? unquoted.slice(first, lastDigit + 1) : '0';
  const decimals = body.includes('.') ? (body.split('.')[1].match(/[0#]/g) ?? []).length : 0;
  const thousands = body.includes(',');
  let percent = suffix.includes('%');
  const maxAbs = Math.max(0, ...values.filter((v) => typeof v === 'number').map(Math.abs));
  let literalPercent = false;
  if (percent && maxAbs > 1.5) {
    literalPercent = true;
    percent = false;
  }
  if (percent) suffix = suffix.replace('%', '%');
  const excel = literalPercent
    ? `${prefix ? `"${prefix}"` : ''}${thousands ? '#,##0' : '0'}${decimals ? `.${'0'.repeat(decimals)}` : ''}"${suffix}"`
    : raw;
  return { prefix, suffix, decimals, thousands, percent, excel };
}

/** Formats a value with a parsed format. */
export function formatValue(value, fmt) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const v = fmt.percent ? value * 100 : value;
  const fixed = Math.abs(v).toFixed(fmt.decimals);
  const [int, dec] = fixed.split('.');
  const grouped = fmt.thousands ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int;
  const sign = v < 0 && Number(fixed) !== 0 ? '−' : '';
  return `${sign}${fmt.prefix}${grouped}${dec ? `.${dec}` : ''}${fmt.suffix}`;
}
