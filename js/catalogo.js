import { supabase, configured } from "./db.js";
import { salePrice, fmt, waLink, round2 } from "./pricing.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

let settings = null, products = [], discount = 0, category = "", query = "";
const cart = new Map(); // product_id -> qty

$$("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

async function init() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  if (!configured) { $("#subtitle").textContent = "Catálogo no configurado"; return; }

  const [s, p] = await Promise.all([
    supabase.from("settings").select("business_name, whatsapp, discount_levels").eq("id", 1).maybeSingle(),
    supabase.from("products").select("id, name, category, public_price, image_url").eq("active", true).order("name"),
  ]);
  if (s.error || p.error) { $("#subtitle").textContent = "No se pudo cargar el catálogo"; return; }
  settings = s.data || { business_name: "Catálogo", whatsapp: "", discount_levels: [0] };
  products = p.data.map((x) => ({ ...x, public_price: Number(x.public_price) }));

  const d = Number(new URLSearchParams(location.search).get("d"));
  discount = settings.discount_levels.includes(d) ? d : 0;

  document.title = settings.business_name;
  $("#title").textContent = settings.business_name;
  $("#subtitle").textContent = discount > 0 ? `Precios con ${discount}% de descuento para ti` : "Catálogo de productos";

  const cats = [...new Set(products.map((x) => x.category).filter(Boolean))].sort();
  $("#categories").innerHTML = cats.length
    ? [`<button class="chip active" data-cat="">Todos</button>`, ...cats.map((c) => `<button class="chip" data-cat="${esc(c)}">${esc(c)}</button>`)].join("")
    : "";
  $$(".chip").forEach((b) => b.addEventListener("click", () => {
    category = b.dataset.cat; $$(".chip").forEach((x) => x.classList.toggle("active", x === b)); renderGrid();
  }));
  $("#search").addEventListener("input", (e) => { query = e.target.value; renderGrid(); });
  renderGrid();
}

function renderGrid() {
  const q = norm(query);
  const list = products.filter((p) => (!category || p.category === category) && (!q || norm(p.name).includes(q)));
  $("#empty").classList.toggle("hidden", list.length > 0);
  $("#grid").innerHTML = list.map((p) => {
    const price = salePrice(p.public_price, discount);
    const qty = cart.get(p.id) || 0;
    return `<div class="product-card">
      <div class="img">${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy">` : "🌿"}</div>
      <div class="body">
        <div class="name">${esc(p.name)}</div>
        ${discount > 0 ? `<div class="old">${fmt(p.public_price)}</div>` : ""}
        <div class="price">${fmt(price)}</div>
        <div class="qty">
          ${qty > 0
            ? `<button data-dec="${p.id}">−</button><span>${qty}</span><button data-inc="${p.id}">+</button>`
            : `<button class="btn sm primary" data-inc="${p.id}" style="width:100%">Agregar</button>`}
        </div>
      </div>
    </div>`;
  }).join("");
  $$("[data-inc]").forEach((b) => b.addEventListener("click", () => { cart.set(b.dataset.inc, (cart.get(b.dataset.inc) || 0) + 1); renderGrid(); }));
  $$("[data-dec]").forEach((b) => b.addEventListener("click", () => {
    const n = (cart.get(b.dataset.dec) || 0) - 1;
    if (n <= 0) cart.delete(b.dataset.dec); else cart.set(b.dataset.dec, n);
    renderGrid();
  }));
  renderCartBar();
}

function cartItems() {
  return [...cart.entries()].map(([id, qty]) => {
    const p = products.find((x) => x.id === id);
    const unit = salePrice(p.public_price, discount);
    return { ...p, qty, unit, subtotal: round2(qty * unit) };
  });
}

function renderCartBar() {
  const items = cartItems();
  const n = items.reduce((a, i) => a + i.qty, 0);
  const total = round2(items.reduce((a, i) => a + i.subtotal, 0));
  $("#cartbar").classList.toggle("hidden", n === 0);
  $("#cartCount").textContent = `${n} producto${n === 1 ? "" : "s"}`;
  $("#cartTotal").textContent = fmt(total);
}

$("#btnCheckout").addEventListener("click", () => {
  const items = cartItems();
  const total = round2(items.reduce((a, i) => a + i.subtotal, 0));
  $("#checkoutItems").innerHTML = items.map((i) => `<div class="item-line">
    <div class="grow"><div>${esc(i.name)}</div><div class="muted">${i.qty} × ${fmt(i.unit)}</div></div><div class="bold">${fmt(i.subtotal)}</div></div>`).join("");
  $("#checkoutTotals").innerHTML = `<div class="row between grand" style="border:0;margin:0;padding:0"><span>Total</span><span>${fmt(total)}</span></div>`;
  $("#checkoutError").textContent = "";
  try { $("#buyerName").value = localStorage.getItem("buyerName") || ""; } catch {}
  $("#dlgCheckout").showModal();
});

$("#btnSend").addEventListener("click", () => {
  const name = $("#buyerName").value.trim();
  if (!name) { $("#checkoutError").textContent = "Escribe tu nombre."; return; }
  try { localStorage.setItem("buyerName", name); } catch {}
  const items = cartItems();
  const total = round2(items.reduce((a, i) => a + i.subtotal, 0));
  const note = $("#buyerNote").value.trim();
  const msg = `Hola, soy ${name} y quiero hacer este pedido:\n` +
    items.map((i) => `• ${i.qty} × ${i.name} — ${fmt(i.subtotal)}`).join("\n") +
    `\n\n*Total: ${fmt(total)}*` + (discount > 0 ? ` (con ${discount}% dto.)` : "") +
    (note ? `\nNota: ${note}` : "");
  window.open(waLink(settings.whatsapp, msg), "_blank");
});

init();
