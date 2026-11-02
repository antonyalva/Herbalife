import { supabase, configured } from "./db.js";
import { salePrice, costPrice, productCost, productPrice, fmt, fmtDate, totals, waLink, round2 } from "./pricing.js";

// ---------- utilidades ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

const state = {
  settings: null,
  products: [],
  customers: [],
  orders: [],
  view: "pedidos",
  orderFilter: "todos",
  search: { clientes: "", productos: "" },
  draft: null,
};

const STATUS_LABEL = { pendiente: "Pendiente", entregado: "Entregado", pagado: "Pagado", cancelado: "Cancelado" };

// ---------- arranque ----------
async function init() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  if (!configured) { $("#setup").classList.remove("hidden"); return; }

  const { data: { session } } = await supabase.auth.getSession();
  if (session) await enterApp(); else showLogin();

  supabase.auth.onAuthStateChange((_event, s) => { if (!s) showLogin(); });

  // Al volver a la app (p. ej. después de WhatsApp) se recargan los datos: así aparecen los pedidos del catálogo
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
}

let refreshing = false;
async function refresh() {
  if (refreshing || $("#app").classList.contains("hidden")) return;
  refreshing = true;
  try { await loadAll(); render(); } catch (e) { console.error(e); }
  refreshing = false;
}
$("#btnRefresh").addEventListener("click", async () => { await refresh(); toast("Actualizado"); });

function showLogin() {
  $("#app").classList.add("hidden");
  $("#login").classList.remove("hidden");
}

$("#togglePw").addEventListener("click", (e) => {
  const inp = $("#loginForm [name=password]");
  const show = inp.type === "password";
  inp.type = show ? "text" : "password";
  e.currentTarget.textContent = show ? "🙈" : "👁️";
  e.currentTarget.setAttribute("aria-pressed", String(show));
  e.currentTarget.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
  inp.focus();
});

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = $("button[type=submit]", f);
  btn.disabled = true; $("#loginError").textContent = "";
  const { error } = await supabase.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  btn.disabled = false;
  if (error) { $("#loginError").textContent = "Correo o contraseña incorrectos."; return; }
  f.reset();
  await enterApp();
});

async function enterApp() {
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  try {
    await loadAll();
  } catch (err) {
    console.error(err);
    toast("Error al cargar datos: " + (err.message || err));
  }
  render();
}

