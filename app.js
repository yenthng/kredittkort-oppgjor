const PEOPLE = ["Yen", "Tien"];
const CATEGORIES = ["Mat", "Fritid", "Annet"];
const BUCKETS = ["Yen", "Tien", "Mat", "Fritid", "Annet"];

const STORAGE = {
  data: "kredittkort_data_v2",
  rules: "kredittkort_rules_v2",
};

let transactions = [];
let rules = [];
let activeTab = "list";

const $ = (id) => document.getElementById(id);

function runTests() {
  console.assert(BUCKETS.length === 5, "BUCKETS should contain five categories");
  console.assert(toNumber("1 234,50") === 1234.5, "Norwegian decimal parsing should work");
  console.assert(dateIso("05.02.2026") === "2026-02-05", "Norwegian date parsing should work");
  console.assert(
    isBankNorwegianHeaders([
      "TransactionDate",
      "Text",
      "Type",
      "Currency Amount",
      "Currency Rate",
      "Currency",
      "Amount",
      "Merchant Area",
      "Merchant Category",
    ]),
    "Bank Norwegian headers should be detected"
  );
  console.assert(
    isSebRows([["foo"], ["Kjøp/uttak"], ["Dato", "Bokført", "Spesifikasjon", "Sted", "Valuta", "Utl. beløp", "Beløp"]]),
    "SEB rows should be detected"
  );
}

