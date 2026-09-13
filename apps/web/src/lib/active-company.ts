/**
 * Which company the person is working in, when they belong to more than one.
 *
 * `loadMyCompanyId` used to answer `null` for anybody with two memberships, on
 * the reasoning that two is a question rather than a default. The reasoning was
 * sound and the consequence was not: nothing ever asked the question, and the
 * null traveled into the dashboard, the clock, the CRM and the estimate
 * screens, where it disabled buttons with no explanation. A person in two
 * companies could not refresh the forecast and could not clock in, and nothing
 * on screen said why.
 *
 * So the question is asked, and the answer is kept here. This is a per-browser
 * convenience, not an authority: every read and write is still restricted by
 * row level security to companies the caller belongs to, so a stale or forged
 * value in local storage can only ever select between companies they are
 * already a member of.
 */
const KEY = 'grounup.active-company';

export function rememberedCompany(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    /* Private browsing, or storage denied. A person who cannot store a choice
       still gets a working application — they get the first company. */
    return null;
  }
}

export function rememberCompany(companyId: string | null): void {
  try {
    if (companyId) localStorage.setItem(KEY, companyId);
    else localStorage.removeItem(KEY);
  } catch { /* as above */ }
}

/**
 * Choose between the companies somebody belongs to.
 *
 * Exported separately from the reader so it can be tested without a browser:
 * the rule is that a remembered choice wins only while it is still one of the
 * caller's companies, and otherwise the earliest one does. Falling back rather
 * than failing matters because a person removed from a company should land
 * somewhere rather than nowhere.
 */
export function chooseCompany(
  available: readonly string[], remembered: string | null,
): string | null {
  if (available.length === 0) return null;
  if (remembered && available.includes(remembered)) return remembered;
  return available[0]!;
}
