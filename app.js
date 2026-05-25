// ── Supabase Cloud Architecture ───────────────────────────────────────────────
// GitHub = deployment only (hosting/domain)
// Supabase = cloud database (PostgreSQL)
// Data is synced across all devices in real-time

// ── State ────────────────────────────────────────────────────────────────────
let allRecords    = [];
let monthlyStats  = {};
let chartInstance = null;
let pendingAction = null;
let selectedYear  = new Date().getFullYear();
let isLoading     = true;

// Connection status element
const connStatus = document.getElementById("connection-status");

// ── Navigation ───────────────────────────────────────────────────────────────
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("page-" + btn.dataset.page).classList.add("active");
    if (btn.dataset.page === "stats") renderStats();
  });
});

// ── Options multi-select ─────────────────────────────────────────────────────
document.querySelectorAll(".opt-btn").forEach(btn => {
  btn.addEventListener("click", () => btn.classList.toggle("selected"));
});
function getSelectedOptions() {
  return [...document.querySelectorAll(".opt-btn.selected")].map(b => b.dataset.val);
}
function clearOptions() {
  document.querySelectorAll(".opt-btn").forEach(b => b.classList.remove("selected"));
}

// ── Monthly key helper ────────────────────────────────────────────────────────
function monthKey(isoStr) {
  const d = new Date(isoStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Dynamic Interest Profit Calculation ───────────────────────────────────────
function interestProfitPerCycle(price) {
  return Math.ceil((Number(price) || 0) / 500) * 50;
}

function calculateTotalInterestProfit() {
  return allRecords.reduce((sum, r) => {
    const dates = r.interestDates || [];
    return sum + (dates.length * interestProfitPerCycle(r.price));
  }, 0);
}

function calculateMonthlyProfit() {
  const result = {};
  allRecords.forEach(r => {
    const dates = r.interestDates || [];
    const profitPer = interestProfitPerCycle(r.price);
    dates.forEach(d => {
      let dt;
      if (d.includes(".")) {
        dt = parseDDMMYY(d);
      } else {
        dt = new Date(d);
      }
      if (dt && !isNaN(dt.getTime())) {
        const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
        result[key] = (result[key] || 0) + profitPer;
      }
    });
  });
  return result;
}

// ── Supabase Helpers ──────────────────────────────────────────────────────────
const TABLE_RECORDS = "gadgets";
const TABLE_MONTHLY = "monthly_stats";

function setConnStatus(text, color) {
  if (connStatus) {
    connStatus.textContent = text;
    connStatus.style.color = color || "#d4d4d4";
  }
}

async function supabaseFetchAll() {
  if (!supabaseClient) throw new Error("Supabase not configured");
  const { data, error } = await supabaseClient
    .from(TABLE_RECORDS)
    .select("*")
    .order("created_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function supabaseFetchMonthly() {
  if (!supabaseClient) throw new Error("Supabase not configured");
  const { data, error } = await supabaseClient
    .from(TABLE_MONTHLY)
    .select("*");
  if (error) throw error;
  const map = {};
  (data || []).forEach(row => {
    map[row.month_key] = { cost: row.cost || 0, profit: row.profit || 0 };
  });
  return map;
}

async function supabaseInsert(record) {
  if (!supabaseClient) throw new Error("Supabase not configured");
  const { data, error } = await supabaseClient
    .from(TABLE_RECORDS)
    .insert({
      record_id: record.id,
      date: record.date,
      description: record.description,
      options: record.options || [],
      phone: record.phone,
      price: Number(record.price) || 0,
      created_date: record.createdDate || new Date().toISOString(),
      interest_dates: record.interestDates || [],
      status: record.status || "active",
      returned_date: record.returnedDate || null,
      sold_date: record.soldDate || null,
      is_dummy: record.isDummy || false
    })
    .select();
  if (error) throw error;
  return data ? data[0] : null;
}

async function supabaseUpdate(id, updates) {
  if (!supabaseClient) throw new Error("Supabase not configured");
  const dbUpdates = {};
  if (updates.record_id !== undefined) dbUpdates.record_id = updates.record_id;
  if (updates.id !== undefined) dbUpdates.record_id = updates.id;
  if (updates.date !== undefined) dbUpdates.date = updates.date;
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.options !== undefined) dbUpdates.options = updates.options;
  if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
  if (updates.price !== undefined) dbUpdates.price = Number(updates.price);
  if (updates.interestDates !== undefined) dbUpdates.interest_dates = updates.interestDates;
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.returnedDate !== undefined) dbUpdates.returned_date = updates.returnedDate;
  if (updates.soldDate !== undefined) dbUpdates.sold_date = updates.soldDate;
  if (updates.isDummy !== undefined) dbUpdates.is_dummy = updates.isDummy;

  const { error } = await supabaseClient
    .from(TABLE_RECORDS)
    .update(dbUpdates)
    .eq("id", id);
  if (error) throw error;
}

async function supabaseDelete(id) {
  if (!supabaseClient) throw new Error("Supabase not configured");
  const { error } = await supabaseClient
    .from(TABLE_RECORDS)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

async function supabaseDeleteByStatus(status) {
  if (!supabaseClient) throw new Error("Supabase not configured");
  const ids = allRecords.filter(r => r.status === status).map(r => r._dbId).filter(Boolean);
  if (ids.length === 0) return;
  const { error } = await supabaseClient
    .from(TABLE_RECORDS)
    .delete()
    .in("id", ids);
  if (error) throw error;
}

async function supabaseUpsertMonthly(monthKey, cost, profit) {
  if (!supabaseClient) throw new Error("Supabase not configured");
  const { data: existing } = await supabaseClient
    .from(TABLE_MONTHLY)
    .select("*")
    .eq("month_key", monthKey)
    .maybeSingle();
  if (existing) {
    const { error } = await supabaseClient
      .from(TABLE_MONTHLY)
      .update({ cost, profit })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabaseClient
      .from(TABLE_MONTHLY)
      .insert({ month_key: monthKey, cost, profit });
    if (error) throw error;
  }
}

async function supabaseDeleteMonthly(monthKey) {
  if (!supabaseClient) throw new Error("Supabase not configured");
  const { error } = await supabaseClient
    .from(TABLE_MONTHLY)
    .delete()
    .eq("month_key", monthKey);
  if (error) throw error;
}

// ── Data Load ─────────────────────────────────────────────────────────────────
async function loadData() {
  if (!supabaseClient) {
    connStatus.textContent = "⚠️ Supabase not configured — set SUPABASE_URL & SUPABASE_ANON_KEY in supabase-config.js";
    connStatus.style.color = "#ea580c";
    return;
  }

  setConnStatus("🔄 Loading from Supabase...", "#d4d4d4");
  isLoading = true;

  try {
    const [records, monthly] = await Promise.all([
      supabaseFetchAll(),
      supabaseFetchMonthly()
    ]);

    // Transform Supabase records to app format
    allRecords = records.map(row => ({
      _dbId: row.id,
      _docId: "db_" + row.id,
      id: row.record_id || "",
      date: row.date || "",
      description: row.description || "",
      options: row.options || [],
      phone: row.phone || "",
      price: Number(row.price) || 0,
      createdDate: row.created_date || new Date().toISOString(),
      interestDates: row.interest_dates || [],
      status: row.status || "active",
      returnedDate: row.returned_date || null,
      soldDate: row.sold_date || null,
      isDummy: row.is_dummy || false
    }));

    monthlyStats = monthly;

    setConnStatus("✅ Connected — " + allRecords.length + " records loaded", "#16a34a");
    isLoading = false;
    updateStorageBars();
    renderRecords();
    renderReturned();
    renderSold();
    renderPending();
    const statsPage = document.getElementById("page-stats");
    if (statsPage && statsPage.classList.contains("active")) renderStats();
  } catch (err) {
    setConnStatus("❌ Supabase error: " + err.message, "#dc2626");
    isLoading = false;
    allRecords = [];
    monthlyStats = {};
    updateStorageBars();
    renderRecords();
    renderReturned();
    renderSold();
    renderPending();
  }
}

// ── CSV Parsing (for bulk import) ─────────────────────────────────────────────
function parseCSVLine(line) {
  const result = []; let cur = "", inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  result.push(cur.trim());
  return result.map(c => c.replace(/^"|"$/g, ""));
}

function extractPhoneFromText(text) {
  const digits = (text.match(/\d+/g) || []).join("");
  const m = digits.match(/[6-9]\d{9}/);
  return m ? m[0] : "";
}

// ── Bulk Import CSV ───────────────────────────────────────────────────────────
document.getElementById("btn-import-csv").addEventListener("click", () => {
  document.getElementById("csv-file-input").click();
});

document.getElementById("csv-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const msg = document.getElementById("import-msg");
  msg.textContent = "Reading..."; msg.className = "form-msg";
  try {
    const text  = await file.text();
    const lines = text.trim().split("\n").filter(l => l.trim());
    if (lines.length < 2) { msg.textContent = "CSV is empty."; msg.className = "form-msg err"; return; }
    const headers    = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
    const idIdx      = headers.findIndex(h => h === "id");
    const dateIdx    = headers.findIndex(h => h === "date");
    const nameIdx    = headers.findIndex(h => h === "name" || h === "description");
    const priceIdx   = headers.findIndex(h => h === "price");
    const phoneIdx   = headers.findIndex(h => h === "phone");
    const optionsIdx = headers.findIndex(h => h === "options");
    const createdIdx = headers.findIndex(h => h.includes("created"));
    if (nameIdx < 0) { msg.textContent = "Missing Description column."; msg.className = "form-msg err"; return; }
    msg.textContent = "Uploading to Supabase...";
    let importedCount = 0;
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols  = parseCSVLine(lines[i]);
      const name  = cols[nameIdx] || "";
      const phone = phoneIdx >= 0 && cols[phoneIdx] ? cols[phoneIdx] : extractPhoneFromText(name);
      let createdDate = new Date().toISOString();
      if (createdIdx >= 0 && cols[createdIdx]) {
        const v = cols[createdIdx].trim();
        const m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
        if (m) {
          let [, d, mo, y] = m;
          if (y.length === 2) y = "20" + y;
          createdDate = new Date(parseInt(y), parseInt(mo)-1, parseInt(d)).toISOString();
        } else {
          const d = new Date(v);
          if (!isNaN(d.getTime())) createdDate = d.toISOString();
        }
      }
      const record = {
        id: idIdx >= 0 ? (cols[idIdx] || "") : "",
        date: dateIdx >= 0 ? (cols[dateIdx] || "") : "",
        description: name,
        options: optionsIdx >= 0 && cols[optionsIdx] ? cols[optionsIdx].split("|").map(o=>o.trim()).filter(Boolean) : [],
        phone,
        price: priceIdx >= 0 ? (parseFloat(cols[priceIdx]) || 0) : 0,
        createdDate,
        interestDates: [],
        status: "active",
        returnedDate: null,
        soldDate: null,
        isDummy: false
      };
      const inserted = await supabaseInsert(record);
      if (inserted) {
        allRecords.unshift({
          _dbId: inserted.id,
          _docId: "db_" + inserted.id,
          ...record
        });
        importedCount++;
      }
      // Update monthly cost
      if (record.price && record.createdDate) {
        const key = monthKey(record.createdDate);
        const newCost = (monthlyStats[key]?.cost || 0) + (Number(record.price) || 0);
        await supabaseUpsertMonthly(key, newCost, monthlyStats[key]?.profit || 0);
        monthlyStats[key] = { cost: newCost, profit: monthlyStats[key]?.profit || 0 };
      }
    }
    msg.textContent = `✓ ${importedCount} records imported.`;
    msg.className = "form-msg ok";
    e.target.value = "";
    renderRecords();
  } catch (err) {
    msg.textContent = "Supabase error: " + err.message;
    msg.className = "form-msg err";
  }
});

