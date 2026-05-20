// @ts-nocheck
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { jsPDF } from "jspdf";


function Card({ className = "", children }) {
  return <div className={className}>{children}</div>;
}

function CardContent({ className = "", children }) {
  return <div className={className}>{children}</div>;
}

function Button({ className = "", variant = "default", type = "button", onClick, children, disabled = false }) {
  const baseClass = "inline-flex h-10 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const variantClass = variant === "outline" ? "border border-slate-300 bg-white hover:bg-slate-100" : variant === "ghost" ? "bg-transparent hover:bg-slate-100" : "bg-slate-900 text-white hover:bg-slate-800";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${baseClass} ${variantClass} ${className}`}>
      {children}
    </button>
  );
}

function Icon({ label }) {
  return <span className="inline-flex h-5 w-5 items-center justify-center">{label}</span>;
}

function AlertTriangle() { return <Icon label="⚠️" />; }
function FileDown() { return <Icon label="📄" />; }
function Home() { return <Icon label="🏠" />; }
function Minus() { return <Icon label="−" />; }
function Package() { return <Icon label="📦" />; }
function Plus() { return <Icon label="+" />; }
function Search() { return <Icon label="🔎" />; }
function Warehouse() { return <Icon label="🏭" />; }

const MONTHS = ["GENNAIO", "FEBBRAIO", "MARZO", "APRILE", "MAGGIO", "GIUGNO", "LUGLIO", "AGOSTO", "SETTEMBRE", "OTTOBRE", "NOVEMBRE", "DICEMBRE"];
const TYPES = ["Grana Padano", "Parmigiano Reggiano", "Formaggio Duro Italiano", "Altro"];
const EMPTY_FILTERS = { type: "", matricola: "", month: "", year: "" };
const MONTH_ORDER = MONTHS.reduce((acc, month, index) => ({ ...acc, [month]: index + 1 }), {});

function fillInfo(percent) {
  if (percent === 0) return { label: "Vuota", className: "bg-emerald-500" };
  if (percent <= 30) return { label: "1–30%", className: "bg-lime-400" };
  if (percent <= 65) return { label: "31–65%", className: "bg-yellow-400" };
  if (percent <= 98.5) return { label: "66–98,5%", className: "bg-orange-500" };
  return { label: ">98,5%", className: "bg-red-600" };
}

function productionPeriodValue(month, year) {
  return Number(year) * 100 + (MONTH_ORDER[month] || 0);
}

function isFutureProduction(month, year, referenceDate = new Date()) {
  return productionPeriodValue(month, year) > referenceDate.getFullYear() * 100 + referenceDate.getMonth() + 1;
}

function filterLots(lots, filters) {
  return lots.filter((lot) => {
    return (
      (!filters.type || lot.type === filters.type) &&
      (!filters.matricola || lot.matricola.toLowerCase().includes(filters.matricola.toLowerCase())) &&
      (!filters.month || lot.month === filters.month) &&
      (!filters.year || String(lot.year).includes(String(filters.year)))
    );
  });
}

function calculateAreaStats(lots, areas) {
  return areas.map((area) => {
    const occupied = lots.filter((lot) => lot.areaId === area.id).reduce((sum, lot) => sum + Number(lot.qty || 0), 0);
    const percent = area.capacity ? (occupied / area.capacity) * 100 : 0;
    return {
      ...area,
      occupied,
      free: Math.max(0, area.capacity - occupied),
      percent,
      fill: area.isPalletDeposit ? { label: "Deposito bancali", className: "bg-blue-600" } : fillInfo(percent),
    };
  });
}

function calculateInventory(lots) {
  const totalForms = lots.reduce((sum, lot) => sum + Number(lot.qty || 0), 0);
  const byYearMap = lots.reduce((acc, lot) => {
    acc[lot.year] = (acc[lot.year] || 0) + Number(lot.qty || 0);
    return acc;
  }, {});
  const byProductMap = lots.reduce((acc, lot) => {
    const key = `${lot.type}|${lot.matricola}|${lot.month}|${lot.year}`;
    if (!acc[key]) acc[key] = { type: lot.type, matricola: lot.matricola, month: lot.month, year: lot.year, qty: 0 };
    acc[key].qty += Number(lot.qty || 0);
    return acc;
  }, {});
  return {
    totalForms,
    byYear: Object.entries(byYearMap).map(([year, qty]) => ({ year, qty })).sort((a, b) => Number(a.year) - Number(b.year)),
    byProduct: Object.values(byProductMap).sort((a, b) => productionPeriodValue(a.month, a.year) - productionPeriodValue(b.month, b.year)),
  };
}

function safeExportName(title) {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "export";
}

function buildAllLots(lotsByWarehouse) {
  return Object.values(lotsByWarehouse).flatMap((lots) => lots || []);
}