async function loadAll() {
  const [s, p, c, o] = await Promise.all([
    supabase.from("settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("products").select("*").order("name"),
    supabase.from("customers").select("*").order("name"),
    supabase.from("orders").select("*, order_items(*)").order("created_at", { ascending: false }),
  ]);
  for (const r of [s, p, c, o]) if (r.error) throw r.error;

  if (!s.data) {
    const ins = await supabase.from("settings").insert({ id: 1 }).select().single();
    if (ins.error) throw ins.error;
    state.settings = ins.data;
  } else state.settings = s.data;

  state.products = p.data.map(numProduct);
  state.customers = c.data;
  state.orders = o.data.map(numOrder);
}
const numProduct = (p) => ({ ...p, public_price: Number(p.public_price), cost: p.cost == null ? null : Number(p.cost), prices: p.prices || {} });
const numOrder = (o) => ({
  ...o, total: Number(o.total), cost: Number(o.cost),
  order_items: (o.order_items || []).map((i) => ({ ...i, public_price: Number(i.public_price), unit_price: Number(i.unit_price), unit_cost: Number(i.unit_cost) })),
});

const levels = () => state.settings?.discount_levels || [35, 20, 10, 0];
const costPct = () => state.settings?.cost_discount_pct ?? 50;

// ---------- navegación ----------
$$(".tabbar button").forEach((b) => b.addEventListener("click", () => {
  state.view = b.dataset.view;
  $$(".tabbar button").forEach((x) => x.classList.toggle("active", x === b));
  render();
}));

$("#fab").addEventListener("click", () => {
  if (state.view === "pedidos") openOrderDialog();
  if (state.view === "clientes") openCustomerDialog();
  if (state.view === "productos") openProductDialog();
});

$$("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

function render() {
  const titles = { pedidos: "Pedidos", clientes: "Clientes", productos: "Productos", ajustes: "Ajustes" };
  $("#title").textContent = titles[state.view];
  $("#subtitle").textContent = state.settings?.business_name || "";
  $("#fab").classList.toggle("hidden", state.view === "ajustes");
  ({ pedidos: renderOrders, clientes: renderCustomers, productos: renderProducts, ajustes: renderSettings })[state.view]();
}

// =====================================================================
//  PEDIDOS
// =====================================================================
function renderOrders() {
  const now = new Date();
  const thisMonth = state.orders.filter((o) => {
    const d = new Date(o.created_at);
    return o.status !== "cancelado" && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const ventas = round2(thisMonth.reduce((a, o) => a + o.total, 0));
  const ganancia = round2(thisMonth.reduce((a, o) => a + (o.total - o.cost), 0));
  const porCobrar = round2(state.orders.filter((o) => o.status === "pendiente" || o.status === "entregado").reduce((a, o) => a + o.total, 0));

  const list = state.orders.filter((o) => state.orderFilter === "todos" || o.status === state.orderFilter);
  const filters = ["todos", "pendiente", "entregado", "pagado", "cancelado"];

  $("#view").innerHTML = `
    <div class="stats">
      <div class="stat"><div class="label">Ventas del mes</div><div class="value">${fmt(ventas)}</div></div>
      <div class="stat"><div class="label">Ganancia</div><div class="value profit">${fmt(ganancia)}</div></div>
      <div class="stat"><div class="label">Por cobrar</div><div class="value" style="color:var(--warn)">${fmt(porCobrar)}</div></div>
    </div>
    <div class="chips">${filters.map((f) => `<button class="chip ${state.orderFilter === f ? "active" : ""}" data-f="${f}">${f === "todos" ? "Todos" : STATUS_LABEL[f]}</button>`).join("")}</div>
    ${list.length ? list.map(orderCard).join("") : `<div class="empty"><div class="big">🧾</div>No hay pedidos${state.orderFilter !== "todos" ? " con este estado" : ". Toca + para crear el primero"}.</div>`}
  `;
  $$(".chip", $("#view")).forEach((c) => c.addEventListener("click", () => { state.orderFilter = c.dataset.f; renderOrders(); }));
  $$("[data-order]", $("#view")).forEach((c) => c.addEventListener("click", () => openOrderDetail(c.dataset.order)));
}

const referrerName = (o) => o.referred_by ? (state.customers.find((c) => c.id === o.referred_by)?.name || "cliente eliminado") : "";

function orderCard(o) {
  const n = o.order_items.reduce((a, i) => a + i.qty, 0);
  return `<div class="card tap" data-order="${o.id}">
    <div class="row between">
      <div class="grow">
        <div class="bold ellipsis">${o.number ? `<span class="muted">#${o.number}</span> ` : ""}${esc(o.customer_name || "Sin cliente")}</div>
        <div class="muted">${fmtDate(o.created_at)} · ${n} producto${n === 1 ? "" : "s"} · ${o.discount_pct}% dto.${o.source === "catalogo" ? ' · <span class="badge catalogo">Catálogo</span>' : ""}</div>
        ${o.referred_by ? `<div class="muted small">🔗 Referido por ${esc(referrerName(o))}</div>` : ""}
      </div>
      <div class="right">
        <div class="price">${fmt(o.total)}</div>
        <span class="badge ${o.status}">${STATUS_LABEL[o.status]}</span>
      </div>
    </div>
    <div class="muted small mt" style="margin-top:6px">Ganancia: <span class="profit">${fmt(o.total - o.cost)}</span></div>
  </div>`;
}

// ---- nuevo pedido ----
function openOrderDialog() {
  if (!state.products.length) { toast("Primero registra productos"); return; }
  state.draft = { customer_id: "", discount_pct: levels()[0], items: [], note: "" };
  fillCustomerSelect();
  fillDiscountSelect($("#orderDiscount"), state.draft.discount_pct);
  $("#orderSearch").value = "";
  $("#orderNote").value = "";
  $("#orderError").textContent = "";
  renderOrderPicker();
  renderOrderItems();
  $("#dlgOrder").showModal();
}

function fillCustomerSelect(selectedId) {
  const sel = $("#orderCustomer");
  sel.innerHTML = `<option value="">— Elegir cliente —</option>` +
    state.customers.map((c) => `<option value="${c.id}" data-d="${c.discount_pct}">${esc(c.name)} (${c.discount_pct}%)</option>`).join("");
  sel.value = selectedId || state.draft.customer_id || "";
}

function fillDiscountSelect(sel, value) {
  const lv = [...new Set([...levels(), Number(value)])].sort((a, b) => b - a);
  sel.innerHTML = lv.map((d) => `<option value="${d}">${d}% de descuento${d === 0 ? " (precio público)" : ""}</option>`).join("");
  sel.value = String(value);
}

$("#orderCustomer").addEventListener("change", (e) => {
  state.draft.customer_id = e.target.value;
  const c = state.customers.find((x) => x.id === e.target.value);
  if (c) { state.draft.discount_pct = c.discount_pct; fillDiscountSelect($("#orderDiscount"), c.discount_pct); renderOrderItems(); }
});
$("#orderDiscount").addEventListener("change", (e) => { state.draft.discount_pct = Number(e.target.value); renderOrderItems(); });
$("#orderSearch").addEventListener("input", renderOrderPicker);
$("#btnQuickCustomer").addEventListener("click", () => openCustomerDialog(null, true));

function renderOrderPicker() {
  const q = norm($("#orderSearch").value);
  const list = state.products.filter((p) => p.active && (!q || norm(p.name).includes(q) || norm(p.category).includes(q))).slice(0, 30);
  $("#orderPicker").innerHTML = list.length
    ? list.map((p) => `<button type="button" data-add="${p.id}"><span>${esc(p.name)}</span><span class="muted">${fmt(productPrice(p, state.draft.discount_pct))}</span></button>`).join("")
    : `<div class="muted" style="padding:10px 12px">Sin resultados</div>`;
  $$("[data-add]", $("#orderPicker")).forEach((b) => b.addEventListener("click", () => addDraftItem(b.dataset.add)));
}

function addDraftItem(productId) {
  const p = state.products.find((x) => x.id === productId);
  const ex = state.draft.items.find((i) => i.product_id === productId);
  if (ex) ex.qty++;
  else state.draft.items.push({ product_id: p.id, product_name: p.name, public_price: p.public_price, cost: p.cost, prices: p.prices, qty: 1 });
  renderOrderItems();
}

function draftComputed() {
  const d = state.draft.discount_pct;
  const items = state.draft.items.map((i) => ({ ...i, unit_price: productPrice(i, d), unit_cost: productCost(i, costPct()) }));
  return { items, ...totals(items) };
}

function renderOrderItems() {
  const { items, total, cost, profit } = draftComputed();
  $("#orderItems").innerHTML = items.length
    ? items.map((i, idx) => `<div class="item-line">
        <div class="grow"><div class="ellipsis">${esc(i.product_name)}</div><div class="muted">${fmt(i.unit_price)} c/u</div></div>
        <div class="qty"><button type="button" data-dec="${idx}">−</button><span>${i.qty}</span><button type="button" data-inc="${idx}">+</button></div>
        <div class="bold" style="min-width:80px;text-align:right">${fmt(i.qty * i.unit_price)}</div>
      </div>`).join("")
    : `<p class="muted">Toca un producto de la lista para agregarlo.</p>`;
  $("#orderTotals").innerHTML = `
    <div class="row between"><span class="muted">Tu costo</span><span>${fmt(cost)}</span></div>
    <div class="row between"><span class="muted">Tu ganancia</span><span class="profit">${fmt(profit)}</span></div>
    <div class="row between grand"><span>Total cliente</span><span>${fmt(total)}</span></div>`;
  $$("[data-inc]", $("#orderItems")).forEach((b) => b.addEventListener("click", () => { state.draft.items[+b.dataset.inc].qty++; renderOrderItems(); }));
  $$("[data-dec]", $("#orderItems")).forEach((b) => b.addEventListener("click", () => {
    const it = state.draft.items[+b.dataset.dec];
    it.qty--; if (it.qty <= 0) state.draft.items.splice(+b.dataset.dec, 1);
    renderOrderItems();
  }));
  renderOrderPicker();
}

$("#btnSaveOrder").addEventListener("click", async () => {
  const err = $("#orderError"); err.textContent = "";
  const cust = state.customers.find((c) => c.id === $("#orderCustomer").value);
  if (!cust) { err.textContent = "Elige un cliente."; return; }
  if (!state.draft.items.length) { err.textContent = "Agrega al menos un producto."; return; }
  const btn = $("#btnSaveOrder"); btn.disabled = true;
  const { items, total, cost } = draftComputed();
  try {
    const { data: order, error } = await supabase.from("orders").insert({
      customer_id: cust.id, customer_name: cust.name, discount_pct: state.draft.discount_pct,
      note: $("#orderNote").value.trim(), total, cost,
    }).select().single();
    if (error) throw error;
    const rows = items.map((i) => ({ order_id: order.id, product_id: i.product_id, product_name: i.product_name, qty: i.qty, public_price: i.public_price, unit_price: i.unit_price, unit_cost: i.unit_cost }));
    const { error: e2 } = await supabase.from("order_items").insert(rows);
    if (e2) throw e2;
    state.orders.unshift(numOrder({ ...order, order_items: rows }));
    $("#dlgOrder").close();
    toast("Pedido guardado");
    renderOrders();
  } catch (e) { err.textContent = "No se pudo guardar: " + e.message; }
  btn.disabled = false;
});

// ---- detalle pedido ----
function openOrderDetail(id) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return;
  const cust = state.customers.find((c) => c.id === o.customer_id);
  const body = $("#orderDetailBody");
  const phone = cust?.phone || o.customer_phone || "";
  body.innerHTML = `
    <div class="row between mb">
      <div>
        <div class="bold" style="font-size:17px">${o.number ? `<span class="muted">#${o.number}</span> ` : ""}${esc(o.customer_name || "Sin cliente")}</div>
        <div class="muted">${fmtDate(o.created_at)} · ${o.discount_pct}% dto.${o.source === "catalogo" ? ' · <span class="badge catalogo">Catálogo</span>' : ""}</div>
        ${phone ? `<div class="muted">📱 ${esc(phone)}</div>` : ""}
        ${o.referred_by ? `<div class="muted">🔗 Referido por <b>${esc(referrerName(o))}</b></div>` : ""}
      </div>
      <span class="badge ${o.status}">${STATUS_LABEL[o.status]}</span>
    </div>
    ${!cust && o.source === "catalogo" ? `<button class="btn sm block mb" id="btnSaveAsCustomer">＋ Guardar "${esc(o.customer_name)}" como cliente</button>` : ""}
    ${o.order_items.map((i) => `<div class="item-line">
      <div class="grow"><div>${esc(i.product_name)}</div><div class="muted">${i.qty} × ${fmt(i.unit_price)}</div></div>
      <div class="bold">${fmt(i.qty * i.unit_price)}</div></div>`).join("")}
    <div class="totals">
      <div class="row between"><span class="muted">Tu costo</span><span>${fmt(o.cost)}</span></div>
      <div class="row between"><span class="muted">Tu ganancia</span><span class="profit">${fmt(o.total - o.cost)}</span></div>
      <div class="row between grand"><span>Total</span><span>${fmt(o.total)}</span></div>
    </div>
    ${o.note ? `<p class="muted mt">📝 ${esc(o.note)}</p>` : ""}
    <label class="mt"><span>Cambiar estado</span>
      <select id="detailStatus">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${k === o.status ? "selected" : ""}>${v}</option>`).join("")}</select>
    </label>
    <div class="actions">
      <button class="btn wa" id="btnWaOrder">Enviar por WhatsApp</button>
      <button class="btn danger" id="btnDeleteOrder">Eliminar</button>
    </div>`;

  $("#detailStatus").addEventListener("change", async (e) => {
    const status = e.target.value;
    const { error } = await supabase.from("orders").update({ status }).eq("id", o.id);
    if (error) { toast("Error: " + error.message); return; }
    o.status = status; toast("Estado actualizado"); openOrderDetail(id); renderOrders();
  });
  $("#btnWaOrder").addEventListener("click", () => {
    const lines = o.order_items.map((i) => `• ${i.qty} × ${i.product_name} — ${fmt(i.qty * i.unit_price)}`);
    const msg = `Hola ${o.customer_name}, este es tu pedido${o.number ? ` #${o.number}` : ""}${state.settings.business_name ? " de " + state.settings.business_name : ""}:\n${lines.join("\n")}\n\n*Total: ${fmt(o.total)}*${o.note ? "\n" + o.note : ""}\n¡Gracias!`;
    window.open(waLink(phone, msg), "_blank");
  });
  $("#btnSaveAsCustomer")?.addEventListener("click", async () => {
    const { data, error } = await supabase.from("customers").insert({ name: o.customer_name, phone: o.customer_phone || "", discount_pct: o.discount_pct }).select().single();
    if (error) { toast("Error: " + error.message); return; }
    const { error: e2 } = await supabase.from("orders").update({ customer_id: data.id }).eq("id", o.id);
    if (e2) { toast("Error: " + e2.message); return; }
    state.customers.push(data); state.customers.sort((a, b) => a.name.localeCompare(b.name));
    o.customer_id = data.id;
    toast("Cliente guardado"); openOrderDetail(id);
  });
  $("#btnDeleteOrder").addEventListener("click", async () => {
    if (!confirm("¿Eliminar este pedido? No se puede deshacer.")) return;
    const { error } = await supabase.from("orders").delete().eq("id", o.id);
    if (error) { toast("Error: " + error.message); return; }
    state.orders = state.orders.filter((x) => x.id !== o.id);
    $("#dlgOrderDetail").close(); toast("Pedido eliminado"); renderOrders();
  });
  $("#dlgOrderDetail").showModal();
}

// =====================================================================
//  CLIENTES
// =====================================================================
function renderCustomers() {
  const q = norm(state.search.clientes);
  const list = state.customers.filter((c) => !q || norm(c.name).includes(q) || c.phone.includes(q));
  const pending = {};
  for (const o of state.orders) if (o.status === "pendiente" || o.status === "entregado") pending[o.customer_id] = (pending[o.customer_id] || 0) + o.total;
  const refs = referralStats();

  $("#view").innerHTML = `
    <input type="search" class="search" id="searchCustomers" placeholder="Buscar cliente…" value="${esc(state.search.clientes)}">
    ${list.length ? list.map((c) => `<div class="card tap" data-customer="${c.id}">
      <div class="row between">
        <div class="grow"><div class="bold ellipsis">${esc(c.name)}</div><div class="muted">${esc(c.phone) || "Sin teléfono"}${refs[c.id] ? ` · 🔗 Trajo ${refs[c.id].n} pedido${refs[c.id].n === 1 ? "" : "s"} (${fmt(refs[c.id].total)})` : ""}</div></div>
        <div class="right"><span class="badge">${c.discount_pct}% dto.</span>
          ${pending[c.id] ? `<div class="small mt" style="margin-top:4px;color:var(--warn)">Debe ${fmt(pending[c.id])}</div>` : ""}</div>
      </div></div>`).join("")
    : `<div class="empty"><div class="big">👥</div>${q ? "Sin resultados" : "Aún no tienes clientes. Toca + para agregar uno."}</div>`}`;

  const inp = $("#searchCustomers");
  inp.addEventListener("input", () => { state.search.clientes = inp.value; renderCustomers(); const i = $("#searchCustomers"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  $$("[data-customer]", $("#view")).forEach((c) => c.addEventListener("click", () => openCustomerDialog(c.dataset.customer)));
}

/** Pedidos traídos por cada cliente a través de su enlace (sin los cancelados) */
function referralStats() {
  const refs = {};
  for (const o of state.orders) if (o.referred_by && o.status !== "cancelado") {
    refs[o.referred_by] = refs[o.referred_by] || { n: 0, total: 0 };
    refs[o.referred_by].n++; refs[o.referred_by].total = round2(refs[o.referred_by].total + o.total);
  }
  return refs;
}
function refUrl(c) {
  const u = new URL("catalogo.html", location.href);
  u.searchParams.set("ref", c.ref_code);
  return u.href;
}

let customerDialogFromOrder = false;
let currentCustomer = null;
function openCustomerDialog(id, fromOrder = false) {
  customerDialogFromOrder = fromOrder;
  const f = $("#formCustomer");
  const c = id ? state.customers.find((x) => x.id === id) : null;
  currentCustomer = c;
  f.reset();
  f.id.value = c?.id || "";
  f.name.value = c?.name || "";
  f.phone.value = c?.phone || "";
  f.notes.value = c?.notes || "";
  fillDiscountSelect($("#customerDiscount"), c ? c.discount_pct : levels()[0]);
  $("#customerRef").classList.toggle("hidden", !(c && c.ref_code));
  if (c && c.ref_code) {
    const st = referralStats()[c.id];
    $("#customerRefUrl").textContent = refUrl(c);
    $("#customerRefStats").textContent = st ? `Ha traído ${st.n} pedido${st.n === 1 ? "" : "s"} por ${fmt(st.total)}.` : "Aún no ha traído pedidos.";
  }
  $("#dlgCustomerTitle").textContent = c ? "Editar cliente" : "Nuevo cliente";
  $("#btnDeleteCustomer").classList.toggle("hidden", !c);
  $("#customerError").textContent = "";
  $("#dlgCustomer").showModal();
}

$("#formCustomer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target; const err = $("#customerError"); err.textContent = "";
  const row = { name: f.name.value.trim(), phone: f.phone.value.trim(), discount_pct: Number(f.discount_pct.value), notes: f.notes.value.trim() };
  $("#btnSaveCustomer").disabled = true;
  try {
    if (f.id.value) {
      const { data, error } = await supabase.from("customers").update(row).eq("id", f.id.value).select().single();
      if (error) throw error;
      Object.assign(state.customers.find((x) => x.id === f.id.value), data);
      // mantener el nombre en pedidos existentes
      await supabase.from("orders").update({ customer_name: data.name }).eq("customer_id", data.id);
      state.orders.forEach((o) => { if (o.customer_id === data.id) o.customer_name = data.name; });
    } else {
      const { data, error } = await supabase.from("customers").insert(row).select().single();
      if (error) throw error;
      state.customers.push(data);
      if (customerDialogFromOrder) {
        state.draft.customer_id = data.id; state.draft.discount_pct = data.discount_pct;
        fillCustomerSelect(data.id); fillDiscountSelect($("#orderDiscount"), data.discount_pct); renderOrderItems();
      }
    }
    state.customers.sort((a, b) => a.name.localeCompare(b.name));
    $("#dlgCustomer").close(); toast("Cliente guardado");
    if (state.view === "clientes") renderCustomers();
  } catch (ex) { err.textContent = "No se pudo guardar: " + ex.message; }
  $("#btnSaveCustomer").disabled = false;
});

$("#btnRefCopy").addEventListener("click", async () => {
  const url = refUrl(currentCustomer);
  try { await navigator.clipboard.writeText(url); toast("Enlace copiado"); } catch { prompt("Copia el enlace:", url); }
});
$("#btnRefQr").addEventListener("click", () => {
  const c = currentCustomer;
  openQrFor({ url: refUrl(c), title: "QR · " + c.name, subtitle: "Enlace de " + c.name, file: `qr-${c.ref_code}` });
});
$("#btnRefSend").addEventListener("click", () => {
  const c = currentCustomer;
  const msg = `Hola ${c.name} 😊 Este es tu enlace personal de mi catálogo para que lo compartas con tus amigos y familia:\n${refUrl(c)}\nCada pedido que llegue por tu enlace queda registrado a tu nombre. ¡Gracias por recomendarme!`;
  window.open(waLink(c.phone, msg), "_blank");
});

$("#btnDeleteCustomer").addEventListener("click", async () => {
  const id = $("#formCustomer").id.value;
  if (!confirm("¿Eliminar este cliente? Sus pedidos se conservan.")) return;
  const { error } = await supabase.from("customers").delete().eq("id", id);
  if (error) { toast("Error: " + error.message); return; }
  state.customers = state.customers.filter((x) => x.id !== id);
  state.orders.forEach((o) => { if (o.customer_id === id) o.customer_id = null; });
  $("#dlgCustomer").close(); toast("Cliente eliminado"); renderCustomers();
});

// =====================================================================
//  PRODUCTOS
// =====================================================================
function priceGrid(p) {
  const realCost = p.cost != null && p.cost !== "";
  return `<span class="cost">Tu costo${realCost ? '<em class="tag">real</em>' : ""}<b>${fmt(productCost(p, costPct()))}</b></span>` +
    levels().map((d) => {
      const fixed = p.prices?.[String(d)] != null;
      return `<span class="${fixed ? "fixed" : ""}">${d === 0 ? "Público" : d + "% dto."}${fixed ? '<em class="tag">fijo</em>' : ""}<b>${fmt(productPrice(p, d))}</b></span>`;
    }).join("");
}

function renderProducts() {
  const q = norm(state.search.productos);
  const list = state.products.filter((p) => !q || norm(p.name).includes(q) || norm(p.category).includes(q));
  $("#view").innerHTML = `
    <input type="search" class="search" id="searchProducts" placeholder="Buscar producto…" value="${esc(state.search.productos)}">
    ${list.length ? list.map((p) => `<div class="card tap" data-product="${p.id}">
      <div class="row">
        ${p.image_url ? `<img class="thumb" src="${esc(p.image_url)}" alt="">` : `<div class="thumb">📦</div>`}
        <div class="grow">
          <div class="bold ellipsis">${esc(p.name)}</div>
          <div class="muted">${esc(p.category) || "Sin categoría"}${(p.images?.length || 0) > 1 ? ` · ${p.images.length} fotos` : ""} ${p.active ? "" : '· <span class="badge off">Oculto</span>'}</div>
        </div>
        <div class="right"><div class="muted small">Público</div><div class="price">${fmt(p.public_price)}</div></div>
      </div>
      <div class="price-grid">${priceGrid(p)}</div>
    </div>`).join("")
    : `<div class="empty"><div class="big">📦</div>${q ? "Sin resultados" : "Aún no tienes productos. Toca + para agregar el primero."}</div>`}`;

  const inp = $("#searchProducts");
  inp.addEventListener("input", () => { state.search.productos = inp.value; renderProducts(); const i = $("#searchProducts"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  $$("[data-product]", $("#view")).forEach((c) => c.addEventListener("click", () => openProductDialog(c.dataset.product)));
}

let productImages = []; // fotos ya guardadas que se conservan (URLs)

function openProductDialog(id) {
  const f = $("#formProduct");
  const p = id ? state.products.find((x) => x.id === id) : null;
  f.reset();
  f.id.value = p?.id || "";
  f.name.value = p?.name || "";
  f.category.value = p?.category || "";
  f.public_price.value = p ? p.public_price : "";
  f.cost.value = p?.cost ?? "";
  f.description.value = p?.description || "";
  renderPriceRows(p?.prices || {});
  f.active.checked = p ? p.active : true;
  productImages = p?.images?.length ? [...p.images] : (p?.image_url ? [p.image_url] : []);
  $("#categories").innerHTML = [...new Set(state.products.map((x) => x.category).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join("");
  renderProductImages();
  $("#dlgProductTitle").textContent = p ? "Editar producto" : "Nuevo producto";
  $("#btnDeleteProduct").classList.toggle("hidden", !p);
  $("#productError").textContent = "";
  updateProductPreview();
  $("#dlgProduct").showModal();
}

/** Producto "virtual" a partir de lo escrito en el formulario, para previsualizar */
function formProduct() {
  const f = $("#formProduct");
  const prices = {};
  for (const d of levels()) { const v = f[`price_${d}`]?.value; if (v !== undefined && v !== "") prices[String(d)] = Number(v); }
  return { public_price: Number(f.public_price.value) || 0, cost: f.cost.value === "" ? null : Number(f.cost.value), prices };
}

function renderPriceRows(prices) {
  $("#productPrices").innerHTML = levels().map((d) => `<div class="price-row">
      <div class="lbl">${d === 0 ? "Precio público" : d + "% de descuento"}<small data-calc="${d}"></small></div>
      <input type="number" name="price_${d}" min="0" step="0.01" inputmode="decimal" value="${prices[String(d)] ?? ""}">
      <div class="profit" data-profit="${d}"></div>
    </div>`).join("");
  $$("#productPrices input").forEach((i) => i.addEventListener("input", updateProductPreview));
  updateProductPreview();
}

function updateProductPreview() {
  const p = formProduct();
  const cost = productCost(p, costPct());
  $("#formProduct").cost.placeholder = p.public_price > 0 ? "calculado: " + fmt(costPrice(p.public_price, costPct())) : "";
  for (const d of levels()) {
    const calc = salePrice(p.public_price, d);
    const inp = $(`#formProduct [name=price_${d}]`);
    inp.placeholder = p.public_price > 0 ? calc.toFixed(2) : "";
    $(`[data-calc="${d}"]`).textContent = inp.value !== "" && p.public_price > 0 ? "calculado: " + fmt(calc) : "";
    const price = productPrice(p, d);
    $(`[data-profit="${d}"]`).innerHTML = p.public_price > 0 ? `<span class="muted">gano</span><br><b class="${price - cost < 0 ? "" : "profit"}">${fmt(price - cost)}</b>` : "";
  }
}
$("#formProduct").public_price.addEventListener("input", updateProductPreview);
$("#formProduct").cost.addEventListener("input", updateProductPreview);
function renderProductImages() {
  const box = $("#productImagePreview");
  const newFiles = [...$("#formProduct").image.files];
  box.innerHTML =
    productImages.map((u, i) => `<div class="imgchip"><img src="${esc(u)}" alt=""><button type="button" data-rm="${i}" aria-label="Quitar foto">✕</button>${i === 0 ? '<span class="tag">Principal</span>' : ""}</div>`).join("") +
    newFiles.map((f) => `<div class="imgchip"><img src="${URL.createObjectURL(f)}" alt=""><span class="tag">Nueva</span></div>`).join("");
  $$("[data-rm]", box).forEach((b) => b.addEventListener("click", () => { productImages.splice(+b.dataset.rm, 1); renderProductImages(); }));
}
$("#formProduct").image.addEventListener("change", renderProductImages);

/** Reduce la foto a máx. 1000px y la convierte a JPEG para no gastar almacenamiento */
function shrinkImage(file, max = 1000) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => resolve(b || file), "image/jpeg", 0.85);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

$("#formProduct").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target; const err = $("#productError"); err.textContent = "";
  const btn = $("#btnSaveProduct"); btn.disabled = true;
  try {
    const pid = f.id.value || crypto.randomUUID();
    const uploaded = [];
    for (const file of f.image.files) {
      const blob = await shrinkImage(file);
      const path = `${pid}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("productos").upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) throw up.error;
      uploaded.push(supabase.storage.from("productos").getPublicUrl(path).data.publicUrl);
    }
    const images = [...productImages, ...uploaded];
    const fp = formProduct();
    const prices = Object.fromEntries(Object.entries(fp.prices).map(([k, v]) => [k, round2(v)]));
    const row = {
      name: f.name.value.trim(), category: f.category.value.trim(), public_price: round2(f.public_price.value),
      cost: fp.cost == null ? null : round2(fp.cost), prices,
      description: f.description.value.trim(), active: f.active.checked, images, image_url: images[0] || null,
    };
    if (f.id.value) {
      const { data, error } = await supabase.from("products").update(row).eq("id", f.id.value).select().single();
      if (error) throw error;
      Object.assign(state.products.find((x) => x.id === f.id.value), numProduct(data));
    } else {
      const { data, error } = await supabase.from("products").insert({ id: pid, ...row }).select().single();
      if (error) throw error;
      state.products.push(numProduct(data));
    }
    state.products.sort((a, b) => a.name.localeCompare(b.name));
    $("#dlgProduct").close(); toast("Producto guardado"); renderProducts();
  } catch (ex) { err.textContent = "No se pudo guardar: " + ex.message; }
  btn.disabled = false;
});

$("#btnDeleteProduct").addEventListener("click", async () => {
  const id = $("#formProduct").id.value;
  if (!confirm("¿Eliminar este producto? Los pedidos anteriores se conservan.")) return;
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) { toast("Error: " + error.message); return; }
  state.products = state.products.filter((x) => x.id !== id);
  $("#dlgProduct").close(); toast("Producto eliminado"); renderProducts();
});

// =====================================================================
//  AJUSTES
// =====================================================================
function catalogUrl(d) {
  const base = new URL("catalogo.html", location.href);
  if (d > 0) base.searchParams.set("d", d);
  return base.href;
}

function renderSettings() {
  const s = state.settings;
  $("#view").innerHTML = `
    <form id="formSettings" class="card">
      <h2 style="font-size:16px" class="mb">Mi negocio</h2>
      <label><span>Nombre del negocio</span><input type="text" name="business_name" value="${esc(s.business_name)}"></label>
      <label><span>Mi WhatsApp (a donde escriben los clientes)</span><input type="tel" name="whatsapp" value="${esc(s.whatsapp)}" placeholder="999 999 999"></label>
      <label><span>Mi descuento de mayorista (%)</span><input type="number" name="cost_discount_pct" min="0" max="100" value="${s.cost_discount_pct}"></label>
      <label><span>Niveles de descuento que ofrezco (separados por coma)</span><input type="text" name="discount_levels" value="${s.discount_levels.join(", ")}" placeholder="35, 20, 10, 0"></label>
      <p class="error" id="settingsError"></p>
      <button class="btn primary block" type="submit">Guardar ajustes</button>
    </form>

    <div class="card">
      <h2 style="font-size:16px">Compartir catálogo</h2>
      <p class="muted mb">Cada enlace muestra los precios con ese descuento. Envíale a cada cliente el enlace que le corresponde.</p>
      ${levels().map((d) => `<div class="link-box">
        <div class="row between">
          <div class="grow"><div class="bold">${d === 0 ? "Precio público" : d + "% de descuento"}</div><div class="muted small ellipsis">${esc(catalogUrl(d))}</div></div>
          <div class="btns">
            <button class="btn sm" data-copy="${d}">Copiar</button>
            <button class="btn sm" data-qr="${d}">QR</button>
            <button class="btn sm primary" data-share="${d}">Enviar</button>
          </div>
        </div></div>`).join("")}
      <p class="muted small mt">Consejo: comparte públicamente solo el enlace de precio público; los de descuento envíalos a cada cliente por separado.</p>
      <p class="muted small">🔗 Cada cliente tiene además su <b>enlace personal para recomendar</b> (en su ficha, pestaña Clientes). Los pedidos que lleguen por ese enlace aparecen como "Referido por …" y en su ficha ves cuánto ha traído, para que decidas su premio.</p>
      <a class="btn block mt" href="${esc(catalogUrl(0))}" target="_blank">Ver catálogo como cliente</a>
    </div>

    <div class="card">
      <p class="muted mb">Sesión iniciada.</p>
      <button class="btn danger block" id="btnLogout">Cerrar sesión</button>
    </div>`;

  $("#formSettings").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target; const err = $("#settingsError"); err.textContent = "";
    const lv = [...new Set(f.discount_levels.value.split(/[,\s]+/).filter((x) => x !== "").map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 100).sort((a, b) => b - a);
    if (!lv.length) { err.textContent = "Indica al menos un nivel de descuento (ej. 35, 20, 10, 0)."; return; }
    const row = { business_name: f.business_name.value.trim(), whatsapp: f.whatsapp.value.trim(), cost_discount_pct: Number(f.cost_discount_pct.value), discount_levels: lv, updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from("settings").update(row).eq("id", 1).select().single();
    if (error) { err.textContent = "No se pudo guardar: " + error.message; return; }
    state.settings = data; toast("Ajustes guardados"); renderSettings();
  });
  $$("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(catalogUrl(+b.dataset.copy)); toast("Enlace copiado"); } catch { prompt("Copia el enlace:", catalogUrl(+b.dataset.copy)); }
  }));
  $$("[data-share]").forEach((b) => b.addEventListener("click", async () => {
    const url = catalogUrl(+b.dataset.share);
    const text = `Hola, aquí está mi catálogo de productos Herbalife: ${url}`;
    if (navigator.share) { try { await navigator.share({ text }); } catch {} }
    else window.open(waLink("", text), "_blank");
  }));
  $$("[data-qr]").forEach((b) => b.addEventListener("click", () => openQr(+b.dataset.qr)));
  $("#btnLogout").addEventListener("click", async () => { await supabase.auth.signOut(); showLogin(); });
}

// ---- Código QR ----
let qr = null; // { url, title, subtitle, file }
function qrLabel(d) { return d === 0 ? "Precio público" : d + "% de descuento"; }

function openQr(d) {
  openQrFor({ url: catalogUrl(d), title: "QR · " + qrLabel(d), subtitle: "Catálogo · " + qrLabel(d), file: `qr-catalogo-${d}` });
}
function openQrFor(opts) {
  if (!window.QRCode) { toast("El generador de QR aún no cargó. Revisa tu internet e intenta de nuevo."); return; }
  qr = opts;
  $("#dlgQrTitle").textContent = opts.title;
  $("#qrUrl").textContent = opts.url;
  const box = $("#qrBox"); box.innerHTML = "";
  new QRCode(box, { text: opts.url, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
  $("#dlgQr").showModal();
}

/** Imagen lista para imprimir: QR + nombre del negocio + nivel + enlace */
function qrImageBlob() {
  return new Promise((resolve) => {
    const src = $("#qrBox canvas") || $("#qrBox img");
    const size = 900, pad = 70, qrSize = 560;
    const c = document.createElement("canvas"); c.width = size; c.height = size + 120;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#1a7f4b"; ctx.font = "bold 44px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(state.settings.business_name || "Catálogo", size / 2, pad + 10);
    ctx.fillStyle = "#1c2420"; ctx.font = "30px system-ui, sans-serif";
    ctx.fillText(qr.subtitle, size / 2, pad + 60);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, (size - qrSize) / 2, pad + 100, qrSize, qrSize);
    ctx.fillStyle = "#6b766f"; ctx.font = "26px system-ui, sans-serif";
    ctx.fillText("Escanea o entra a:", size / 2, pad + 100 + qrSize + 60);
    ctx.fillStyle = "#1c2420"; ctx.font = "bold 28px system-ui, sans-serif";
    ctx.fillText(qr.url.replace(/^https?:\/\//, ""), size / 2, pad + 100 + qrSize + 105);
    c.toBlob(resolve, "image/png");
  });
}

$("#btnQrDownload").addEventListener("click", async () => {
  const blob = await qrImageBlob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `${qr.file}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("Imagen descargada");
});

$("#btnQrShare").addEventListener("click", async () => {
  const blob = await qrImageBlob();
  const file = new File([blob], `${qr.file}.png`, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text: qr.url }); } catch {}
  } else {
    toast("Tu navegador no permite compartir imágenes; usa Descargar.");
  }
});

init();