// ── Clear All Active ──────────────────────────────────────────────────────────
document.getElementById("btn-clear-active").addEventListener("click", () => {
  showModal("Delete ALL active records permanently?", async () => {
    const msg = document.getElementById("clear-msg");
    msg.textContent = "Deleting..."; msg.className = "form-msg";
    try {
      await supabaseDeleteByStatus("active");
      allRecords = allRecords.filter(r => r.status !== "active");
      msg.textContent = "All active records deleted.";
      msg.className = "form-msg ok";
      renderRecords();
    } catch (e) {
      msg.textContent = "Error: " + e.message;
      msg.className = "form-msg err";
    }
  });
});

// ── Interest toggle on Add form ───────────────────────────────────────────────
let interestToggled = false;
document.getElementById("btn-interest-toggle").addEventListener("click", () => {
  interestToggled = !interestToggled;
  const btn   = document.getElementById("btn-interest-toggle");
  const label = document.getElementById("interest-toggle-label");
  const price = parseFloat(document.getElementById("f-price").value) || 0;
  const profit = Math.ceil(price / 500) * 50;
  if (interestToggled) {
    btn.classList.add("selected");
    label.textContent = price > 0 ? `Interest Paid — ₹${profit.toLocaleString("en-IN")} will be added` : "Interest Paid — enter price first";
  } else {
    btn.classList.remove("selected");
    label.textContent = "Interest Paid — Optional";
  }
});

