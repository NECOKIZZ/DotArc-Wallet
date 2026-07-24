import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserWalletTokenBalances } from "@/lib/circle";

export const runtime = "nodejs";

/**
 * GET /api/wallet/balance
 *
 * Server-side read of the signed-in user's main-wallet token balances.
 *
 * The agent wallet already reads balances from Circle. The main wallet used an
 * independent Arc RPC call, which can fail or be CORS-blocked while Circle is
 * healthy; its failure was then rendered as a real $0 balance. Use Circle's
 * user-controlled-wallet balance API here as well, and return an error on a
 * failed read rather than manufacturing a zero balance.
 */

const USDC_ADDRESS =
  process.env.NEXT_PUBLIC_USDC_TOKEN_ADDRESS ||
  "0x3600000000000000000000000000000000000000";
const EURC_ADDRESS = process.env.NEXT_PUBLIC_EURC_TOKEN_ADDRESS || "";
const CIRBTC_ADDRESS = process.env.NEXT_PUBLIC_CIRBTC_TOKEN_ADDRESS || "";

// Display-only USD rates (not used for money math).
const TOKEN_USD_RATES: Record<string, number> = {
  USDC: 1.0,
  EURC: 1.08,
  cirBTC: 100_000,
};

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const configuredTokens = [
    { symbol: "USDC", name: "USD Coin", address: USDC_ADDRESS },
    ...(EURC_ADDRESS ? [{ symbol: "EURC", name: "Euro Coin", address: EURC_ADDRESS }] : []),
    ...(CIRBTC_ADDRESS ? [{ symbol: "cirBTC", name: "Circle BTC", address: CIRBTC_ADDRESS }] : []),
  ];

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawBalances = await getUserWalletTokenBalances(session.userId) as any[];
    const byAddress = new Map(
      rawBalances
        .filter((balance) => balance?.token?.tokenAddress)
        .map((balance) => [String(balance.token.tokenAddress).toLowerCase(), balance]),
    );
    const bySymbol = new Map(
      rawBalances
        .filter((balance) => balance?.token?.symbol)
        .map((balance) => [String(balance.token.symbol).toUpperCase(), balance]),
    );

    // Circle omits zero-balance assets. We add the configured assets back so
    // the UI remains stable, but only after a successful Circle read.
    const tokenBalances = configuredTokens.map((token) => {
      const raw = byAddress.get(token.address.toLowerCase()) ?? bySymbol.get(token.symbol.toUpperCase());
      const amount = typeof raw?.amount === "string" ? raw.amount : "0";
      const decimals = Number(raw?.token?.decimals ?? 6);
      return {
        ...token,
        amount,
        decimals: Number.isFinite(decimals) ? decimals : 6,
        usdValue: (parseFloat(amount) || 0) * (TOKEN_USD_RATES[token.symbol] ?? 0),
      };
    });

    const usdc = tokenBalances.find((b) => b.symbol === "USDC");

    return NextResponse.json({
      address: session.walletAddress,
      balanceUsdc: usdc?.amount ?? "0",
      tokenBalances,
      source: "circle",
    });
  } catch (err) {
    console.error("[wallet/balance] Circle balance read failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Couldn't refresh your wallet balance. Please try again shortly." },
      { status: 503 },
    );
  }
}
