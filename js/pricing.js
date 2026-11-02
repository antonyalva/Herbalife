// Cálculos de precios compartidos por la app y el catálogo

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Precio al que vendes con un % de descuento sobre el precio público. */
export const salePrice = (publicPrice, discountPct) =>
  round2(publicPrice * (1 - (Number(discountPct) || 0) / 100));

/** Lo que te cuesta a ti (precio público menos tu descuento de mayorista). */
export const costPrice = (publicPrice, costDiscountPct) =>
  round2(publicPrice * (1 - (Number(costDiscountPct) || 0) / 100));

/** Costo real de un producto: el que registraste, o el calculado con tu % de mayorista. */
export const productCost = (p, costDiscountPct) =>
  p.cost != null && p.cost !== "" ? round2(p.cost) : costPrice(p.public_price, costDiscountPct);

/** Precio de venta de un producto a un nivel de descuento: el fijado a mano, o el calculado. */
export const productPrice = (p, discountPct) => {
  const fixed = p.prices?.[String(discountPct)];
  return fixed != null && fixed !== "" ? round2(fixed) : salePrice(p.public_price, discountPct);
};

/** Formato en soles: S/ 1,234.50 */
export const fmt = (n) =>
  "S/ " + round2(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });

/** Totales de una lista de items [{qty, unit_price, unit_cost}] */
export function totals(items) {
  let total = 0, cost = 0;
  for (const it of items) {
    total += it.qty * it.unit_price;
    cost += it.qty * it.unit_cost;
  }
  total = round2(total);
  cost = round2(cost);
  return { total, cost, profit: round2(total - cost) };
}

/** Normaliza un teléfono peruano a formato internacional para wa.me */
export function waNumber(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.length === 9) d = "51" + d;
  return d;
}

export function waLink(phone, message) {
  const n = waNumber(phone);
  const base = n ? `https://wa.me/${n}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(message)}`;
}
