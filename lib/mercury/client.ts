/**
 * Cliente mínimo de la API de Mercury (solo lectura). El token vive en `MERCURY_API_TOKEN`
 * (Vercel); nunca en el código ni en la base.
 * Docs: https://docs.mercury.com/reference
 */

export type MercuryAccount = {
  id: string;
  name: string;
  kind: string; // "checking" | "savings" | …
  status: string;
  currentBalance: number;
  availableBalance: number;
  accountNumber?: string;
};

export type MercuryTransaction = {
  id: string;
  amount: number; // dólares con signo
  status: "pending" | "sent" | "cancelled" | "failed" | "reversed" | "blocked";
  createdAt: string;
  postedAt: string | null;
  counterpartyName: string | null;
  bankDescription: string | null;
  note: string | null;
  kind: string;
};

export interface BankClient {
  accounts(): Promise<MercuryAccount[]>;
  transactions(accountId: string, start: string): Promise<MercuryTransaction[]>;
}

const BASE = "https://api.mercury.com/api/v1";

export function mercuryConfigured() {
  return !!process.env.MERCURY_API_TOKEN;
}

export function mercuryClient(token = process.env.MERCURY_API_TOKEN): BankClient {
  if (!token) throw new Error("Falta MERCURY_API_TOKEN en Vercel (Settings → Environment Variables).");
  const auth = `Bearer ${token.startsWith("secret-token:") ? token : `secret-token:${token}`}`;

  const get = async <T,>(path: string): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: auth, Accept: "application/json" }, cache: "no-store" });
    if (res.status === 401 || res.status === 403) throw new Error("Mercury rechazó el token. Revisa MERCURY_API_TOKEN (debe ser Read only y estar activo).");
    if (!res.ok) throw new Error(`Mercury respondió ${res.status}. Intenta de nuevo en unos minutos.`);
    return res.json() as Promise<T>;
  };

  return {
    async accounts() {
      const r = await get<{ accounts: MercuryAccount[] }>("/accounts");
      return r.accounts ?? [];
    },
    async transactions(accountId, start) {
      const out: MercuryTransaction[] = [];
      for (let offset = 0; offset < 20_000; offset += 500) {
        const r = await get<{ total: number; transactions: MercuryTransaction[] }>(
          `/account/${encodeURIComponent(accountId)}/transactions?start=${start}&limit=500&offset=${offset}&order=asc`
        );
        out.push(...(r.transactions ?? []));
        if (!r.transactions || r.transactions.length < 500) break;
      }
      return out;
    },
  };
}
