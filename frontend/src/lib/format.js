import { ethers } from "ethers";

export function fmtWei(wei, decimals = 18, precision = 6) {
  try {
    const s = ethers.formatUnits(wei, decimals);
    const [a, b = ""] = s.split(".");
    return b.length ? `${a}.${b.slice(0, precision)}` : a;
  } catch {
    return String(wei);
  }
}