function getExportRows(lots, includeWarehouse) {
  const grouped = lots.reduce((acc, lot) => {
    const key = `${lot.type}|${lot.matricola}|${lot.month}|${lot.year}`;
    if (!acc[key]) {
      acc[key] = {
        Tipologia: lot.type,
        Matricola: lot.matricola,
        Mese: lot.month,
        Anno: lot.year,
        Forme: 0,
        _period: productionPeriodValue(lot.month, lot.year),
        _locations: [],
      };
    }
    const qty = Number(lot.qty || 0);
    acc[key].Forme += qty;
    acc[key]._locations.push({ warehouseName: lot.warehouseName || "", areaLabel: lot.areaLabel || lot.areaCode || lot.areaId, qty });
    return acc;
  }, {});

  return Object.values(grouped)
    .sort((a, b) => {
      if (a._period !== b._period) return a._period - b._period;
      return `${a.Tipologia}-${a.Matricola}`.localeCompare(`${b.Tipologia}-${b.Matricola}`);
    })
    .map((row) => {
      const locations = row._locations
        .sort((a, b) => `${a.warehouseName}-${a.areaLabel}`.localeCompare(`${b.warehouseName}-${b.areaLabel}`))
        .map((location) => {
          const place = includeWarehouse && location.warehouseName ? `${location.areaLabel} del ${location.warehouseName}` : location.areaLabel;
          return `${location.qty.toLocaleString("it-IT")} su ${place}`;
        })
        .join("; ");
      return { Tipologia: row.Tipologia, Matricola: row.Matricola, Mese: row.Mese, Anno: row.Anno, Forme: row.Forme, Suddivisione: locations };
    });
}

function getPdfHeaders(rows) {
  if (rows.length > 0) return Object.keys(rows[0]);
  return ["Tipologia", "Matricola", "Mese", "Anno", "Forme", "Suddivisione"];
}

function areaSortValue(lot) {
  if (lot.areaCode === "BANCALI") return 9999;
  if (typeof lot.areaSortOrder === "number") return lot.areaSortOrder;
  const match = String(lot.areaCode || lot.areaId).match(/[0-9]+/);
  return match ? Number(match[0]) : 9998;
}

function getOrderedWarehouseRows(lots) {
  return lots
    .slice()
    .sort((a, b) => {
      const byArea = areaSortValue(a) - areaSortValue(b);
      if (byArea !== 0) return byArea;
      const byDate = productionPeriodValue(a.month, a.year) - productionPeriodValue(b.month, b.year);
      if (byDate !== 0) return byDate;
      return String(a.type + "-" + a.matricola).localeCompare(String(b.type + "-" + b.matricola));
    })
    .map((lot) => ({
      Posizione: lot.areaLabel || lot.areaCode || lot.areaId,
      Tipologia: lot.type,
      Matricola: lot.matricola,
      Mese: lot.month,
      Anno: lot.year,
      Forme: Number(lot.qty || 0),
    }));
}

function buildPdfTableDocument(title, rows, headers, totalForms, options = {}) {
  const doc = new jsPDF({ orientation: options.orientation || "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const usableWidth = pageWidth - margin * 2;
  const rowHeight = options.rowHeight || 8;
  const colWidths = options.colWidths || headers.map(() => usableWidth / headers.length);
  let y = 16;

  doc.setProperties({ title });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, margin, y);
  y += 9;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Totale forme: " + totalForms.toLocaleString("it-IT"), margin, y);
  y += 10;

  function drawHeader() {
    let x = margin;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    headers.forEach((header, index) => {
      const width = colWidths[index] || 25;
      doc.rect(x, y - 4, width, rowHeight);
      doc.text(String(header), x + 1, y, { maxWidth: width - 2 });
      x += width;
    });
    y += rowHeight;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
  }

  function ensureSpace() {
    if (y > pageHeight - 18) {
      doc.addPage();
      y = 16;
      drawHeader();
    }
  }

  drawHeader();
  if (rows.length === 0) {
    doc.rect(margin, y - 4, usableWidth, rowHeight);
    doc.text("Nessuna forma presente", margin + 1, y);
  } else {
    rows.forEach((row) => {
      ensureSpace();
      let x = margin;
      headers.forEach((header, index) => {
        const width = colWidths[index] || 25;
        doc.rect(x, y - 4, width, rowHeight);
        doc.text(String(row[header] ?? ""), x + 1, y, { maxWidth: width - 2 });
        x += width;
      });
      y += rowHeight;
    });
  }
  return doc;
}

function buildGroupedPdfDocument(title, lots, includeWarehouse) {
  const rows = getExportRows(lots, includeWarehouse);
  const headers = getPdfHeaders(rows);
  const totalForms = calculateInventory(lots).totalForms;
  return buildPdfTableDocument(title, rows, headers, totalForms, { orientation: "landscape", rowHeight: 8, colWidths: [40, 28, 25, 18, 20, 146] });
}

function buildOrderedWarehousePdfDocument(title, lots) {
  const rows = getOrderedWarehouseRows(lots);
  const headers = rows.length > 0 ? Object.keys(rows[0]) : ["Posizione", "Tipologia", "Matricola", "Mese", "Anno", "Forme"];
  const totalForms = calculateInventory(lots).totalForms;
  return buildPdfTableDocument(title, rows, headers, totalForms, { orientation: "landscape", rowHeight: 8, colWidths: [38, 48, 32, 28, 20, 22] });
}

function downloadPdf(title, lots, includeWarehouse) {
  buildGroupedPdfDocument(title, lots, includeWarehouse).save(`${safeExportName(title)}.pdf`);
}

function downloadOrderedWarehousePdf(title, lots) {
  buildOrderedWarehousePdfDocument(title, lots).save(`${safeExportName(title)}.pdf`);
}

function mapArea(row) {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    capacity: Number(row.capacity || 0),
    isPalletDeposit: Boolean(row.is_pallet_deposit),
    sortOrder: Number(row.sort_order || 0),
    warehouseId: row.warehouse_id,
  };
}