document.getElementById("f-price").addEventListener("input", () => {
  if (!interestToggled) return;
  const price  = parseFloat(document.getElementById("f-price").value) || 0;
  const profit = Math.ceil(price / 500) * 50;
  document.getElementById("interest-toggle-label").textContent =
    price > 0 ? `Interest Paid — ₹${profit.toLocaleString("en-IN")} will be added` : "Interest Paid — enter price first";
});

// ── Submit Form ───────────────────────────────────────────────────────────────
document.getElementById("btn-submit").addEventListener("click", async () => {
  const id    = document.getElementById("f-id").value.trim();
  const date  = document.getElementById("f-date").value.trim();
  const desc  = document.getElementById("f-desc").value.trim();
  const phone = document.getElementById("f-phone").value.trim();
  const price = parseFloat(document.getElementById("f-price").value);
  const opts  = getSelectedOptions();
  const msg   = document.getElementById("form-msg");

  if (!id || !date || !desc || !phone || isNaN(price)) {
    msg.textContent = "Please fill all required fields.";
    msg.className = "form-msg err";
    return;
  }

  const now = new Date().toISOString();
  const record = {
    id, date, description: desc, options: opts,
    phone, price,
    createdDate: now,
    interestDates: [],
    status: "active",
    returnedDate: null,
    soldDate: null,
    isDummy: false
  };

  if (interestToggled) {
    record.interestDates = [todayDDMMYY()];
  }

  try {
    const inserted = await supabaseInsert(record);
    if (inserted) {
      allRecords.unshift({
        _dbId: inserted.id,
        _docId: "db_" + inserted.id,
        ...record
      });
    }
    // Update monthly cost
    const key = monthKey(now);
    const newCost = (monthlyStats[key]?.cost || 0) + price;
    await supabaseUpsertMonthly(key, newCost, monthlyStats[key]?.profit || 0);
    monthlyStats[key] = { cost: newCost, profit: monthlyStats[key]?.profit || 0 };

    renderRecords();
    msg.textContent = "Record saved.";
    msg.className = "form-msg ok";
    ["f-id","f-date","f-desc","f-phone","f-price"].forEach(id => document.getElementById(id).value = "");
    clearOptions();
    interestToggled = false;
    document.getElementById("btn-interest-toggle").classList.remove("selected");
    document.getElementById("interest-toggle-label").textContent = "Interest Paid — Optional";
    setTimeout(() => { msg.textContent = ""; }, 2500);
  } catch (e) {
    msg.textContent = "Supabase error: " + e.message;
    msg.className = "form-msg err";
  }
});

