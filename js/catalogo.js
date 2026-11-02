import { supabase, configured } from "./db.js";
import { productPrice, fmt, waLink, round2 } from "./pricing.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

let settings = null, products = [], discount = 0, category = "", query = "";

// Código de referido (?ref=CODIGO): se recuerda en este dispositivo para que el cliente que compartió reciba el crédito
let ref = new URLSearchParams(location.search).get("ref") || "";
try { if (ref) localStorage.setItem("ref", ref); else ref = localStorage.getItem("ref") || ""; } catch {}
const cart = new Map(); // product_id -> qty

$$("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

async function init() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  if (!configured) { $("#subtitle").textContent = "Catálogo no configurado"; return; }

  const [s, p] = await Promise.all([
    supabase.from("settings").select("business_name, whatsapp, discount_levels").eq("id", 1).maybeSingle(),
    supabase.from("products").select("id, name, category, public_price, prices, image_url, images, description").eq("active", true).order("name"),
  ]);
  if (s.error || p.error) { $("#subtitle").textContent = "No se pudo cargar el catálogo"; return; }
  settings = s.data || { business_name: "Catálogo", whatsapp: "", discount_levels: [0] };
  products = p.data.map((x) => ({ ...x, public_price: Number(x.public_price), prices: x.prices || {} }));

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
    const price = productPrice(p, discount);
    const qty = cart.get(p.id) || 0;
    return `<div class="product-card">
      <div class="img" data-open="${p.id}">${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy">` : "🌿"}</div>
      <div class="body">
        <div class="name" data-open="${p.id}">${esc(p.name)}</div>
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
  bindQty($("#grid"));
  $$("[data-open]", $("#grid")).forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.open)));
  renderCartBar();
}

function bindQty(root) {
  $$("[data-inc]", root).forEach((b) => b.addEventListener("click", () => { changeQty(b.dataset.inc, +1); }));
  $$("[data-dec]", root).forEach((b) => b.addEventListener("click", () => { changeQty(b.dataset.dec, -1); }));
}
function changeQty(id, delta) {
  const n = (cart.get(id) || 0) + delta;
  if (n <= 0) cart.delete(id); else cart.set(id, n);
  renderGrid();
  if (detailId === id) renderDetailQty();
}

// ---- detalle de producto (galería + descripción) ----
let detailId = null;
function openDetail(id) {
  const p = products.find((x) => x.id === id);
  if (!p) return;
  detailId = id;
  const imgs = p.images?.length ? p.images : (p.image_url ? [p.image_url] : []);
  $("#pdName").textContent = p.name;
  $("#pdGallery").innerHTML = imgs.length
    ? imgs.map((u) => `<img src="${esc(u)}" alt="${esc(p.name)}">`).join("")
    : `<div class="noimg">🌿</div>`;
  $("#pdDots").innerHTML = imgs.length > 1 ? imgs.map((_, i) => `<span class="${i === 0 ? "on" : ""}"></span>`).join("") : "";
  $("#pdGallery").scrollLeft = 0;
  $("#pdOld").textContent = discount > 0 ? fmt(p.public_price) : "";
  $("#pdPrice").textContent = fmt(productPrice(p, discount));
  $("#pdDesc").textContent = p.description || "";
  renderDetailQty();
  $("#dlgProduct").showModal();
}
$("#pdGallery").addEventListener("scroll", () => {
  const g = $("#pdGallery");
  const i = Math.round(g.scrollLeft / g.clientWidth);
  $$("#pdDots span").forEach((d, k) => d.classList.toggle("on", k === i));
});
function renderDetailQty() {
  const qty = cart.get(detailId) || 0;
  $("#pdQty").innerHTML = qty > 0
    ? `<button data-dec="${detailId}">−</button><span>${qty}</span><button data-inc="${detailId}">+</button>`
    : `<button class="btn primary" data-inc="${detailId}">Agregar</button>`;
  bindQty($("#pdQty"));
}
$("#dlgProduct").addEventListener("close", () => { detailId = null; });

function cartItems() {
  return [...cart.entries()].map(([id, qty]) => {
    const p = products.find((x) => x.id === id);
    const unit = productPrice(p, discount);
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
  try { $("#buyerName").value = localStorage.getItem("buyerName") || ""; $("#buyerPhone").value = localStorage.getItem("buyerPhone") || ""; } catch {}
  $("#btnSend").disabled = false;
  $("#dlgCheckout").showModal();
});

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}

$("#btnSend").addEventListener("click", async () => {
  const name = $("#buyerName").value.trim();
  const phone = $("#buyerPhone").value.trim();
  if (!name) { $("#checkoutError").textContent = "Escribe tu nombre."; return; }
  $("#checkoutError").textContent = "";
  try { localStorage.setItem("buyerName", name); localStorage.setItem("buyerPhone", phone); } catch {}
  const btn = $("#btnSend"); btn.disabled = true;

  const items = cartItems();
  const total = round2(items.reduce((a, i) => a + i.subtotal, 0));
  const note = $("#buyerNote").value.trim();

  // 1) Registrar el pedido en la app del negocio (queda como "Pendiente")
  let number = null;
  const { data, error } = await supabase.rpc("crear_pedido_catalogo", {
    p_nombre: name, p_telefono: phone, p_nota: note, p_descuento: discount,
    p_items: items.map((i) => ({ product_id: i.id, qty: i.qty })),
    p_ref: ref || null,
  });
  if (error) console.error("No se pudo registrar el pedido:", error.message);
  else number = data;

  // 2) Abrir WhatsApp con el resumen
  const msg = `Hola, soy ${name} y quiero hacer este pedido${number ? ` (Pedido #${number})` : ""}:\n` +
    items.map((i) => `• ${i.qty} × ${i.name} — ${fmt(i.subtotal)}`).join("\n") +
    `\n\n*Total: ${fmt(total)}*` + (discount > 0 ? ` (con ${discount}% dto.)` : "") +
    (note ? `\nNota: ${note}` : "") + (phone ? `\nMi celular: ${phone}` : "");
  window.open(waLink(settings.whatsapp, msg), "_blank");

  if (number) {
    cart.clear(); renderGrid();
    $("#dlgCheckout").close();
    toast(`Pedido #${number} registrado. ¡Gracias!`);
  } else {
    btn.disabled = false;
    toast("No se pudo registrar el pedido automáticamente; envíalo por WhatsApp.");
  }
});

init();