function mapLot(row) {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name,
    areaId: row.area_id,
    areaCode: row.area_code,
    areaLabel: row.area_label,
    areaSortOrder: Number(row.sort_order || 0),
    type: row.product_type,
    matricola: row.matricola,
    month: row.production_month,
    year: String(row.production_year),
    qty: Number(row.qty || 0),
  };
}

function mapUnload(row) {
  const date = new Date(row.created_at);
  return {
    id: row.id,
    movementId: row.id,
    warehouseId: row.warehouse_id,
    date: date.toLocaleDateString("it-IT"),
    time: date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }),
    areaLabel: row.area_label,
    type: row.product_type,
    matricola: row.matricola,
    month: row.production_month,
    year: String(row.production_year),
    qty: Number(row.qty || 0),
    ddt: row.ddt || "",
    invoice: row.invoice || "",
  };
}

function runSelfTests() {
  const exampleLots = [
    { id: 1, warehouseName: "Magazzino 1", areaId: "a1", areaCode: "S1", areaLabel: "Scalera 1", areaSortOrder: 1, type: "Grana Padano", matricola: "VR908", month: "APRILE", year: "2025", qty: 752 },
    { id: 2, warehouseName: "Magazzino 1", areaId: "a3", areaCode: "S3", areaLabel: "Scalera 3", areaSortOrder: 3, type: "Grana Padano", matricola: "VR908", month: "DICEMBRE", year: "2025", qty: 800 },
    { id: 3, warehouseName: "Magazzino 1", areaId: "a8", areaCode: "S8", areaLabel: "Scalera 8", areaSortOrder: 8, type: "Grana Padano", matricola: "VR908", month: "DICEMBRE", year: "2025", qty: 816 },
  ];
  console.assert(calculateInventory(exampleLots).totalForms === 2368, "Inventario test = 2368");
  console.assert(getExportRows(exampleLots, true).length === 2, "Export raggruppato = 2 righe");
  const grouped = getExportRows(exampleLots, true).find((row) => row.Mese === "DICEMBRE");
  console.assert(grouped?.Forme === 1616, "DICEMBRE 2025 = 1616");
  console.assert(grouped?.Suddivisione.includes("800 su Scalera 3 del Magazzino 1"), "Suddivisione Scalera 3");
  console.assert(getOrderedWarehouseRows(exampleLots).length === 3, "Export ordinato non raggruppa");
  console.assert(getOrderedWarehouseRows(exampleLots)[0].Posizione === "Scalera 1", "Export ordinato per scalera");
  console.assert(buildGroupedPdfDocument("Test", exampleLots, true).output("arraybuffer").byteLength > 1000, "PDF raggruppato non vuoto");
  console.assert(buildOrderedWarehousePdfDocument("Test ordinato", exampleLots).output("arraybuffer").byteLength > 1000, "PDF ordinato non vuoto");
}

function InventoryCard({ title, subtitle, inventory }) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="p-4">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div><h2 className="text-xl font-semibold">{title}</h2>{subtitle && <p className="text-sm text-black">{subtitle}</p>}</div>
          <div className="rounded-2xl bg-slate-900 px-5 py-3 text-white"><div className="text-xs uppercase tracking-wide text-white">Totale forme</div><div className="text-3xl font-bold">{inventory.totalForms.toLocaleString("it-IT")}</div></div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border bg-white p-4"><h3 className="mb-3 font-semibold">Totale diviso per anno</h3><div className="space-y-2">{inventory.byYear.map((row) => <div key={row.year} className="flex items-center justify-between rounded-xl bg-slate-50 p-3"><span className="font-medium">{row.year}</span><span className="font-bold">{row.qty.toLocaleString("it-IT")} forme</span></div>)}{inventory.byYear.length === 0 && <div className="text-sm text-black">Nessuna forma presente.</div>}</div></div>
          <div className="rounded-2xl border bg-white p-4"><h3 className="mb-3 font-semibold">Totale per tipologia, matricola e mese/anno</h3><div className="max-h-80 space-y-2 overflow-y-auto pr-1">{inventory.byProduct.map((row) => <div key={`${row.type}-${row.matricola}-${row.month}-${row.year}`} className="rounded-xl bg-slate-50 p-3"><div className="flex items-center justify-between gap-3"><div><div className="font-semibold">{row.month} {row.year}</div><div className="text-sm text-black">{row.type} · {row.matricola}</div></div><div className="text-right font-bold">{row.qty.toLocaleString("it-IT")} forme</div></div></div>)}{inventory.byProduct.length === 0 && <div className="text-sm text-black">Nessuna forma presente.</div>}</div></div>
        </div>
      </CardContent>
    </Card>
  );
}

