// Browser preview adapter. Native iOS and Android builds use client.ts with expo-sqlite.
export function getDatabase(): never {
  throw new Error('SQLite is not available in the browser preview');
}

export async function initializeDatabase(): Promise<void> {}