// ── Storage limits ────────────────────────────────────────────────────────────
const MAX_SOLD     = 500;
const MAX_RETURNED = 500;

function updateStorageBars() {
  const sold     = allRecords.filter(r => r.status === "sold");
  const returned = allRecords.filter(r => r.status === "returned");

  renderStorageBar("storage-bar-sold",     sold.length,     MAX_SOLD);
  renderStorageBar("storage-bar-returned", returned.length, MAX_RETURNED);

  const info = document.getElementById("storage-info");
  if (info) {
    const total = allRecords.length;
    info.innerHTML = `
      <div class="storage-info-row"><span>Active</span><span>${allRecords.filter(r=>r.status==="active").length} / 500</span></div>
      <div class="storage-info-row"><span>Pending</span><span>subset of Active (no extra storage)</span></div>
      <div class="storage-info-row"><span>Sold</span><span>${sold.length} / ${MAX_SOLD}</span></div>
      <div class="storage-info-row"><span>Returned</span><span>${returned.length} / ${MAX_RETURNED}</span></div>
      <div class="storage-info-row"><span>Total</span><span>${total} / 1500 records</span></div>
    `;
  }
}

function renderStorageBar(elId, count, max) {
  const el  = document.getElementById(elId);
  if (!el) return;
  const pct   = Math.min(100, Math.round((count / max) * 100));
  const color = pct >= 90 ? "#dc2626" : pct >= 70 ? "#ea580c" : "#16a34a";
  el.innerHTML = `
    <div class="storage-bar-inner">
      <div class="storage-bar-label">${count} / ${max} records</div>
      <div class="storage-bar-track">
        <div class="storage-bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
    </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(isoStr) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}
function fmtInterest(d) {
  if (typeof d === "string" && d.includes(".")) return d;
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
function filterBySearch(records, query) {
  if (!query) return records;
  const q = query.toLowerCase();
  return records.filter(r =>
    r.id?.toLowerCase().includes(q) ||
    r.date?.toLowerCase().includes(q) ||
    r.description?.toLowerCase().includes(q) ||
    r.phone?.toLowerCase().includes(q) ||
    String(r.price || "").includes(q)
  );
}

// ── Render Records ────────────────────────────────────────────────────────────
function renderRecords() {
  if (isLoading) return;
  const query    = document.getElementById("search-records").value;
  const active   = allRecords.filter(r => r.status === "active");
  const filtered = filterBySearch(active, query);
  const el       = document.getElementById("records-list");

  const totalVal    = active.reduce((s, r) => s + (Number(r.price) || 0), 0);
  const totalProfit = calculateTotalInterestProfit();
  document.getElementById("rec-total-value").textContent  = "₹" + totalVal.toLocaleString("en-IN");
  document.getElementById("rec-total-profit").textContent = "₹" + totalProfit.toLocaleString("en-IN");
  document.getElementById("rec-count").textContent        = active.length;

  el.innerHTML = filtered.length
    ? filtered.map(r => cardHTML(r, "active")).join("")
    : '<div class="empty">No active records</div>';
  attachCardEvents(el);
}
document.getElementById("search-records").addEventListener("input", renderRecords);

// ── Render Returned ───────────────────────────────────────────────────────────
function renderReturned() {
  if (isLoading) return;
  const query    = document.getElementById("search-returned").value;
  const returned = allRecords.filter(r => r.status === "returned")
    .sort((a, b) => new Date(b.returnedDate || 0) - new Date(a.returnedDate || 0));
  const filtered = filterBySearch(returned, query);
  const el       = document.getElementById("returned-list");
  el.innerHTML   = filtered.length
    ? filtered.map(r => cardHTML(r, "returned")).join("")
    : '<div class="empty">No returned records</div>';
  attachCardEvents(el);
}
document.getElementById("search-returned").addEventListener("input", renderReturned);
document.getElementById("clear-returned").addEventListener("click", () => {
  showModal("Delete all returned records?", async () => {
    try { await supabaseDeleteByStatus("returned"); } catch(e) {}
    allRecords = allRecords.filter(r => r.status !== "returned");
    renderRecords(); renderReturned(); renderSold(); renderPending();
  });
});

// ── Interest date helpers ─────────────────────────────────────────────────────
function todayDDMMYY() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getFullYear()).slice(2)}`;
}

function parseDDMMYY(str) {
  if (!str) return null;
  const parts = str.trim().split(".");
  if (parts.length < 3) return null;
  const d = parseInt(parts[0]), m = parseInt(parts[1]);
  let y = parseInt(parts[2]);
  if (y < 100) y += 2000;
  if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
  return new Date(y, m - 1, d);
}

function isValidDDMMYY(str) {
  const d = parseDDMMYY(str);
  return d !== null && !isNaN(d.getTime());
}

function cyclesElapsed(cardDateStr) {
  const start = parseDDMMYY(cardDateStr);
  if (!start) return 0;
  const days = Math.floor((Date.now() - start.getTime()) / (24 * 60 * 60 * 1000));
  return Math.floor(days / 30);
}

function pendingCount(r) {
  const cycles  = cyclesElapsed(r.date);
  const recorded = (r.interestDates || []).length;
  return Math.max(0, cycles - recorded);
}

// ── Interest Pending Page ─────────────────────────────────────────────────────
let pendingMonthFilter = 1;

document.querySelectorAll(".pending-filters .filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".pending-filters .filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    pendingMonthFilter = parseInt(btn.dataset.months);
    renderPending();
  });
});

