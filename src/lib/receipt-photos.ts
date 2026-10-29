import { allocate } from "./split";
import type { ParsedReceipt } from "./receipt.functions";

const TONIGHT = "tabsplit:tonight";

const readAsDataURL = (f: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });

/** Resize to max `max` px as JPEG. If it can't be decoded, return the original as a data URL. */
export async function resizeToDataURL(file: File, max: number): Promise<string> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return readAsDataURL(file);
  }
}

export function getTonight(): string[] {
  try { return (JSON.parse(localStorage.getItem(TONIGHT) ?? "[]") as string[]).slice(0, 4); } catch { return []; }
}
export async function saveTonight(files: File[]): Promise<string[]> {
  const urls = await Promise.all(files.slice(0, 4).map((f) => resizeToDataURL(f, 1280)));
  localStorage.setItem(TONIGHT, JSON.stringify(urls));
  return urls;
}

/** Rejects after `ms`. */
export function withTimeout<T>(p: Promise<T>, ms = 20_000): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

/** Quantities → one row per unit with leftover pennies spread; never negative. */
export function toUnitRows(p: ParsedReceipt): { name: string; price_pence: number }[] {
  const out: { name: string; price_pence: number }[] = [];
  for (const it of p.items) {
    const total = Math.round(Number(it.line_total_pence));
    if (!(total >= 0)) continue;
    const q = Math.max(1, Math.round(Number(it.quantity) || 1));
    const keys = Array.from({ length: q }, (_, i) => `u${String(i).padStart(4, "0")}`);
    const parts = allocate(total, Object.fromEntries(keys.map((k) => [k, 1])));
    for (const k of keys) out.push({ name: it.name, price_pence: parts[k] ?? 0 });
  }
  return out;
}