function ExportPdfPanel({ title, lots, includeWarehouse = false, showOrderedExport = false }) {
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [message, setMessage] = useState("");
  const filteredLots = useMemo(() => filterLots(lots, filters), [lots, filters]);
  const filteredInventory = useMemo(() => calculateInventory(filteredLots), [filteredLots]);

  function handleExport() {
    try {
      downloadPdf(title, filteredLots, includeWarehouse);
      setMessage(`PDF richiesto al browser: ${safeExportName(title)}.pdf`);
    } catch (error) {
      console.error(error);
      setMessage("Errore durante la generazione del PDF. Controlla la console del browser.");
    }
  }

  function handleOrderedExport() {
    try {
      const orderedTitle = title + " ordinato per scalera";
      downloadOrderedWarehousePdf(orderedTitle, filteredLots);
      setMessage(`PDF ordinato richiesto al browser: ${safeExportName(orderedTitle)}.pdf`);
    } catch (error) {
      console.error(error);
      setMessage("Errore durante la generazione del PDF ordinato. Controlla la console del browser.");
    }
  }

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2"><FileDown className="h-5 w-5" /><h2 className="text-xl font-semibold">Esporta PDF</h2></div>
        <p className="mb-4 text-sm text-black">Puoi esportare tutto oppure filtrare per tipologia, matricola, mese e anno.</p>
        <div className="grid gap-2 md:grid-cols-4">
          <select className="rounded-xl border p-2" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}><option value="">Tutte le tipologie</option>{TYPES.map((type) => <option key={type}>{type}</option>)}</select>
          <input className="rounded-xl border p-2" placeholder="Matricola" value={filters.matricola} onChange={(e) => setFilters({ ...filters, matricola: e.target.value })} />
          <select className="rounded-xl border p-2" value={filters.month} onChange={(e) => setFilters({ ...filters, month: e.target.value })}><option value="">Tutti i mesi</option>{MONTHS.map((month) => <option key={month}>{month}</option>)}</select>
          <input className="rounded-xl border p-2" placeholder="Anno" value={filters.year} onChange={(e) => setFilters({ ...filters, year: e.target.value })} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" type="button" onClick={handleExport}>Scarica PDF raggruppato</Button>{showOrderedExport && <Button variant="outline" type="button" onClick={handleOrderedExport}>Scarica PDF ordinato</Button>}<Button variant="ghost" type="button" onClick={() => setFilters({ ...EMPTY_FILTERS })}>Pulisci filtri</Button></div>
        <div className="mt-3 text-sm text-black">Righe da esportare: <strong>{filteredLots.length}</strong> · forme da esportare: <strong>{filteredInventory.totalForms.toLocaleString("it-IT")}</strong></div>
        {message && <div className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-900">{message}</div>}
      </CardContent>
    </Card>
  );
}

function WarehouseHeader({ warehouse, areaStats, onBackHome }) {
  const totalCapacityWithoutPallets = areaStats.filter((area) => !area.isPalletDeposit).reduce((sum, area) => sum + area.capacity, 0);
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div><Button variant="outline" className="mb-3" onClick={onBackHome}><Home className="mr-2 h-4 w-4" />HOME</Button><h1 className="text-3xl font-bold tracking-tight text-slate-900">{warehouse.name} · Formaggi</h1><p className="text-black">Gestione scalere, deposito bancali, carichi, scarichi e ricerca lotti.</p></div>
      <Card className="rounded-2xl shadow-sm"><CardContent className="flex items-center gap-3 p-4"><Warehouse className="h-8 w-8" /><div><div className="text-sm text-black">Capacità totale {warehouse.name}</div><div className="text-xl font-bold">{totalCapacityWithoutPallets.toLocaleString("it-IT")} forme</div></div></CardContent></Card>
    </div>
  );
}