document.getElementById("search-pending").addEventListener("input", renderPending);

function renderPending() {
  if (isLoading) return;
  const query = document.getElementById("search-pending").value;

  const pending = allRecords.filter(r => {
    if (r.status !== "active") return false;
    if (!r.date) return false;
    const pc = pendingCount(r);
    return pc >= pendingMonthFilter;
  });

  const filtered = filterBySearch(pending, query);
  const totalVal = pending.reduce((s, r) => s + (Number(r.price) || 0), 0);
  document.getElementById("pending-value").textContent = "₹" + totalVal.toLocaleString("en-IN");
  document.getElementById("pending-count").textContent = pending.length;

  const el = document.getElementById("pending-list");
  el.innerHTML = filtered.length
    ? filtered.map(r => pendingCardHTML(r)).join("")
    : '<div class="empty">No pending records</div>';
  attachCardEvents(el);
}

function pendingCardHTML(r) {
  const cycles   = cyclesElapsed(r.date);
  const recorded = (r.interestDates || []).length;
  const pending  = Math.max(0, cycles - recorded);

  const interests = (r.interestDates || []).map(d => `<span class="interest-tag">${fmtInterest(d)}</span>`).join("");
  const interestBlock = `
    <div class="interest-block">
      <div class="interest-label pending-overdue">${pending} cycle${pending !== 1 ? "s" : ""} pending · ${recorded} paid</div>
      ${interests ? `<div class="interest-dates">${interests}</div>` : ""}
    </div>`;

  const phoneRow = r.phone
    ? `<div class="card-phone"><svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>${r.phone}</div>`
    : "";
  const opts = (r.options || []).map(o => `<span class="tag">${o}</span>`).join("");

  return `
    <div class="card card-pending">
      <div class="card-top">
        <div class="card-top-left">
          <span class="card-id">#${r.id}</span>
          <span class="card-date-badge">${r.date}</span>
        </div>
        <span class="card-price">₹${Number(r.price).toLocaleString("en-IN")}</span>
      </div>
      <div class="card-desc">${r.description}</div>
      ${phoneRow}
      ${opts ? `<div class="card-options">${opts}</div>` : ""}
      ${interestBlock}
      <div class="card-meta">Created ${fmt(r.createdDate)}</div>
      <div class="card-divider"></div>
      <div class="card-actions">
        <button class="action-btn green" data-action="returned" data-doc="${r._docId}">
          <svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
          Returned
        </button>
        <button class="action-btn blue" data-action="sold" data-doc="${r._docId}">
          <svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          Sold
        </button>
        <button class="action-btn orange" data-action="interest" data-doc="${r._docId}">
          <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Interest
        </button>
        <button class="action-btn gray" data-action="call" data-phone="${r.phone}">
          <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
          Call
        </button>
        <button class="action-btn dummy" data-action="dummy" data-doc="${r._docId}">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
          Dummy
        </button>
      </div>
    </div>`;
}

// ── Render Sold ───────────────────────────────────────────────────────────────
function renderSold() {
  if (isLoading) return;
  const query    = document.getElementById("search-sold").value;
  const sold     = allRecords.filter(r => r.status === "sold")
    .sort((a, b) => new Date(b.soldDate || 0) - new Date(a.soldDate || 0));
  const filtered = filterBySearch(sold, query);
  const el       = document.getElementById("sold-list");
  el.innerHTML   = filtered.length
    ? filtered.map(r => cardHTML(r, "sold")).join("")
    : '<div class="empty">No sold records</div>';
  attachCardEvents(el);
}
document.getElementById("search-sold").addEventListener("input", renderSold);
document.getElementById("clear-sold").addEventListener("click", () => {
  showModal("Delete all sold records?", async () => {
    try { await supabaseDeleteByStatus("sold"); } catch(e) {}
    allRecords = allRecords.filter(r => r.status !== "sold");
    renderRecords(); renderReturned(); renderSold(); renderPending();
  });
});