function currency(value) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function numberFormat(value) {
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9æøåÆØÅ ]/g, "")
    .trim();
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (value == null) return 0;
  const cleaned = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateIso(value) {
  if (!value && value !== 0) return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return "";
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }

  const raw = String(value).trim();
  const norwegianDate = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (norwegianDate) {
    return `${norwegianDate[3]}-${norwegianDate[2].padStart(2, "0")}-${norwegianDate[1].padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString().slice(0, 10);
}

function makeId() {
  return crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
}

function saveLocal() {
  localStorage.setItem(STORAGE.data, JSON.stringify(transactions));
  localStorage.setItem(STORAGE.rules, JSON.stringify(rules));
}

function loadLocal() {
  try {
    transactions = JSON.parse(localStorage.getItem(STORAGE.data) || "[]");
    rules = JSON.parse(localStorage.getItem(STORAGE.rules) || "[]");
  } catch {
    transactions = [];
    rules = [];
  }
}

function guessBucket(transaction) {
  const haystack = normalize(
    [
      transaction.description,
      transaction.place,
      transaction.merchantArea,
      transaction.merchantCategory,
      transaction.text,
    ].join(" ")
  );

  for (const rule of rules) {
    if (rule.matchText && haystack.includes(normalize(rule.matchText))) {
      return rule.bucket;
    }
  }

  return transaction.originalCategory && BUCKETS.includes(transaction.originalCategory)
    ? transaction.originalCategory
    : "Annet";
}

function isBankNorwegianHeaders(headers) {
  const normalized = headers.map((header) => String(header || "").trim().toLowerCase());
  return (
    normalized.includes("transactiondate") &&
    normalized.includes("text") &&
    normalized.includes("currency amount") &&
    normalized.includes("currency rate") &&
    normalized.includes("amount") &&
    normalized.includes("merchant category")
  );
}

function isSebRows(rows) {
  return rows.some((row) => {
    const firstCell = String((row || [])[0] || "").trim();
    return firstCell === "Kjøp/uttak" || firstCell.includes("Kjøp/uttak");
  });
}

function parseBankNorwegianRows(rows, fileName) {
  return rows
    .map((row, index) => {
      const date = dateIso(row.TransactionDate);
      const bookedDate = dateIso(row.BookDate);
      const description = String(row.Text || "").trim();
      const amount = toNumber(row.Amount);
      const currencyAmount = toNumber(row["Currency Amount"]);
      const currencyCode = String(row.Currency || "").trim();
      const merchantCategory = String(row["Merchant Category"] || "").trim();
      const merchantArea = String(row["Merchant Area"] || "").trim();

      const transaction = {
        id: `${fileName}-${index}-${date}-${description}-${amount}`,
        sourceFormat: "Bank Norwegian",
        fileName,
        date,
        bookedDate,
        description,
        merchant: description,
        merchantArea,
        merchantCategory,
        currency: currencyCode,
        currencyAmount,
        amount,
        originalCategory: "",
        text: [description, merchantArea, merchantCategory, currencyCode].join(" "),
        month: (bookedDate || date || "Ukjent").slice(0, 7) || "Ukjent",
      };
      transaction.bucket = guessBucket(transaction);
      return transaction;
    })
    .filter((transaction) => transaction.description && transaction.amount !== 0);
}

function parseSebRows(rows, fileName) {
  const startIndex = rows.findIndex((row) => {
    const firstCell = String((row || [])[0] || "").trim();
    return firstCell === "Kjøp/uttak" || firstCell.includes("Kjøp/uttak");
  });

  if (startIndex < 0) return [];

  const headers = (rows[startIndex + 1] || []).map((header) => String(header || "").trim().toLowerCase());
  const indexOf = (name) => headers.indexOf(name);

  const iDate = indexOf("dato");
  const iBooked = indexOf("bokført");
  const iDescription = indexOf("spesifikasjon");
  const iPlace = indexOf("sted");
  const iCurrency = indexOf("valuta");
  const iCurrencyAmount = indexOf("utl. beløp");
  const iAmount = indexOf("beløp");
  const iCategory = indexOf("kategori");

  const parsed = [];
  for (let i = startIndex + 2; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const firstCell = String(row[0] || "").trim();

    if (firstCell.includes("Totalbeløp") || firstCell === "Total") break;
    if (row.every((cell) => cell == null || String(cell).trim() === "")) continue;

    const description = iDescription >= 0 ? String(row[iDescription] || "").trim() : "";
    if (!description) continue;

    const amount = iAmount >= 0 ? toNumber(row[iAmount]) : 0;
    if (amount === 0) continue;

    const date = iDate >= 0 ? dateIso(row[iDate]) : "";
    const bookedDate = iBooked >= 0 ? dateIso(row[iBooked]) : date;
    const originalCategory = iCategory >= 0 ? String(row[iCategory] || "").trim() : "";
    const currencyCode = iCurrency >= 0 ? String(row[iCurrency] || "NOK").trim() : "NOK";
    const currencyAmount = iCurrencyAmount >= 0 ? toNumber(row[iCurrencyAmount]) : 0;

    const transaction = {
      id: `${fileName}-${i}-${date}-${description}-${amount}`,
      sourceFormat: "SEB",
      fileName,
      date,
      bookedDate,
      description,
      place: iPlace >= 0 ? String(row[iPlace] || "").trim() : "",
      currency: currencyCode,
      currencyAmount,
      amount,
      originalCategory,
      text: row.join(" "),
      month: (bookedDate || date || "Ukjent").slice(0, 7) || "Ukjent",
    };
    transaction.bucket = guessBucket(transaction);
    parsed.push(transaction);
  }

  return parsed;
}

function parseGenericRows(rows, fileName) {
  if (!rows.length) return [];

  const headers = Object.keys(rows[0]);
  const lowerHeaders = headers.map((header) => String(header).toLowerCase());
  const findColumn = (names) => {
    const index = lowerHeaders.findIndex((header) => names.some((name) => header.includes(name)));
    return index >= 0 ? headers[index] : headers[0];
  };

  const dateCol = findColumn(["dato", "date"]);
  const descriptionCol = findColumn(["tekst", "beskrivelse", "description", "merchant", "text"]);
  const amountCol = findColumn(["beløp", "amount", "sum"]);
  const categoryCol = findColumn(["kategori", "category"]);
  const currencyAmountCol = findColumn(["currency amount", "utl. beløp", "valutabeløp"]);
  const currencyCol = findColumn(["currency", "valuta"]);

  return rows
    .map((row, index) => {
      const date = dateIso(row[dateCol]);
      const description = String(row[descriptionCol] || "").trim();
      const amount = toNumber(row[amountCol]);
      const originalCategory = String(row[categoryCol] || "").trim();
      const currencyAmount = currencyAmountCol ? toNumber(row[currencyAmountCol]) : 0;
      const currencyCode = currencyCol ? String(row[currencyCol] || "").trim() : "";

      const transaction = {
        id: `${fileName}-${index}-${date}-${description}-${amount}`,
        sourceFormat: "Standard",
        fileName,
        date,
        description,
        amount,
        originalCategory,
        currencyAmount,
        currency: currencyCode,
        text: Object.values(row).join(" "),
        month: (date || "Ukjent").slice(0, 7) || "Ukjent",
      };
      transaction.bucket = guessBucket(transaction);
      return transaction;
    })
    .filter((transaction) => transaction.description && transaction.amount !== 0);
}

function buildRulesFromCategories() {
  const counts = {};

  for (const transaction of transactions) {
    if (!transaction.originalCategory || !BUCKETS.includes(transaction.originalCategory)) continue;

    const key = normalize(transaction.description);
    if (!key) continue;

    counts[key] = counts[key] || {};
    counts[key][transaction.originalCategory] = (counts[key][transaction.originalCategory] || 0) + 1;
  }

  const autoRules = Object.keys(counts).map((key) => ({
    id: makeId(),
    matchText: key,
    bucket: Object.entries(counts[key]).sort((a, b) => b[1] - a[1])[0][0],
    auto: true,
  }));

  rules = rules.filter((rule) => !rule.auto).concat(autoRules);
}

function filteredTransactions() {
  const search = $("searchInput").value.toLowerCase();
  const month = $("monthSelect").value;

  return transactions.filter((transaction) => {
    const matchesMonth = month === "alle" || transaction.month === month;
    const haystack = JSON.stringify(transaction).toLowerCase();
    return matchesMonth && haystack.includes(search);
  });
}

function totalsFor(list) {
  const totals = { overall: 0, Yen: 0, Tien: 0, Mat: 0, Fritid: 0, Annet: 0 };

  for (const transaction of list) {
    const amount = Math.abs(Number(transaction.amount || 0));
    totals.overall += amount;
    totals[transaction.bucket] = (totals[transaction.bucket] || 0) + amount;
  }

  return totals;
}

function renderMonths() {
  const current = $("monthSelect").value;
  const months = [...new Set(transactions.map((transaction) => transaction.month).filter(Boolean))].sort().reverse();

  $("monthSelect").innerHTML = '<option value="alle">Alle måneder</option>' +
    months.map((month) => `<option value="${month}">${month}</option>`).join("");

  if (months.includes(current)) $("monthSelect").value = current;
}

function renderStats(totals) {
  const items = [
    ["Totalt", totals.overall],
    ["Yen", totals.Yen],
    ["Tien", totals.Tien],
    ["Mat", totals.Mat],
    ["Fritid", totals.Fritid],
    ["Annet", totals.Annet],
  ];

  $("stats").innerHTML = items
    .map(([label, value]) => `<div class="stat"><div class="label">${label}</div><div class="value">${currency(value)}</div></div>`)
    .join("");
}

function renderSources() {
  const grouped = {};

  for (const transaction of transactions) {
    const key = transaction.fileName || "Ukjent fil";
    grouped[key] = grouped[key] || { count: 0, sum: 0, months: new Set(), format: transaction.sourceFormat || "" };
    grouped[key].count += 1;
    grouped[key].sum += Math.abs(Number(transaction.amount || 0));
    if (transaction.month) grouped[key].months.add(transaction.month);
  }

  const files = Object.keys(grouped).sort();
  $("sourceList").innerHTML = files.length
    ? files
        .map((fileName) => {
          const group = grouped[fileName];
          return `<div class="list-item"><div><strong>${fileName}</strong><div class="muted">${group.format} · ${group.count} transaksjoner · ${Array.from(group.months).join(", ")} · ${currency(group.sum)}</div></div><button class="danger small" data-action="deleteSource" data-file="${encodeURIComponent(fileName)}">Slett liste</button></div>`;
        })
        .join("")
    : '<div class="empty">Ingen transaksjonslister er lastet opp.</div>';
}

function renderTable(list) {
  const body = $("transactionBody");

  if (!list.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">Ingen transaksjoner å vise.</td></tr>';
    return;
  }

  body.innerHTML = list
    .map((transaction) => {
      const options = BUCKETS.map(
        (bucket) => `<option value="${bucket}" ${transaction.bucket === bucket ? "selected" : ""}>${bucket}</option>`
      ).join("");
      const detail = [
        transaction.place || transaction.merchantArea,
        transaction.merchantCategory,
        transaction.currency,
        transaction.fileName,
      ]
        .filter(Boolean)
        .join(" • ");
      const currencyAmount = transaction.currencyAmount
        ? `${numberFormat(Math.abs(transaction.currencyAmount))} ${transaction.currency || ""}`
        : "-";

      return `<tr><td>${transaction.date || "-"}</td><td><strong>${transaction.description || "Uten tekst"}</strong><div class="muted">${detail}</div></td><td>${currency(Math.abs(transaction.amount))}</td><td>${currencyAmount}</td><td><select data-action="bucket" data-id="${transaction.id}">${options}</select></td><td><button class="secondary small" data-action="saveRule" data-id="${transaction.id}">Lagre regel</button></td></tr>`;
    })
    .join("");
}

function renderSummary(totals) {
  $("peopleSummary").innerHTML = PEOPLE.map(
    (person) => `<div class="sumrow"><span>${person}</span><strong>${currency(totals[person])}</strong></div>`
  ).join("");

  $("categorySummary").innerHTML = CATEGORIES.map(
    (category) => `<div class="sumrow"><span>${category}</span><strong>${currency(totals[category])}</strong></div>`
  ).join("");
}

function renderRules() {
  $("ruleBucket").innerHTML = BUCKETS.map((bucket) => `<option value="${bucket}">${bucket}</option>`).join("");
  $("rulesList").innerHTML = rules.length
    ? rules
        .map(
          (rule) => `<div class="list-item"><div><strong>${rule.matchText}</strong><div class="muted">→ ${rule.bucket}${rule.auto ? " · auto fra Excel" : ""}</div></div><button class="secondary small" data-action="deleteRule" data-id="${rule.id}">Fjern</button></div>`
        )
        .join("")
    : '<div class="empty">Ingen regler enda.</div>';
}

function renderRecurring() {
  const grouped = {};

  for (const transaction of transactions) {
    const key = normalize(transaction.description);
    if (!key) continue;

    grouped[key] = grouped[key] || { label: transaction.description, count: 0, buckets: {} };
    grouped[key].count += 1;
    grouped[key].buckets[transaction.bucket] = (grouped[key].buckets[transaction.bucket] || 0) + 1;
  }

  const items = Object.values(grouped)
    .filter((item) => item.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  $("recurringList").innerHTML = items.length
    ? items
        .map((item) => {
          const topBucket = Object.entries(item.buckets).sort((a, b) => b[1] - a[1])[0][0];
          return `<div class="list-item"><div><strong>${item.label}</strong><div class="muted">${item.count} transaksjoner</div></div><span class="pill">Mest brukt: ${topBucket}</span></div>`;
        })
        .join("")
    : '<div class="empty">Last opp data for å se gjentakende transaksjoner.</div>';
}

function render() {
  renderMonths();
  const list = filteredTransactions();
  const totals = totalsFor(list);

  renderStats(totals);
  renderSources();
  renderTable(list);
  renderSummary(totals);
  renderRules();
  renderRecurring();

  $("exportBtn").disabled = !transactions.length;
  $("rerunBtn").disabled = !transactions.length;
  $("listPanel").classList.toggle("hidden", activeTab !== "list");
  $("summaryPanel").classList.toggle("hidden", activeTab !== "summary");
  $("tabList").classList.toggle("active", activeTab === "list");
  $("tabSummary").classList.toggle("active", activeTab === "summary");
}

async function importFiles(files) {
  const imported = [];

  for (const file of files) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const objectRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    const arrayRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    let parsed = [];
    if (objectRows.length && isBankNorwegianHeaders(Object.keys(objectRows[0]))) {
      parsed = parseBankNorwegianRows(objectRows, file.name);
    } else if (isSebRows(arrayRows)) {
      parsed = parseSebRows(arrayRows, file.name);
    } else {
      parsed = parseGenericRows(objectRows, file.name);
    }

    imported.push(...parsed);
  }

  return imported;
}

$("fileInput").addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  const imported = await importFiles(files);
  if (!imported.length) {
    $("status").innerText = "Fant ingen transaksjoner i filen(e).";
    return;
  }

  transactions = transactions.concat(imported);
  transactions = Array.from(new Map(transactions.map((transaction) => [transaction.id, transaction])).values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );

  buildRulesFromCategories();
  transactions = transactions.map((transaction) => ({ ...transaction, bucket: guessBucket(transaction) }));

  saveLocal();
  $("status").innerText = `Lastet inn ${imported.length} nye transaksjoner fra ${files.length} fil(er).`;
  render();
});

$("searchInput").addEventListener("input", render);
$("monthSelect").addEventListener("change", render);
$("tabList").addEventListener("click", () => {
  activeTab = "list";
  render();
});
$("tabSummary").addEventListener("click", () => {
  activeTab = "summary";
  render();
});

$("transactionBody").addEventListener("change", (event) => {
  if (event.target.dataset.action === "bucket") {
    const transaction = transactions.find((item) => item.id === event.target.dataset.id);
    if (transaction) {
      transaction.bucket = event.target.value;
      saveLocal();
      render();
    }
  }
});

$("transactionBody").addEventListener("click", (event) => {
  if (event.target.dataset.action === "saveRule") {
    const transaction = transactions.find((item) => item.id === event.target.dataset.id);
    if (!transaction) return;

    const matchText = normalize(transaction.description);
    if (rules.some((rule) => normalize(rule.matchText) === matchText)) {
      $("status").innerText = `Regel for ${transaction.description} finnes allerede.`;
      return;
    }

    rules.push({ id: makeId(), matchText, bucket: transaction.bucket, auto: false });
    saveLocal();
    $("status").innerText = `Lagret regel for ${transaction.description} → ${transaction.bucket}.`;
    render();
  }
});

$("rulesList").addEventListener("click", (event) => {
  if (event.target.dataset.action === "deleteRule") {
    rules = rules.filter((rule) => rule.id !== event.target.dataset.id);
    saveLocal();
    render();
  }
});

$("sourceList").addEventListener("click", (event) => {
  if (event.target.dataset.action === "deleteSource") {
    const fileName = decodeURIComponent(event.target.dataset.file || "");
    const before = transactions.length;
    transactions = transactions.filter((transaction) => (transaction.fileName || "Ukjent fil") !== fileName);
    saveLocal();
    $("status").innerText = `Slettet ${before - transactions.length} transaksjoner fra ${fileName}. Reglene er beholdt.`;
    render();
  }
});

$("addRuleBtn").addEventListener("click", () => {
  const matchText = $("ruleText").value.trim();
  if (!matchText) return;

  rules.push({ id: makeId(), matchText, bucket: $("ruleBucket").value, auto: false });
  $("ruleText").value = "";
  saveLocal();
  render();
});

$("rerunBtn").addEventListener("click", () => {
  transactions = transactions.map((transaction) => ({ ...transaction, bucket: guessBucket(transaction) }));
  saveLocal();
  $("status").innerText = "Regler brukt på nytt på alle transaksjoner.";
  render();
});

$("resetBtn").addEventListener("click", () => {
  transactions = [];
  rules = [];
  localStorage.removeItem(STORAGE.data);
  localStorage.removeItem(STORAGE.rules);
  $("status").innerText = "Alle lokale data er slettet.";
  render();
});

$("exportBtn").addEventListener("click", () => {
  const rows = filteredTransactions().map((transaction) => ({
    Dato: transaction.date,
    Bokfort: transaction.bookedDate || "",
    Beskrivelse: transaction.description,
    BelopNOK: transaction.amount,
    BelopValuta: transaction.currencyAmount || "",
    Valuta: transaction.currency || "",
    Kategori: transaction.bucket,
    OriginalKategori: transaction.originalCategory || "",
    MerchantCategory: transaction.merchantCategory || "",
    Maaned: transaction.month,
    KildeFil: transaction.fileName,
    Format: transaction.sourceFormat || "",
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Oppgjor");
  XLSX.writeFile(workbook, "kredittkort-oppgjor-kategorisert.xlsx");
});

runTests();
loadLocal();
if (transactions.length) {
  $("status").innerText = `Lastet inn ${transactions.length} transaksjoner fra denne nettleseren.`;
}
render();