function AvailabilityMap({ areaStats, selectedArea, setSelectedArea }) {
  return (
    <Card className="rounded-2xl shadow-sm md:col-span-3"><CardContent className="p-4"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">Mappa disponibilità</h2><div className="text-sm text-black">Clicca una scalera</div></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{areaStats.map((area) => <button key={area.id} type="button" onClick={() => setSelectedArea(area.id)} className={`rounded-2xl p-3 text-left shadow-sm ring-2 transition hover:scale-[1.02] ${area.fill.className} ${selectedArea === area.id ? "ring-slate-900" : "ring-transparent"}`}><div className="font-bold text-white drop-shadow">{area.label}</div><div className="mt-2 text-sm font-medium text-white drop-shadow">{area.occupied}/{area.capacity}</div><div className="text-xs text-white drop-shadow">Liberi: {area.free}</div><div className="mt-1 text-xs font-semibold text-white drop-shadow">{area.percent.toFixed(1)}%</div></button>)}</div><div className="mt-4 flex flex-wrap gap-3 text-sm"><span>🔵 Deposito bancali</span><span>🟢 vuota</span><span>🟩 1–30%</span><span>🟨 31–65%</span><span>🟧 66–98,5%</span><span>🔴 piena &gt;98,5%</span></div></CardContent></Card>
  );
}

function MovementPanel({ form, setForm, mode, setMode, selectedStats, message, handleMovement, isSaving }) {
  return (
    <Card className="rounded-2xl shadow-sm md:col-span-2"><CardContent className="space-y-4 p-4"><h2 className="text-xl font-semibold">Carico / Scarico</h2><div className="rounded-xl bg-slate-100 p-3"><div className="font-semibold">{selectedStats?.label}</div><div className="text-sm text-black">Occupate {selectedStats?.occupied} su {selectedStats?.capacity} · libere {selectedStats?.free}</div></div><div className="grid grid-cols-2 gap-2"><Button variant={mode === "carico" ? "default" : "outline"} onClick={() => setMode("carico")} disabled={isSaving}><Plus className="mr-1 h-4 w-4" />Carico</Button><Button variant={mode === "scarico" ? "default" : "outline"} onClick={() => setMode("scarico")} disabled={isSaving}><Minus className="mr-1 h-4 w-4" />Scarico</Button></div><select className="w-full rounded-xl border p-2" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{TYPES.map((type) => <option key={type}>{type}</option>)}</select><input className="w-full rounded-xl border p-2" placeholder="Matricola es. VR908" value={form.matricola} onChange={(e) => setForm({ ...form, matricola: e.target.value })} /><div className="grid grid-cols-2 gap-2"><select className="rounded-xl border p-2" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })}>{MONTHS.map((month) => <option key={month}>{month}</option>)}</select><input className="rounded-xl border p-2" placeholder="Anno" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></div><input className="w-full rounded-xl border p-2" placeholder="Numero forme" type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /><Button className="w-full" onClick={handleMovement} disabled={isSaving}>{isSaving ? "Salvataggio..." : mode === "carico" ? "Registra carico" : "Registra scarico"}</Button>{message && <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">{message}</div>}</CardContent></Card>
  );
}

function SelectedAreaCard({ selectedLots }) {
  return <Card className="rounded-2xl shadow-sm"><CardContent className="p-4"><h2 className="mb-3 text-xl font-semibold">Contenuto posizione selezionata</h2>{selectedLots.length === 0 ? <div className="text-black">Nessun lotto presente.</div> : <div className="space-y-2">{selectedLots.map((lot) => <div key={lot.id} className="rounded-xl border bg-white p-3"><div className="font-semibold">{lot.type} · {lot.matricola}</div><div className="text-sm text-black">{lot.month} {lot.year} · {lot.qty} forme</div></div>)}</div>}</CardContent></Card>;
}