// ── Card HTML ─────────────────────────────────────────────────────────────────
function cardHTML(r, mode) {
  const opts      = (r.options || []).map(o => `<span class="tag">${o}</span>`).join("");
  const interests = (r.interestDates || []).map(d => `<span class="interest-tag">${fmtInterest(d)}</span>`).join("");
  const interestBlock = r.interestDates?.length
    ? `<div class="interest-block">
         <div class="interest-label">Interest Paid (${r.interestDates.length})</div>
         <div class="interest-dates">${interests}</div>
       </div>`
    : "";

  let meta = `Created ${fmt(r.createdDate)}`;
  if (mode === "returned") meta += ` · Returned ${fmt(r.returnedDate)}`;
  if (mode === "sold")     meta += ` · Sold ${fmt(r.soldDate)}`;

  const phoneRow = r.phone
    ? `<div class="card-phone">
         <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
         ${r.phone}
       </div>`
    : "";

  const activeActions = `
    <button class="action-btn green" data-action="returned" data-doc="${r._docId}">
      <svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
      Returned
    </button>
    <button class="action-btn blue" data-action="sold" data-doc="${r._docId}">
      <svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      Sold
    </button>
    <button class="action-btn orange" data-action="interest" data-doc="${r._docId}">
      <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      Interest
    </button>
    <button class="action-btn gray" data-action="call" data-phone="${r.phone}">
      <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
      Call
    </button>
    <button class="action-btn yellow" data-action="edit" data-doc="${r._docId}" style="grid-column:span 2">
      <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Edit
    </button>
    <button class="action-btn dummy" data-action="dummy" data-doc="${r._docId}" style="grid-column:span 2">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
      Dummy
    </button>`;

  const otherActions = `
    <div class="card-actions three-col">
      <button class="action-btn yellow" data-action="undo" data-doc="${r._docId}">
        <svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
        Undo
      </button>
      <button class="action-btn red" data-action="delete" data-doc="${r._docId}">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        Delete
      </button>
      <button class="action-btn gray" data-action="call" data-phone="${r.phone}">
        <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.82a16 16 0 0 0 6.29 6.29l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        Call
      </button>
    </div>`;

  return `
    <div class="card">
      <div class="card-top">
        <div class="card-top-left">
          <span class="card-id">#${r.id}</span>
          <span class="card-date-badge">${r.date}</span>
        </div>
        <span class="card-price">₹${Number(r.price).toLocaleString("en-IN")}</span>
      </div>
      <div class="card-desc">${r.description}</div>
      ${phoneRow}
      ${opts ? `<div class="card-options">${opts}</div>` : ""}
      ${interestBlock}
      <div class="card-meta">${meta}</div>
      <div class="card-divider"></div>
      ${mode === "active" ? `<div class="card-actions">${activeActions}</div>` : otherActions}
    </div>`;
}

// ── Card Events ───────────────────────────────────────────────────────────────
function attachCardEvents(container) {
  container.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      const docId  = btn.dataset.doc;

      if (action === "call") {
        window.location.href = "tel:" + btn.dataset.phone;
        return;
      }
      if (action === "edit") {
        const rec = allRecords.find(r => r._docId === docId);
        if (!rec) return;
        document.getElementById("edit-doc-id").value  = docId;
        document.getElementById("edit-id").value      = rec.id || "";
        document.getElementById("edit-date").value    = rec.date || "";
        document.getElementById("edit-desc").value    = rec.description || "";
        document.getElementById("edit-phone").value   = rec.phone || "";
        document.getElementById("edit-price").value   = rec.price || "";
        document.getElementById("edit-modal").classList.remove("hidden");
        return;
      }
      if (action === "dummy") {
        showModal("Remove this record? (will not affect stats)", async () => {
          const rec = allRecords.find(r => r._docId === docId);
          if (rec) {
            const key = monthKey(rec.createdDate);
            const price = Number(rec.price) || 0;
            try {
              if (rec._dbId) await supabaseDelete(rec._dbId);
            } catch(e) {}
            if (monthlyStats[key]) {
              const newCost = Math.max(0, (monthlyStats[key].cost || 0) - price);
              await supabaseUpsertMonthly(key, newCost, monthlyStats[key]?.profit || 0);
              monthlyStats[key].cost = newCost;
              if (monthlyStats[key].cost === 0 && monthlyStats[key].profit === 0) delete monthlyStats[key];
            }
          }
          allRecords = allRecords.filter(r => r._docId !== docId);
          renderRecords(); renderReturned(); renderSold(); renderPending();
        });
        return;
      }
      if (action === "undo") {
        showModal("Restore this record to Active?", async () => {
          const rec = allRecords.find(r => r._docId === docId);
          if (rec) {
            rec.status = "active";
            rec.returnedDate = null;
            rec.soldDate = null;
            rec.interestDates = [];
            try {
              if (rec._dbId) await supabaseUpdate(rec._dbId, { status: "active", returnedDate: null, soldDate: null, interestDates: [] });
            } catch(e) {}
            renderRecords(); renderReturned(); renderSold(); renderPending();
          }
        });
        return;
      }
      if (action === "delete") {
        showModal("Delete this record permanently?", async () => {
          const rec = allRecords.find(r => r._docId === docId);
          if (rec) {
            try {
              if (rec._dbId) await supabaseDelete(rec._dbId);
            } catch(e) {}
          }
          allRecords = allRecords.filter(r => r._docId !== docId);
          renderRecords(); renderReturned(); renderSold(); renderPending();
        });
        return;
      }
      if (action === "returned") {
        showModal("Mark as Returned?", async () => {
          const rec = allRecords.find(r => r._docId === docId);
          if (rec) {
            rec.status = "returned";
            rec.returnedDate = new Date().toISOString();
            try {
              if (rec._dbId) await supabaseUpdate(rec._dbId, { status: "returned", returnedDate: rec.returnedDate });
            } catch(e) {}
            renderRecords(); renderReturned(); renderSold(); renderPending();
          }
        });
        return;
      }
      if (action === "sold") {
        showModal("Mark as Sold?", async () => {
          const rec = allRecords.find(r => r._docId === docId);
          if (rec) {
            rec.status = "sold";
            rec.soldDate = new Date().toISOString();
            try {
              if (rec._dbId) await supabaseUpdate(rec._dbId, { status: "sold", soldDate: rec.soldDate });
            } catch(e) {}
            renderRecords(); renderReturned(); renderSold(); renderPending();
          }
        });
        return;
      }
      if (action === "interest") {
        const rec = allRecords.find(r => r._docId === docId);
        if (!rec) return;
        const dates = rec.interestDates || [];
        const today = todayDDMMYY();
        showModal(`Record interest paid (${today})?`, async () => {
          rec.interestDates = [...dates, today];
          try {
            if (rec._dbId) await supabaseUpdate(rec._dbId, { interestDates: rec.interestDates });
          } catch(e) {}
          renderRecords(); renderReturned(); renderSold(); renderPending();
        });
      }
    });
  });
}

