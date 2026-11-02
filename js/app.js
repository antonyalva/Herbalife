import { supabase, configured } from "./db.js";
import { salePrice, costPrice, fmt, fmtDate, totals, waLink, round2 } from "./pricing.js";

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
}

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
const numProduct = (p) => ({ ...p, public_price: Number(p.public_price) });
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

function orderCard(o) {
  const n = o.order_items.reduce((a, i) => a + i.qty, 0);
  return `<div class="card tap" data-order="${o.id}">
    <div class="row between">
      <div class="grow">
        <div class="bold ellipsis">${esc(o.customer_name || "Sin cliente")}</div>
        <div class="muted">${fmtDate(o.created_at)} · ${n} producto${n === 1 ? "" : "s"} · ${o.discount_pct}% dto.</div>
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
    ? list.map((p) => `<button type="button" data-add="${p.id}"><span>${esc(p.name)}</span><span class="muted">${fmt(salePrice(p.public_price, state.draft.discount_pct))}</span></button>`).join("")
    : `<div class="muted" style="padding:10px 12px">Sin resultados</div>`;
  $$("[data-add]", $("#orderPicker")).forEach((b) => b.addEventListener("click", () => addDraftItem(b.dataset.add)));
}

function addDraftItem(productId) {
  const p = state.products.find((x) => x.id === productId);
  const ex = state.draft.items.find((i) => i.product_id === productId);
  if (ex) ex.qty++;
  else state.draft.items.push({ product_id: p.id, product_name: p.name, public_price: p.public_price, qty: 1 });
  renderOrderItems();
}

function draftComputed() {
  const d = state.draft.discount_pct;
  const items = state.draft.items.map((i) => ({ ...i, unit_price: salePrice(i.public_price, d), unit_cost: costPrice(i.public_price, costPct()) }));
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
  body.innerHTML = `
    <div class="row between mb">
      <div><div class="bold" style="font-size:17px">${esc(o.customer_name || "Sin cliente")}</div><div class="muted">${fmtDate(o.created_at)} · ${o.discount_pct}% dto.</div></div>
      <span class="badge ${o.status}">${STATUS_LABEL[o.status]}</span>
    </div>
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
    const msg = `Hola ${o.customer_name}, este es tu pedido${state.settings.business_name ? " de " + state.settings.business_name : ""}:\n${lines.join("\n")}\n\n*Total: ${fmt(o.total)}*${o.note ? "\n" + o.note : ""}\n¡Gracias!`;
    window.open(waLink(cust?.phone, msg), "_blank");
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

  $("#view").innerHTML = `
    <input type="search" class="search" id="searchCustomers" placeholder="Buscar cliente…" value="${esc(state.search.clientes)}">
    ${list.length ? list.map((c) => `<div class="card tap" data-customer="${c.id}">
      <div class="row between">
        <div class="grow"><div class="bold ellipsis">${esc(c.name)}</div><div class="muted">${esc(c.phone) || "Sin teléfono"}</div></div>
        <div class="right"><span class="badge">${c.discount_pct}% dto.</span>
          ${pending[c.id] ? `<div class="small mt" style="margin-top:4px;color:var(--warn)">Debe ${fmt(pending[c.id])}</div>` : ""}</div>
      </div></div>`).join("")
    : `<div class="empty"><div class="big">👥</div>${q ? "Sin resultados" : "Aún no tienes clientes. Toca + para agregar uno."}</div>`}`;

  const inp = $("#searchCustomers");
  inp.addEventListener("input", () => { state.search.clientes = inp.value; renderCustomers(); const i = $("#searchCustomers"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  $$("[data-customer]", $("#view")).forEach((c) => c.addEventListener("click", () => openCustomerDialog(c.dataset.customer)));
}

let customerDialogFromOrder = false;
function openCustomerDialog(id, fromOrder = false) {
  customerDialogFromOrder = fromOrder;
  const f = $("#formCustomer");
  const c = id ? state.customers.find((x) => x.id === id) : null;
  f.reset();
  f.id.value = c?.id || "";
  f.name.value = c?.name || "";
  f.phone.value = c?.phone || "";
  f.notes.value = c?.notes || "";
  fillDiscountSelect($("#customerDiscount"), c ? c.discount_pct : levels()[0]);
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
function priceGrid(publicPrice) {
  return `<span class="cost">Tu costo<b>${fmt(costPrice(publicPrice, costPct()))}</b></span>` +
    levels().map((d) => `<span>${d === 0 ? "Público" : d + "% dto."}<b>${fmt(salePrice(publicPrice, d))}</b></span>`).join("");
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
          <div class="muted">${esc(p.category) || "Sin categoría"} ${p.active ? "" : '· <span class="badge off">Oculto</span>'}</div>
        </div>
        <div class="right"><div class="muted small">Público</div><div class="price">${fmt(p.public_price)}</div></div>
      </div>
      <div class="price-grid">${priceGrid(p.public_price)}</div>
    </div>`).join("")
    : `<div class="empty"><div class="big">📦</div>${q ? "Sin resultados" : "Aún no tienes productos. Toca + para agregar el primero."}</div>`}`;

  const inp = $("#searchProducts");
  inp.addEventListener("input", () => { state.search.productos = inp.value; renderProducts(); const i = $("#searchProducts"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  $$("[data-product]", $("#view")).forEach((c) => c.addEventListener("click", () => openProductDialog(c.dataset.product)));
}

function openProductDialog(id) {
  const f = $("#formProduct");
  const p = id ? state.products.find((x) => x.id === id) : null;
  f.reset();
  f.id.value = p?.id || "";
  f.name.value = p?.name || "";
  f.category.value = p?.category || "";
  f.public_price.value = p ? p.public_price : "";
  f.active.checked = p ? p.active : true;
  f.dataset.imageUrl = p?.image_url || "";
  $("#categories").innerHTML = [...new Set(state.products.map((x) => x.category).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join("");
  $("#productImagePreview").innerHTML = p?.image_url ? `<img src="${esc(p.image_url)}" alt="" style="width:90px;height:90px;object-fit:cover;border-radius:10px">` : "";
  $("#dlgProductTitle").textContent = p ? "Editar producto" : "Nuevo producto";
  $("#btnDeleteProduct").classList.toggle("hidden", !p);
  $("#productError").textContent = "";
  updateProductPreview();
  $("#dlgProduct").showModal();
}

function updateProductPreview() {
  const v = Number($("#formProduct").public_price.value);
  $("#productPricePreview").innerHTML = v > 0 ? priceGrid(v) : "";
}
$("#formProduct").public_price.addEventListener("input", updateProductPreview);
$("#formProduct").image.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $("#productImagePreview").innerHTML = `<img src="${URL.createObjectURL(file)}" alt="" style="width:90px;height:90px;object-fit:cover;border-radius:10px">`;
});

/** Reduce la foto a máx. 800px y la convierte a JPEG para no gastar almacenamiento */
function shrinkImage(file, max = 800) {
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
    let image_url = f.dataset.imageUrl || null;
    const file = f.image.files[0];
    if (file) {
      const blob = await shrinkImage(file);
      const path = `${f.id.value || crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("productos").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (up.error) throw up.error;
      image_url = supabase.storage.from("productos").getPublicUrl(path).data.publicUrl + "?v=" + Date.now();
    }
    const row = { name: f.name.value.trim(), category: f.category.value.trim(), public_price: round2(f.public_price.value), active: f.active.checked, image_url };
    if (f.id.value) {
      const { data, error } = await supabase.from("products").update(row).eq("id", f.id.value).select().single();
      if (error) throw error;
      Object.assign(state.products.find((x) => x.id === f.id.value), numProduct(data));
    } else {
      const { data, error } = await supabase.from("products").insert(row).select().single();
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
          <button class="btn sm" data-copy="${d}">Copiar</button>
          <button class="btn sm primary" data-share="${d}">Enviar</button>
        </div></div>`).join("")}
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
  $("#btnLogout").addEventListener("click", async () => { await supabase.auth.signOut(); showLogin(); });
}

init();