function SearchPanel({ filters, setFilters, filteredLots }) {
  return (
    <Card className="rounded-2xl shadow-sm"><CardContent className="p-4"><div className="mb-3 flex items-center gap-2"><Search className="h-5 w-5" /><h2 className="text-xl font-semibold">Cerca prodotto</h2></div><div className="grid gap-2 sm:grid-cols-2"><select className="rounded-xl border p-2" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}><option value="">Tutte le tipologie</option>{TYPES.map((type) => <option key={type}>{type}</option>)}</select><input className="rounded-xl border p-2" placeholder="Matricola" value={filters.matricola} onChange={(e) => setFilters({ ...filters, matricola: e.target.value })} /><select className="rounded-xl border p-2" value={filters.month} onChange={(e) => setFilters({ ...filters, month: e.target.value })}><option value="">Tutti i mesi</option>{MONTHS.map((month) => <option key={month}>{month}</option>)}</select><input className="rounded-xl border p-2" placeholder="Anno" value={filters.year} onChange={(e) => setFilters({ ...filters, year: e.target.value })} /></div><div className="mt-4 space-y-2">{filteredLots.map((lot) => <div key={lot.id} className="flex items-center justify-between rounded-xl border bg-white p-3"><div><div className="font-semibold">{lot.type} · {lot.matricola}</div><div className="text-sm text-black">{lot.month} {lot.year} · {lot.qty} forme</div></div><div className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold">{lot.areaLabel}</div></div>)}{filteredLots.length === 0 && <div className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="h-4 w-4" /> Nessun prodotto trovato.</div>}</div></CardContent></Card>
  );
}

function UnloadsTable({ unloads, updateUnloadDocument }) {
  const [draftDocs, setDraftDocs] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    const nextDrafts = {};
    unloads.forEach((unload) => {
      nextDrafts[unload.id] = {
        ddt: unload.ddt || "",
        invoice: unload.invoice || "",
      };
    });
    setDraftDocs(nextDrafts);
  }, [unloads]);

  function updateDraft(id, field, value) {
    setDraftDocs((current) => ({
      ...current,
      [id]: {
        ddt: current[id]?.ddt || "",
        invoice: current[id]?.invoice || "",
        [field]: value,
      },
    }));
  }

  async function saveDocuments(unload) {
    setSavingId(unload.id);
    setStatusMessage("");
    const draft = draftDocs[unload.id] || { ddt: "", invoice: "" };
    const result = await updateUnloadDocument(unload.id, draft.ddt, draft.invoice);
    setSavingId(null);
    if (result?.error) setStatusMessage(result.error);
    else setStatusMessage("DDT e fattura salvati correttamente.");
  }

  return (
    <Card className="rounded-2xl shadow-sm"><CardContent className="p-4"><div className="mb-3 flex items-center gap-2"><Package className="h-5 w-5" /><h2 className="text-xl font-semibold">Storico scarichi · associa DDT e fattura</h2></div><p className="mb-4 text-sm text-black">Ogni scarico genera una riga. Compila DDT e fattura, poi premi Salva sulla stessa riga.</p>{statusMessage && <div className="mb-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-900">{statusMessage}</div>}<div className="overflow-x-auto rounded-2xl border bg-white"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-slate-100 text-black"><tr><th className="p-3">Data</th><th className="p-3">Ora</th><th className="p-3">Posizione</th><th className="p-3">Tipologia</th><th className="p-3">Matricola</th><th className="p-3">Mese/Anno</th><th className="p-3">Forme</th><th className="p-3">DDT</th><th className="p-3">Fattura</th><th className="p-3">Azione</th></tr></thead><tbody>{unloads.map((unload) => { const draft = draftDocs[unload.id] || { ddt: unload.ddt || "", invoice: unload.invoice || "" }; return <tr key={unload.id} className="border-t"><td className="p-3">{unload.date}</td><td className="p-3">{unload.time}</td><td className="p-3 font-medium">{unload.areaLabel}</td><td className="p-3">{unload.type}</td><td className="p-3 font-semibold">{unload.matricola}</td><td className="p-3">{unload.month} {unload.year}</td><td className="p-3 font-semibold">{unload.qty}</td><td className="p-3"><input className="w-24 rounded-xl border p-2" placeholder="es. 77" value={draft.ddt} onChange={(e) => updateDraft(unload.id, "ddt", e.target.value)} /></td><td className="p-3"><input className="w-24 rounded-xl border p-2" placeholder="es. 89" value={draft.invoice} onChange={(e) => updateDraft(unload.id, "invoice", e.target.value)} /></td><td className="p-3"><Button variant="outline" type="button" disabled={savingId === unload.id} onClick={() => saveDocuments(unload)}>{savingId === unload.id ? "Salvo..." : "Salva"}</Button></td></tr>; })}{unloads.length === 0 && <tr><td colSpan={10} className="p-4 text-center text-black">Nessuno scarico registrato.</td></tr>}</tbody></table></div></CardContent></Card>
  );
}