// ── Edit Modal ────────────────────────────────────────────────────────────────
document.getElementById("edit-bulk-add").addEventListener("click", async () => {
  const docId = document.getElementById("edit-doc-id").value;
  const input = document.getElementById("edit-bulk-dates").value.trim();
  const msg   = document.getElementById("edit-bulk-msg");
  if (!docId || !input) { msg.textContent = "Enter dates first."; msg.className = "form-msg err"; return; }

  const rec = allRecords.find(r => r._docId === docId);
  if (!rec) return;

  const existing = new Set(rec.interestDates || []);
  const newDates = input.split(",").map(s => s.trim()).filter(Boolean);
  const added = [], invalid = [], dupes = [];

  for (const d of newDates) {
    if (!isValidDDMMYY(d)) { invalid.push(d); continue; }
    if (existing.has(d)) { dupes.push(d); continue; }
    existing.add(d);
    added.push(d);
  }

  if (invalid.length) { msg.textContent = `Invalid: ${invalid.join(", ")}`; msg.className = "form-msg err"; return; }

  rec.interestDates = [...existing];
  try {
    if (rec._dbId) await supabaseUpdate(rec._dbId, { interestDates: rec.interestDates });
  } catch(e) {}

  let resultMsg = `✓ ${added.length} date(s) added.`;
  if (dupes.length) resultMsg += ` ${dupes.length} duplicate(s) skipped.`;
  msg.textContent = resultMsg;
  msg.className = "form-msg ok";
  document.getElementById("edit-bulk-dates").value = "";
});

document.getElementById("edit-cancel").addEventListener("click", () => {
  document.getElementById("edit-modal").classList.add("hidden");
});

document.getElementById("edit-clear-interest").addEventListener("click", async () => {
  const docId = document.getElementById("edit-doc-id").value;
  if (!docId) return;
  showModal("Clear all interest dates for this record?", async () => {
    const rec = allRecords.find(r => r._docId === docId);
    if (rec) {
      rec.interestDates = [];
      try {
        if (rec._dbId) await supabaseUpdate(rec._dbId, { interestDates: [] });
      } catch(e) {}
    }
    document.getElementById("edit-modal").classList.add("hidden");
    renderRecords(); renderReturned(); renderSold(); renderPending();
  });
});

// Helper: Convert DD.MM.YY to ISO date string for createdDate
function dmyToISO(dateStr) {
  if (!dateStr) return new Date().toISOString();
  const m = dateStr.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = "20" + y;
    const dt = new Date(parseInt(y), parseInt(mo) - 1, parseInt(d));
    if (!isNaN(dt.getTime())) return dt.toISOString();
  }
  return new Date().toISOString();
}

document.getElementById("edit-confirm").addEventListener("click", async () => {
  const docId = document.getElementById("edit-doc-id").value;
  const rec = allRecords.find(r => r._docId === docId);
  if (rec) {
    const newDate = document.getElementById("edit-date").value.trim();
    rec.id          = document.getElementById("edit-id").value.trim();
    rec.date        = newDate;
    rec.description = document.getElementById("edit-desc").value.trim();
    rec.phone       = document.getElementById("edit-phone").value.trim();
    rec.price       = parseFloat(document.getElementById("edit-price").value) || 0;
    // When date changes, update createdDate to match
    rec.createdDate = dmyToISO(newDate);
    try {
      if (rec._dbId) await supabaseUpdate(rec._dbId, rec);
    } catch(e) {}
    renderRecords(); renderReturned(); renderSold(); renderPending();
  }
  document.getElementById("edit-modal").classList.add("hidden");
});

// ── Modal ─────────────────────────────────────────────────────────────────────
function showModal(msg, onConfirm) {
  document.getElementById("modal-msg").textContent = msg;
  document.getElementById("modal").classList.remove("hidden");
  pendingAction = onConfirm;
}
document.getElementById("modal-cancel").addEventListener("click", () => {
  document.getElementById("modal").classList.add("hidden");
  pendingAction = null;
});
document.getElementById("modal-confirm").addEventListener("click", async () => {
  document.getElementById("modal").classList.add("hidden");
  if (pendingAction) { await pendingAction(); pendingAction = null; }
});

// ── Stats ─────────────────────────────────────────────────────────────────────
function renderStats() {
  if (isLoading) return;
  const active      = allRecords.filter(r => r.status === "active");
  const activeValue = active.reduce((s, r) => s + (Number(r.price) || 0), 0);
  const activeProfit = calculateTotalInterestProfit();

  document.getElementById("stat-active-value").textContent   = "₹" + activeValue.toLocaleString("en-IN");
  document.getElementById("stat-interest").textContent       = "₹" + activeProfit.toLocaleString("en-IN");
  document.getElementById("stat-count-active").textContent   = active.length;
  document.getElementById("stat-count-sold").textContent     = allRecords.filter(r => r.status === "sold").length;
  document.getElementById("stat-count-returned").textContent = allRecords.filter(r => r.status === "returned").length;

  const computed = {};
  allRecords.forEach(r => {
    if (r.isDummy) return;
    if (!r.createdDate) return;
    const key = monthKey(r.createdDate);
    if (!computed[key]) computed[key] = { cost: 0 };
    computed[key].cost += Number(r.price) || 0;
  });

  const monthlyProfit = calculateMonthlyProfit();
  const merged = {};
  const allKeys = new Set([...Object.keys(computed), ...Object.keys(monthlyProfit), ...Object.keys(monthlyStats)]);
  allKeys.forEach(k => {
    const c = computed[k] ? computed[k].cost : 0;
    const pCost = monthlyStats[k] ? (monthlyStats[k].cost || 0) : 0;
    const cost = Math.max(c, pCost);
    const profit = monthlyProfit[k] || 0;
    if (cost > 0 || profit > 0) merged[k] = { cost, profit };
  });

  renderMonthlyList(merged);
}

