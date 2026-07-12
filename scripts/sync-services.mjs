// Pulls the services catalog from Google Sheets and writes services.json.
// Usage: npm run sync
import { writeFileSync } from "node:fs";

const SHEET_ID = "1JhSODtviGHzXru6Eb5MhfXfVIF5vtJk3pclzzv7j2l4";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const res = await fetch(CSV_URL, { redirect: "follow" });
if (!res.ok) throw new Error(`Sheet download failed: ${res.status}`);
const [header, ...rows] = parseCSV(await res.text());

const services = rows.map((r) => {
  const o = Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()]));
  return {
    id: o.service_id,
    category: o.category,
    species: o.species,
    name: o.service_name,
    description: o.description,
    priceEur: o.price_eur ? Number(o.price_eur) : null,
    durationMin: o.duration_min ? Number(o.duration_min) : null,
    requiresAppointment: o.requires_appointment === "Yes",
    availability: o.availability,
    slotsThisWeek: o.slots_this_week ? Number(o.slots_this_week) : 0,
    specialOffer: o.special_offer || null
  };
});

writeFileSync(new URL("../services.json", import.meta.url), JSON.stringify(services, null, 2) + "\n");
console.log(`Wrote ${services.length} services to services.json`);