function WarehouseView({ warehouse, lots, unloads, onBackHome, refreshData }) {
  const [selectedArea, setSelectedArea] = useState(warehouse.areas[0]?.id || "");
  const [mode, setMode] = useState("carico");
  const [form, setForm] = useState({ type: "Grana Padano", matricola: "", month: MONTHS[new Date().getMonth()], year: String(new Date().getFullYear()), qty: "" });
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!warehouse.areas.find((area) => area.id === selectedArea)) setSelectedArea(warehouse.areas[0]?.id || "");
  }, [warehouse, selectedArea]);

  const areaStats = useMemo(() => calculateAreaStats(lots, warehouse.areas), [lots, warehouse.areas]);
  const inventory = useMemo(() => calculateInventory(lots), [lots]);
  const selectedStats = areaStats.find((area) => area.id === selectedArea);
  const selectedLots = lots.filter((lot) => lot.areaId === selectedArea);
  const filteredLots = filterLots(lots, filters);

  async function updateUnloadDocument(id, ddt, invoice) {
    if (!supabase) return { error: "Supabase non configurato." };
    const { error } = await supabase
      .from("unload_documents")
      .update({ ddt, invoice })
      .eq("movement_id", id);

    if (error) return { error: error.message };
    await refreshData();
    return { error: null };
  }

  async function handleMovement() {
    if (!supabase) return setMessage("Supabase non configurato. Controlla .env.local.");
    const qty = Number(form.qty);
    if (!Number.isInteger(qty) || qty <= 0) return setMessage("Inserisci un numero intero di forme valido.");
    const area = areaStats.find((item) => item.id === selectedArea);
    if (!area) return setMessage("Seleziona una posizione valida.");
    if (!form.matricola.trim()) return setMessage("Inserisci la matricola del formaggio.");
    if (!form.year || !/^\d{4}$/.test(String(form.year))) return setMessage("Inserisci un anno valido a 4 cifre.");
    if (mode === "carico" && isFutureProduction(form.month, form.year)) {
      const now = new Date();
      return setMessage(`Carico bloccato: non puoi caricare un formaggio non ancora prodotto. Oggi il mese massimo caricabile è ${MONTHS[now.getMonth()]} ${now.getFullYear()}.`);
    }
    if (mode === "carico" && qty > area.free) return setMessage(`Capacità insufficiente: in ${area.label} ci sono solo ${area.free} posti liberi.`);

    setIsSaving(true);
    setMessage("");
    const rpcName = mode === "carico" ? "register_load" : "register_unload";
    const rpcPayload = {
      p_warehouse_id: warehouse.id,
      p_area_id: selectedArea,
      p_product_type: form.type,
      p_matricola: form.matricola.trim().toUpperCase(),
      p_production_month: form.month,
      p_production_year: Number(form.year),
      p_qty: qty,
    };

    const { error } = await supabase.rpc(rpcName, rpcPayload);
    setIsSaving(false);

    if (error) {
      return setMessage(`Errore Supabase: ${error.message || "errore sconosciuto"} ${error.details ? " | " + error.details : ""} ${error.hint ? " | " + error.hint : ""}`);
    }
    setMessage(mode === "carico" ? `Caricate ${qty} forme in ${area.label}.` : `Scaricate ${qty} forme da ${area.label}.`);
    setForm((current) => ({ ...current, matricola: "", qty: "" }));
    await refreshData();
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <WarehouseHeader warehouse={warehouse} areaStats={areaStats} onBackHome={onBackHome} />
      <div className="grid gap-4 md:grid-cols-5">
        <AvailabilityMap areaStats={areaStats} selectedArea={selectedArea} setSelectedArea={setSelectedArea} />
        <MovementPanel form={form} setForm={setForm} mode={mode} setMode={setMode} selectedStats={selectedStats} message={message} handleMovement={handleMovement} isSaving={isSaving} />
      </div>
      <InventoryCard title="Inventario" subtitle="Giacenza aggiornata in tempo reale in base a Supabase." inventory={inventory} />
      <ExportPdfPanel title={`Inventario ${warehouse.name}`} lots={lots} includeWarehouse={false} showOrderedExport={true} />
      <div className="grid gap-4 md:grid-cols-2">
        <SelectedAreaCard selectedLots={selectedLots} />
        <SearchPanel filters={filters} setFilters={setFilters} filteredLots={filteredLots} />
      </div>
      <UnloadsTable unloads={unloads} updateUnloadDocument={updateUnloadDocument} />
    </div>
  );
}