// ── Monthly list ──────────────────────────────────────────────────────────────
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function renderMonthlyList(merged) {
  const el  = document.getElementById("monthly-list");
  const now = new Date();
  const rows = [];

  for (let i = 0; i < 24; i++) {
    const d    = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key  = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const name = MONTH_NAMES[d.getMonth()] + " " + d.getFullYear();
    const data = merged[key] || { cost: 0, profit: 0 };
    if (!data.cost && !data.profit) continue;
    const isCurrentMonth = i === 0;
    rows.push({ name, data, isCurrentMonth, key });
  }

  if (!rows.length) { el.innerHTML = '<div class="empty">No data yet</div>'; return; }

  el.innerHTML = rows.map(({ name, data, isCurrentMonth, key }) => `
    <div class="month-row ${isCurrentMonth ? "month-row-current" : ""}" data-month-key="${key}" style="cursor:pointer">
      <div class="month-name">
        ${name}
        ${isCurrentMonth ? '<span class="month-badge">Now</span>' : ""}
      </div>
      <div class="month-figures">
        <div class="month-cost">₹${(data.cost || 0).toLocaleString("en-IN")}</div>
        <div class="month-profit">+₹${(data.profit || 0).toLocaleString("en-IN")}</div>
      </div>
    </div>
  `).join("");

  el.querySelectorAll(".month-row[data-month-key]").forEach(row => {
    row.addEventListener("click", async () => {
      const key = row.dataset.monthKey;
      showModal(`Delete data for ${key}? This cannot be undone.`, async () => {
        try { await supabaseDeleteMonthly(key); } catch(e) {}
        delete monthlyStats[key];
        renderStats();
      });
    });
  });

  renderChart(merged);
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function renderChart(merged) {
  const labels = [], costData = [], profitData = [];
  const start = new Date(2026, 0, 1);
  const now   = new Date();
  const cur   = new Date(start);

  while (cur <= now) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
    labels.push(MONTH_NAMES[cur.getMonth()] + " " + String(cur.getFullYear()).slice(2));
    const d = merged[key] || { cost: 0, profit: 0 };
    costData.push(d.cost || 0);
    profitData.push(d.profit || 0);
    cur.setMonth(cur.getMonth() + 1);
  }

  const ctx = document.getElementById("chart-main").getContext("2d");
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Cost (₹)",   data: costData,   backgroundColor: "#0a0a0a", borderRadius: 4, barPercentage: 0.7 },
        { label: "Profit (₹)", data: profitData, backgroundColor: "#d4d4d4", borderRadius: 4, barPercentage: 0.7 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { font: { family: "Inter", size: 11 }, boxWidth: 12 } } },
      scales: {
        x: { ticks: { font: { family: "Inter", size: 10 }, color: "#999" }, grid: { display: false }, border: { display: false } },
        y: {
          ticks: { font: { family: "Inter", size: 10 }, color: "#999", callback: v => v >= 1000 ? "₹" + (v/1000).toFixed(0) + "k" : "₹" + v },
          grid: { color: "#f5f5f5" }, border: { display: false }
        }
      }
    }
  });
}

// ── Reset Profits ─────────────────────────────────────────────────────────────
document.getElementById("btn-reset-profits").addEventListener("click", () => {
  showModal("Reset ALL monthly profits to zero? This cannot be undone.", async () => {
    const msg = document.getElementById("reset-msg");
    allRecords.forEach(r => { r.interestDates = []; });
    // Update all records in Supabase
    for (const r of allRecords) {
      try {
        if (r._dbId) await supabaseUpdate(r._dbId, { interestDates: [] });
      } catch(e) {}
    }
    msg.textContent = "All profits reset to zero.";
    msg.className = "form-msg ok";
    setTimeout(() => { msg.textContent = ""; }, 3000);
  });
});

// ── CSV Export ────────────────────────────────────────────────────────────────
document.getElementById("btn-export-csv").addEventListener("click", () => {
  const active = allRecords.filter(r => r.status === "active");
  if (!active.length) { alert("No active records to export."); return; }

  const headers = ["ID","Date","Description","Options","Phone","Price","Created Date","Interest Dates","Interest Paid Count"];
  const rows = active.map(r => [
    r.id, r.date, r.description,
    (r.options || []).join(" | "),
    r.phone, r.price,
    fmt(r.createdDate),
    (r.interestDates || []).map(d => fmtInterest(d)).join(" | "),
    (r.interestDates || []).length
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `active-records-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ── Initialize ────────────────────────────────────────────────────────────────
loadData();