const KEY = 'dsh-palm.account-phone';

/** Web 端没有 SecureStore，用 localStorage */
export async function loadAccountPhone(): Promise<string> {
  try {
    return typeof localStorage !== 'undefined' ? (localStorage.getItem(KEY) ?? '') : '';
  } catch {
    return '';
  }
}

export async function saveAccountPhone(value: string): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, value.trim());
  } catch {
    /* ignore */
  }
}