function HomePage({ setSelectedWarehouseId, lotsByWarehouse, warehouses }) {
  const allLots = useMemo(() => buildAllLots(lotsByWarehouse), [lotsByWarehouse]);
  const globalInventory = useMemo(() => calculateInventory(allLots), [allLots]);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div><h1 className="text-4xl font-bold tracking-tight text-slate-900">HOME · Magazzini formaggi</h1><p className="mt-2 text-black">Seleziona il magazzino da visualizzare e gestire.</p></div>
      <div className="grid gap-4 md:grid-cols-2">{Object.values(warehouses).map((warehouse) => { const lots = lotsByWarehouse[warehouse.id] || []; const inventory = calculateInventory(lots); const totalCapacity = warehouse.areas.filter((area) => !area.isPalletDeposit).reduce((sum, area) => sum + area.capacity, 0); const scalereCount = warehouse.areas.filter((area) => !area.isPalletDeposit).length; return <Card key={warehouse.id} className="rounded-2xl shadow-sm transition hover:shadow-md"><CardContent className="space-y-4 p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-2xl font-bold">{warehouse.name}</h2><p className="text-sm text-black">{scalereCount} scalere</p></div><Warehouse className="h-10 w-10 text-black" /></div><div className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-slate-100 p-3"><div className="text-black">Capacità totale</div><div className="text-lg font-bold">{totalCapacity.toLocaleString("it-IT")}</div></div><div className="rounded-xl bg-slate-100 p-3"><div className="text-black">Forme presenti</div><div className="text-lg font-bold">{inventory.totalForms.toLocaleString("it-IT")}</div></div></div><Button className="w-full" onClick={() => setSelectedWarehouseId(warehouse.id)}>Apri {warehouse.name}</Button></CardContent></Card>; })}</div>
      <InventoryCard title="Inventario totale tutti i magazzini" subtitle="Somma automatica delle forme presenti in tutti i magazzini configurati." inventory={globalInventory} />
      <ExportPdfPanel title="Inventario totale magazzini" lots={allLots} includeWarehouse={true} />
    </div>
  );
}

export default function MagazziniFormaggiApp() {
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(null);
  const [warehouses, setWarehouses] = useState({});
  const [lotsByWarehouse, setLotsByWarehouse] = useState({});
  const [unloadsByWarehouse, setUnloadsByWarehouse] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  async function refreshData() {
    if (!supabase) {
      setErrorMessage("Supabase non configurato. Controlla che .env.local sia nella root del progetto e contenga NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
      setWarehouses({});
      setLotsByWarehouse({});
      setUnloadsByWarehouse({});
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage("");

    const [warehousesRes, areasRes] = await Promise.all([
      supabase.from("warehouses").select("id,name").order("id"),
      supabase.from("areas").select("id,warehouse_id,code,label,capacity,is_pallet_deposit,sort_order").order("sort_order"),
    ]);

    if (warehousesRes.error || areasRes.error) {
      const error = warehousesRes.error || areasRes.error;
      setErrorMessage(`Errore lettura magazzini/scalere: ${error.message}`);
      setWarehouses({});
      setLotsByWarehouse({});
      setUnloadsByWarehouse({});
      setIsLoading(false);
      return;
    }

    const warehouseMap = {};
    (warehousesRes.data || []).forEach((warehouse) => {
      warehouseMap[warehouse.id] = { id: warehouse.id, name: warehouse.name, areas: [] };
    });

    (areasRes.data || []).map(mapArea).forEach((area) => {
      if (warehouseMap[area.warehouseId]) warehouseMap[area.warehouseId].areas.push(area);
    });

    Object.values(warehouseMap).forEach((warehouse) => {
      warehouse.areas.sort((a, b) => a.sortOrder - b.sortOrder);
    });

    const lotsMap = Object.fromEntries(Object.keys(warehouseMap).map((id) => [id, []]));
    const unloadsMap = Object.fromEntries(Object.keys(warehouseMap).map((id) => [id, []]));
    const warnings = [];

    const lotsRes = await supabase.from("lots_full").select("*").order("sort_order");
    if (lotsRes.error) {
      warnings.push(`Errore lettura lotti: ${lotsRes.error.message}`);
    } else {
      (lotsRes.data || []).map(mapLot).forEach((lot) => {
        if (!lotsMap[lot.warehouseId]) lotsMap[lot.warehouseId] = [];
        lotsMap[lot.warehouseId].push(lot);
      });
    }

    const movementsRes = await supabase.from("movements_full").select("*").eq("movement_type", "scarico").order("created_at", { ascending: false });
    if (movementsRes.error) {
      warnings.push(`Errore lettura scarichi: ${movementsRes.error.message}`);
    } else {
      (movementsRes.data || []).map(mapUnload).forEach((unload) => {
        if (!unloadsMap[unload.warehouseId]) unloadsMap[unload.warehouseId] = [];
        unloadsMap[unload.warehouseId].push(unload);
      });
    }

    if (Object.keys(warehouseMap).length === 0) {
      warnings.push("Nessun magazzino trovato nella tabella warehouses. Verifica che la query SQL iniziale sia stata eseguita.");
    }

    setWarehouses(warehouseMap);
    setLotsByWarehouse(lotsMap);
    setUnloadsByWarehouse(unloadsMap);
    setErrorMessage(warnings.join(" | "));
    setIsLoading(false);
  }

  useEffect(() => {
    refreshData();
  }, []);

  const selectedWarehouse = selectedWarehouseId ? warehouses[selectedWarehouseId] : null;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      {errorMessage && <div className="mx-auto mb-4 max-w-6xl rounded-xl bg-red-50 p-4 text-sm text-red-900">{errorMessage}</div>}
      {isLoading ? (
        <div className="mx-auto max-w-6xl rounded-2xl bg-white p-6 text-black shadow-sm">Caricamento dati da Supabase...</div>
      ) : !selectedWarehouse ? (
        <HomePage setSelectedWarehouseId={setSelectedWarehouseId} lotsByWarehouse={lotsByWarehouse} warehouses={warehouses} />
      ) : (
        <WarehouseView warehouse={selectedWarehouse} lots={lotsByWarehouse[selectedWarehouse.id] || []} unloads={unloadsByWarehouse[selectedWarehouse.id] || []} refreshData={refreshData} onBackHome={() => setSelectedWarehouseId(null)} />
      )}
    </div>
  );
}
