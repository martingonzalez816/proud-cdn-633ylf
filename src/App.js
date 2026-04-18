import { useState, useEffect, useRef, useCallback } from "react";
// xlsx via CDN
const XLSX = window.XLSX;

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyFgyn7X_rDZ_qboQwoZatRFttzlvnYhmxWU55xlyQHVsJuKSU2QrTY7ZGx8lvqjOQ/exec";

const C = {
  bg: "#0a0c10",
  surf: "#12151c",
  surf2: "#1a1e28",
  bord: "#252a38",
  text: "#e8eaf0",
  muted: "#6b7280",
  red: "#FF4757",
  orange: "#ff8c42",
  yellow: "#ffd166",
  green: "#06d6a0",
  blue: "#4cc9f0",
  accent: "#7c3aed",
  gold: "#f39c12",
};
const OP_COLORS = [
  "#FF4757",
  "#2ED573",
  "#1E90FF",
  "#FFA502",
  "#A55EEA",
  "#00D2D3",
  "#FF6B81",
  "#26de81",
];
const MOTIVOS = [
  "Faltante",
  "Sobrante",
  "Producto roto",
  "Código incorrecto",
  "Vencido",
  "Sin stock",
  "Otro",
];

const fTime = (ms) => {
  const s = Math.floor(ms / 1000),
    h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sc = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
    sc
  ).padStart(2, "0")}`;
};
const fHora = (ts) =>
  ts
    ? new Date(ts).toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const todayStr = () => new Date().toISOString().split("T")[0];
const nowTime = () => new Date().toTimeString().slice(0, 5);
const vencSt = (d) => {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d) - t) / 86400000);
  if (diff < 0) return { l: "Vencido", c: C.red, d: diff };
  if (diff < 30) return { l: "Crítico", c: C.orange, d: diff };
  if (diff < 90) return { l: "Alerta", c: C.yellow, d: diff };
  return { l: "OK", c: C.green, d: diff };
};

function useDB(key, init) {
  const [v, sv] = useState(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? JSON.parse(s) : init;
    } catch {
      return init;
    }
  });
  const set = useCallback(
    (fn) => {
      sv((prev) => {
        const next = typeof fn === "function" ? fn(prev) : fn;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [key]
  );
  return [v, set];
}

// ─── SHEETS API ───────────────────────────────────────────────
const api = {
  async leer() {
    try {
      if (APPS_SCRIPT_URL.includes("TU_URL_AQUI")) return null;
      const r = await fetch(`${APPS_SCRIPT_URL}?accion=leer_consolidados`);
      const d = await r.json();
      return d.status === "ok" ? d.consolidados : null;
    } catch {
      return null;
    }
  },
  async post(tipo, data) {
    try {
      if (APPS_SCRIPT_URL.includes("TU_URL_AQUI")) return;
      await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, data }),
        mode: "no-cors",
      });
    } catch (e) {
      console.warn("Sheets:", e);
    }
  },
};

// Hook consolidados: localStorage + sync con Sheets cada 20s
function useConsolidados() {
  const [cons, setCons] = useState(() => {
    try {
      const s = localStorage.getItem("rosarc_cons_v7");
      return s ? JSON.parse(s) : [];
    } catch {
      return [];
    }
  });
  const [syncOk, setSyncOk] = useState(false);
  const [lastSync, setLastSync] = useState("");

  const guardar = useCallback((fn) => {
    setCons((prev) => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      try {
        localStorage.setItem("rosarc_cons_v7", JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const sincronizar = useCallback(async () => {
    const remoto = await api.leer();
    if (!remoto) return;
    // Merge: conservar local si tiene datos más recientes (líneas marcadas)
    setCons((prev) => {
      const merged = remoto.map((rc) => {
        const local = prev.find((lc) => String(lc.id) === String(rc.id));
        if (!local) return rc;
        // DESPUÉS:
// "ok" y "error" pesan más que "armado"
const localScore = (local.lines || []).reduce((a, l) => 
  a + (l.estado === "ok" || l.estado === "error" ? 2 : l.estado === "armado" ? 1 : 0), 0);
const remotoScore = (rc.lines || []).reduce((a, l) => 
  a + (l.estado === "ok" || l.estado === "error" ? 2 : l.estado === "armado" ? 1 : 0), 0);
const localGana = localScore >= remotoScore;

        // Decidir qué activeOps usar:
        // El remoto tiene divisiones si algún op tiene divisiones.length > 0
        // El local puede no tenerlas si fue sincronizado antes del fix del Sheet.
        const remoteTieneDivisiones = (rc.activeOps || []).some(
          (o) => (o.divisiones || []).length > 0
        );
        const localTieneDivisiones = (local.activeOps || []).some(
          (o) => (o.divisiones || []).length > 0
        );

        // Merge de activeOps: conservar finished/endTime/startTime del local,
        // pero tomar divisiones del remoto si el local no las tiene
        const activeOpsMerged = (rc.activeOps || []).map((rop) => {
          const lop = (local.activeOps || []).find(
            (o) => String(o.id) === String(rop.id) || o.nombre === rop.nombre
          );
          if (!lop) return rop;
          return {
            ...rop,                          // base: remoto (tiene divisiones)
            // DESPUÉS:
startTime: lop.startTime || rop.startTime || local.startTime || rc.startTime,
            endTime: lop.endTime || rop.endTime,
            finished: lop.finished || rop.finished,
            color: lop.color || rop.color,
            // Divisiones: preferir local si las tiene, sino tomar remoto
            divisiones: localTieneDivisiones
              ? (lop.divisiones || [])
              : (rop.divisiones || []),
          };
        });

        return {
          ...(localGana ? local : rc),
          startTime: local.startTime,
          activeOps: activeOpsMerged,        // ← merge inteligente
          finished: local.finished || rc.finished,
          // POR:
lines: (() => {
  // Merge línea por línea: "ok" y "error" son definitivos, nunca los pisa "armado"
  const base = localGana ? local.lines : rc.lines;
  const otro = localGana ? rc.lines : local.lines;
  return base.map(bl => {
    if (bl.estado === "ok" || bl.estado === "error") return bl;
    const ol = otro.find(l => l.id === bl.id);
    if (!ol) return bl;
    if (ol.estado === "ok" || ol.estado === "error") return ol;
    return (bl.ts || 0) >= (ol.ts || 0) ? bl : ol;
  });
})(),
        };
      });

      // Agregar consolidados locales que aún no están en remoto
      prev.forEach((lc) => {
        if (!merged.find((m) => String(m.id) === String(lc.id)))
          merged.push(lc);
      });
      try {
        localStorage.setItem("rosarc_cons_v7", JSON.stringify(merged));
      } catch {}
      return merged;
    });
    setSyncOk(true);
    setLastSync(
      new Date().toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    );
  }, []);

  useEffect(() => {
    sincronizar();
  }, []);
  useEffect(() => {
    const t = setInterval(() => sincronizar(), 5000);
    return () => clearInterval(t);
  }, [sincronizar]);

  return { cons, setCons: guardar, sincronizar, syncOk, lastSync };
}

const card = (x = {}) => ({
  background: C.surf,
  border: `1px solid ${C.bord}`,
  borderRadius: "12px",
  padding: "16px",
  ...x,
});
const btn = (x = {}) => ({
  border: "none",
  borderRadius: "8px",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: "13px",
  padding: "10px 16px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  ...x,
});
const inp = {
  background: C.surf2,
  border: `1px solid ${C.bord}`,
  borderRadius: "8px",
  color: C.text,
  padding: "9px 12px",
  fontSize: "13px",
  outline: "none",
  width: "100%",
};
const lbl = {
  fontSize: "10px",
  fontWeight: 600,
  letterSpacing: "1.5px",
  textTransform: "uppercase",
  color: C.muted,
  display: "block",
  marginBottom: "4px",
};
const secTit = {
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "3px",
  textTransform: "uppercase",
  color: C.blue,
  marginBottom: "10px",
  paddingBottom: "6px",
  borderBottom: `1px solid ${C.bord}`,
};
const pill = (color, x = {}) => ({
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 9px",
  borderRadius: "20px",
  fontSize: "10px",
  fontWeight: 600,
  background: `${color}18`,
  color,
  border: `1px solid ${color}40`,
  ...x,
});
const BS = {
  flex: 1,
  padding: "16px",
  maxWidth: "860px",
  width: "100%",
  margin: "0 auto",
  display: "flex",
  flexDirection: "column",
  gap: "14px",
  overflowY: "auto",
};
function parseXLS(text) {
  const lines = text.split("\n").map((l) => {
    const cols = [];
    let cur = "",
      inQ = false;
    for (let i = 0; i < l.length; i++) {
      if (l[i] === '"') {
        inQ = !inQ;
      } else if (l[i] === "," && !inQ) {
        cols.push(cur.trim());
        cur = "";
      } else {
        cur += l[i];
      }
    }
    cols.push(cur.trim());
    return cols;
  });
  let numero = "",
    fecha = "";
  const sections = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const row = lines[i];
    if (!row || !row[0]) continue;
    const first = row[0];

    if (i === 0) {
      if (
        first === "Ros-ArC" ||
        first.includes("Ros-ArC") ||
        first === "T4" ||
        first === "T3"
      ) {
        numero = row[3] || "";
        const fd = row[6] || "";
        if (fd && fd.includes("/")) {
          const p = fd.split("/");
          fecha = `${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}`;
        } else fecha = fd;
      } else if (first === "Ubicacion" || first === "Ubicación") {
        numero = "";
        const fd = row[3] || "";
        if (fd && fd.includes("/")) {
          const p = fd.split("/");
          fecha = `${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}`;
        } else fecha = todayStr();
      }
      continue;
    }

    if (first === "Grupo Segmento Evento:") continue;

    const sinCol1 = !row[1] || row[1] === "";
    const isDiv =
      first.startsWith("DIV") ||
      first.startsWith("CHOCOLATES") ||
      first.startsWith("COMESTIBLES");
    const isNamed =
      first.includes("ARCOR") ||
      first.includes("BAGLEY") ||
      first.includes("CAMPAGNOLA");
    if ((isDiv || isNamed) && sinCol1) {
      if (current) sections.push(current);
      current = { name: first, products: [], total_bu: "0" };
      continue;
    }

    if (row[2] && row[2].includes("Total en BU")) {
      if (current) current.total_bu = row[4] || "0";
      continue;
    }
    if (row[2] && row[2].includes("Total en ")) continue;

    const codigoLimpio = row[1]
      ? row[1].replace(/\.0+$/, "").replace(/"/g, "").trim()
      : "";
    console.log(
      `fila ${i}: pasillo=${JSON.stringify(
        row[0]
      )} cod=${codigoLimpio} esDigito=${/^\d+$/.test(
        codigoLimpio
      )} current=${!!current} desc=${row[2]?.slice(0, 20)}`
    );
    // REEMPLAZAR este bloque en parseXLS (desde "if (current && codigoLimpio" hasta "});")

    if (current && codigoLimpio && /^\d+$/.test(codigoLimpio) && row[2]) {
      const buQty = parseFloat(row[5] || "0") || 0; // col F — cantidad BU
      const venQty = parseFloat(row[7] || "0") || 0; // col H — cantidad venta (UN sueltas)
      const venUnit = row[8] || row[4] || "UN"; // col I — unidad de venta

      // Regla directa del XLS Arcor:
      // col F = BU, col H = unidades sueltas adicionales
      // Si BU=0 → solo col H en su unidad
      // Si BU>0 y col H=0 → solo BU
      // Si BU>0 y col H>0 → BU como principal, col H como bu (unidades sueltas)

      let qty, unit, bu;

      if (buQty > 0 && venQty > 0) {
        // LATA MEMBRILLO: 1 BU · 2 UN — pickear 1 BU y 2 unidades sueltas
        qty = String(buQty);
        unit = "BU";
        bu = String(venQty); // unidades sueltas adicionales
      } else if (buQty > 0 && venQty === 0) {
        // PURE DE TOMATE: 3 BU — pickear solo bultos
        qty = String(buQty);
        unit = "BU";
        bu = "0";
      } else {
        // MERM FRUTOS ROJOS: 2 UN — pickear unidades, sin BU
        qty = String(venQty);
        unit = venUnit;
        bu = "0";
      }

      current.products.push({
        id: `${(row[0] || "x").replace(
          /[^a-z0-9]/gi,
          ""
        )}-${codigoLimpio}-${i}`,
        pasillo: row[0] || "",
        codigo: codigoLimpio,
        descripcion: row[2],
        bu,
        qty,
        unit,
      });
    }

    // RESULTADO ESPERADO con tus datos reales:
    // MERM. LC FRUTOS ROJOS  → bu=0,  qty=2,  unit=UN  → "—  2 UN"   ✅
    // PURE DE TOMATE LC      → bu=0,  qty=3,  unit=BU  → "—  3 BU"   ✅
    // TOMATE CUBETEADO       → bu=0,  qty=1,  unit=BU  → "—  1 BU"   ✅
    // LATA 700g MEMBRILLO    → bu=2,  qty=1,  unit=BU  → "2  1 BU"   ✅
    // LAT. RELL TARTA CHOCLO → bu=5,  qty=1,  unit=BU  → "5  1 BU"   ✅
    // TOMATE PERITA LC       → bu=12, qty=8,  unit=BU  → "12 8 BU"   ✅
    // LAT TOM/PURE SALSATIX  → bu=0,  qty=12, unit=UN  → "—  12 UN"  ✅
    // ATUN ENS.ROJA          → bu=0,  qty=17, unit=UN  → "—  17 UN"  ✅
  }
  if (current) sections.push(current);

  const result = sections.filter((s) => s.products.length > 0);
  return { sections: result, numero, fecha };
}
// ─── DATOS DEL XLS REAL (Tanda 4 — 82569) ───────────────────
// Embebidos directamente del archivo subido. Sin columnas D y E.
const XLS_DEFAULT = {
  numero: "82569",
  fecha: "2026-02-04",
  sections: [
    {
      name: "DIV.GOLOSINAS",
      total_bu: "0",
      products: [
        {
          id: "g1",
          pasillo: "01",
          codigo: "15004",
          descripcion: "TURROCKLETS x 25G",
          bu: "0",
          qty: "50",
          unit: "UN",
        },
        {
          id: "g2",
          pasillo: "01",
          codigo: "1782",
          descripcion: "MASTICABLES x 800g FRUTA (242u)",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "g3",
          pasillo: "01",
          codigo: "4013",
          descripcion: "TURRON ARCOR x25g",
          bu: "0",
          qty: "160",
          unit: "UN",
        },
        {
          id: "g4",
          pasillo: "03",
          codigo: "11834",
          descripcion: "CRISTAL MENTA 180u x810g",
          bu: "0",
          qty: "1",
          unit: "UN",
        },
        {
          id: "g5",
          pasillo: "06",
          codigo: "11828",
          descripcion: "RELL. MIEL 135u x675g",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "g6",
          pasillo: "08",
          codigo: "3092",
          descripcion: "MOGUL x1 KG EUCALIPTUS (181u)",
          bu: "0",
          qty: "2",
          unit: "UN",
        },
        {
          id: "g7",
          pasillo: "10",
          codigo: "10885",
          descripcion: "GAJITOS 69u x485g",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "g8",
          pasillo: "13",
          codigo: "12392",
          descripcion: "MOGUL x 500Grs FRUTILLAS ACIDAS",
          bu: "0",
          qty: "2",
          unit: "UN",
        },
        {
          id: "g9",
          pasillo: "13",
          codigo: "14800",
          descripcion: "MOGUL x 500Grs SANDIA EXTREME",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "g10",
          pasillo: "14",
          codigo: "2624",
          descripcion: "MOGUL x 500Grs MORAS (83u)",
          bu: "0",
          qty: "2",
          unit: "UN",
        },
        {
          id: "g11",
          pasillo: "14",
          codigo: "2631",
          descripcion: "MOGUL x 500Grs DIENTES (86u)",
          bu: "0",
          qty: "4",
          unit: "UN",
        },
        {
          id: "g12",
          pasillo: "15",
          codigo: "11857",
          descripcion: "B. TOFFEES x825g LECHE (150u)",
          bu: "0",
          qty: "1",
          unit: "UN",
        },
        {
          id: "g13",
          pasillo: "16",
          codigo: "13648",
          descripcion: "BOCADITO CHOCO-MANI 80u",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "g14",
          pasillo: "16",
          codigo: "15110",
          descripcion: "MOGUL MAX EXTRE. TWIST 24U X 15G",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "g15",
          pasillo: "16",
          codigo: "15405",
          descripcion: "TABL. TOP LINE 7 STRONG 16X14G",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "g16",
          pasillo: "16",
          codigo: "5111",
          descripcion: "TABL. TOP LINE 7 STRAWBERRY 16X14G",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "g17",
          pasillo: "17",
          codigo: "14184",
          descripcion: "MOGUL. JELLY BEANS 10X50G",
          bu: "0",
          qty: "2",
          unit: "DI",
        },
        {
          id: "g18",
          pasillo: "18",
          codigo: "13024",
          descripcion: "MOGUL. SANDIA EXTREME 10u X 50g",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "g19",
          pasillo: "18",
          codigo: "13751",
          descripcion: "MOGUL. DIENTES 10X50",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "g20",
          pasillo: "18",
          codigo: "1999",
          descripcion: "MOGUL. OSITOS 12X30G",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "g21",
          pasillo: "19",
          codigo: "13023",
          descripcion: "MOGUL. OSITOS ACIDOS x10u",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "g22",
          pasillo: "19",
          codigo: "2232",
          descripcion: "LOTZA FIZZ 48x883g",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "g23",
          pasillo: "19",
          codigo: "6178",
          descripcion: "MOGUL. PIECITOS 12X30G",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "g24",
          pasillo: "20",
          codigo: "11646",
          descripcion: "ROLLO MOGUL ACIDO x 12u",
          bu: "0",
          qty: "2",
          unit: "DI",
        },
      ],
    },
    {
      name: "DIV. ALIMENTOS",
      total_bu: "3",
      products: [
        {
          id: "a1",
          pasillo: "091",
          codigo: "14611",
          descripcion: "PURE TOMATE TETRABRIK 520g",
          bu: "1",
          qty: "6",
          unit: "UN",
        },
        {
          id: "a2",
          pasillo: "092",
          codigo: "14438",
          descripcion: "JG. PV. ARC FRUTILLA 18u x 18g",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "a3",
          pasillo: "093",
          codigo: "13174",
          descripcion: "BIZC. VAINILLA x 480g",
          bu: "0",
          qty: "1",
          unit: "UN",
        },
        {
          id: "a4",
          pasillo: "093",
          codigo: "13175",
          descripcion: "BIZC. MARMOLADO 500g",
          bu: "0",
          qty: "1",
          unit: "UN",
        },
        {
          id: "a5",
          pasillo: "093",
          codigo: "13176",
          descripcion: "BIZC. CHOCOLATE 480g",
          bu: "0",
          qty: "1",
          unit: "UN",
        },
        {
          id: "a6",
          pasillo: "107",
          codigo: "14429",
          descripcion: "JG. PV. ARC NARANJA 18 X 15g",
          bu: "0",
          qty: "3",
          unit: "DI",
        },
        {
          id: "a7",
          pasillo: "107",
          codigo: "14430",
          descripcion: "JG. PV. ARC MANZANA 18 X 15g",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "a8",
          pasillo: "107",
          codigo: "14431",
          descripcion: "JG. PV. ARC MULTIFRUTA 18 X 15G",
          bu: "0",
          qty: "2",
          unit: "DI",
        },
        {
          id: "a9",
          pasillo: "107",
          codigo: "14432",
          descripcion: "JG. PV. ARC NAR DURAZNO 18 X 15g",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "a10",
          pasillo: "108",
          codigo: "5046",
          descripcion: "ESTUCHE MEMBRILLO 500g",
          bu: "0",
          qty: "2",
          unit: "UN",
        },
        {
          id: "a11",
          pasillo: "109",
          codigo: "5044",
          descripcion: "ESTUCHE BATATA 500g",
          bu: "0",
          qty: "8",
          unit: "UN",
        },
        {
          id: "a12",
          pasillo: "110",
          codigo: "14433",
          descripcion: "JG. PV. ARC LIMONADA 18 X 15G",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "a13",
          pasillo: "110",
          codigo: "14434",
          descripcion: "JG. PV. ARC ANANA 18 X 15G",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "a14",
          pasillo: "110",
          codigo: "14435",
          descripcion: "JG. PV. ARC NAR/BANANA 18 X 18g",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "a15",
          pasillo: "110",
          codigo: "14436",
          descripcion: "JG. PV. ARC NAR DULCE 18 X 15g",
          bu: "0",
          qty: "2",
          unit: "DI",
        },
        {
          id: "a16",
          pasillo: "110",
          codigo: "14437",
          descripcion: "JG. PV. ARC NAR-MANGO 18 X 15g",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "a17",
          pasillo: "115",
          codigo: "14439",
          descripcion: "JG. PV. ARC DURAZNO 18 X 15G",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "a18",
          pasillo: "115",
          codigo: "14440",
          descripcion: "JG. PV. ARC 3 FRUTAS 18 x 15g",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "a19",
          pasillo: "115",
          codigo: "14441",
          descripcion: "JG. PV. ARC POM. ROSADO 18 X 15g",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "a20",
          pasillo: "117",
          codigo: "6817",
          descripcion: "LATA X 5KG ARCOR MEMBRILLO",
          bu: "0",
          qty: "1",
          unit: "UN",
        },
        {
          id: "a21",
          pasillo: "139",
          codigo: "13480",
          descripcion: "FIDEOS ARC TIRABUZON x 500g",
          bu: "2",
          qty: "0",
          unit: "DI",
        },
        {
          id: "a22",
          pasillo: "143",
          codigo: "14997",
          descripcion: "RAMEN CARNE x70g",
          bu: "0",
          qty: "5",
          unit: "UN",
        },
        {
          id: "a23",
          pasillo: "146",
          codigo: "14996",
          descripcion: "RAMEN POLLO x70g",
          bu: "0",
          qty: "5",
          unit: "UN",
        },
        {
          id: "a24",
          pasillo: "95",
          codigo: "14550",
          descripcion: "FLAN AGRUP. DD LECHE GODET x 8u",
          bu: "0",
          qty: "16",
          unit: "UN",
        },
        {
          id: "a25",
          pasillo: "95",
          codigo: "14551",
          descripcion: "FLAN AGRUP. VAINILLA GODET x 8u",
          bu: "0",
          qty: "24",
          unit: "UN",
        },
        {
          id: "a26",
          pasillo: "95",
          codigo: "14552",
          descripcion: "GELA. GODET AGRUP. FRUTILLA x 8u",
          bu: "0",
          qty: "16",
          unit: "UN",
        },
        {
          id: "a27",
          pasillo: "95",
          codigo: "14554",
          descripcion: "GELA. GODET AGRUP. FRAMBUESA x 8u",
          bu: "0",
          qty: "16",
          unit: "UN",
        },
        {
          id: "a28",
          pasillo: "97",
          codigo: "14564",
          descripcion: "GELA. BC AGRUP. DURAZNO LIGHT x 8u",
          bu: "0",
          qty: "8",
          unit: "UN",
        },
        {
          id: "a29",
          pasillo: "97",
          codigo: "14565",
          descripcion: "GELA. BC AGRUP. FRAMBUESA x 8u",
          bu: "0",
          qty: "8",
          unit: "UN",
        },
      ],
    },
    {
      name: "DIV. AGROINDUSTRIAS",
      total_bu: "2",
      products: [
        {
          id: "ag1",
          pasillo: "118",
          codigo: "12753",
          descripcion: "AZUCAR ARCOR x 1kg",
          bu: "2",
          qty: "0",
          unit: "UN",
        },
      ],
    },
    {
      name: "DIV. CHOCOLATES",
      total_bu: "0",
      products: [
        {
          id: "c1",
          pasillo: "45",
          codigo: "13017",
          descripcion: "COFLER BLOCK X170G",
          bu: "0",
          qty: "4",
          unit: "UN",
        },
        {
          id: "c2",
          pasillo: "47",
          codigo: "13137",
          descripcion: "SURTIDO CHOCOLATE ARCOR x 246g",
          bu: "0",
          qty: "5",
          unit: "DI",
        },
        {
          id: "c3",
          pasillo: "48",
          codigo: "10340",
          descripcion: "COFLER AIRE. LECHE X55g",
          bu: "0",
          qty: "5",
          unit: "UN",
        },
        {
          id: "c4",
          pasillo: "48",
          codigo: "10341",
          descripcion: "COFLER AIRE. BLANCO X55G",
          bu: "0",
          qty: "3",
          unit: "UN",
        },
        {
          id: "c5",
          pasillo: "48",
          codigo: "10342",
          descripcion: "COFLER AIRE. MIXTO X55G",
          bu: "0",
          qty: "3",
          unit: "UN",
        },
        {
          id: "c6",
          pasillo: "48",
          codigo: "10343",
          descripcion: "COFLER AIRE. C/ALMENDRAS X55GR",
          bu: "0",
          qty: "3",
          unit: "UN",
        },
        {
          id: "c7",
          pasillo: "48",
          codigo: "11584",
          descripcion: "COFLER AIRE. RELL TOFI x70g",
          bu: "0",
          qty: "3",
          unit: "UN",
        },
        {
          id: "c8",
          pasillo: "48",
          codigo: "11586",
          descripcion: "COFLER AIRE. RELL BOB x67g",
          bu: "0",
          qty: "3",
          unit: "UN",
        },
        {
          id: "c9",
          pasillo: "53",
          codigo: "6072",
          descripcion: "CHOCOLATE C/LECHE 10x25g",
          bu: "0",
          qty: "50",
          unit: "UN",
        },
        {
          id: "c10",
          pasillo: "53",
          codigo: "6074",
          descripcion: "CHOCOLATE BLANCO 10x25g",
          bu: "0",
          qty: "10",
          unit: "UN",
        },
        {
          id: "c11",
          pasillo: "57",
          codigo: "3465",
          descripcion: "OBLEA B-O-B LECHE X30G",
          bu: "0",
          qty: "24",
          unit: "UN",
        },
        {
          id: "c12",
          pasillo: "59",
          codigo: "13258",
          descripcion: "ROCKLETS x 500g CONFITADO",
          bu: "0",
          qty: "2",
          unit: "DI",
        },
      ],
    },
    {
      name: "DIV.HARINAS",
      total_bu: "2",
      products: [
        {
          id: "h1",
          pasillo: "24",
          codigo: "13325",
          descripcion: "MANA RELLENA C/LIMON x 152g",
          bu: "0",
          qty: "4",
          unit: "UN",
        },
        {
          id: "h2",
          pasillo: "24",
          codigo: "13781",
          descripcion: "MANA LIV.C/LECHE x 136g",
          bu: "0",
          qty: "3",
          unit: "UN",
        },
        {
          id: "h3",
          pasillo: "24",
          codigo: "13783",
          descripcion: "MANA LIV. VAINILLAS X136g",
          bu: "0",
          qty: "12",
          unit: "UN",
        },
        {
          id: "h4",
          pasillo: "25",
          codigo: "13992",
          descripcion: "FORMIS(fuccia) VAI/FRUT. x102g",
          bu: "0",
          qty: "3",
          unit: "UN",
        },
        {
          id: "h5",
          pasillo: "25",
          codigo: "13993",
          descripcion: "FORMIS(rojo) VAI/CHOC x102g",
          bu: "0",
          qty: "2",
          unit: "UN",
        },
        {
          id: "h6",
          pasillo: "25",
          codigo: "13997",
          descripcion: "FORMIS(lila) BLACK x102g",
          bu: "0",
          qty: "3",
          unit: "UN",
        },
        {
          id: "h7",
          pasillo: "26",
          codigo: "14380",
          descripcion: "GALL. COFLER BOB x 85g",
          bu: "0",
          qty: "6",
          unit: "DI",
        },
        {
          id: "h8",
          pasillo: "26",
          codigo: "14502",
          descripcion: "GALLE.CER.MIX.AVENA/CHOCO. x 207g",
          bu: "0",
          qty: "10",
          unit: "UN",
        },
        {
          id: "h9",
          pasillo: "28",
          codigo: "6768",
          descripcion: "TORTITAS BLACK X125G",
          bu: "0",
          qty: "5",
          unit: "UN",
        },
        {
          id: "h10",
          pasillo: "28",
          codigo: "6770",
          descripcion: "TORTITAS CHOCOLATE X125G",
          bu: "0",
          qty: "5",
          unit: "UN",
        },
        {
          id: "h11",
          pasillo: "29",
          codigo: "3746",
          descripcion: "CAJA SALADIX DUO X80GS",
          bu: "0",
          qty: "6",
          unit: "UN",
        },
        {
          id: "h12",
          pasillo: "29",
          codigo: "6973",
          descripcion: "CAJA SALADIX PIZZA 100g",
          bu: "0",
          qty: "2",
          unit: "UN",
        },
        {
          id: "h13",
          pasillo: "29",
          codigo: "7167",
          descripcion: "CAJA SALADIX JAMON 100g",
          bu: "0",
          qty: "12",
          unit: "UN",
        },
        {
          id: "h14",
          pasillo: "29",
          codigo: "7168",
          descripcion: "CAJA SALADIX CALABRESA 100g",
          bu: "0",
          qty: "2",
          unit: "UN",
        },
        {
          id: "h15",
          pasillo: "31",
          codigo: "13574",
          descripcion: "GALLE.CER.MIX.AVE/PAS. x 207g",
          bu: "0",
          qty: "14",
          unit: "UN",
        },
        {
          id: "h16",
          pasillo: "31",
          codigo: "13575",
          descripcion: "GALLE.CER.MIX.SEM/CHIP x 207g",
          bu: "0",
          qty: "10",
          unit: "UN",
        },
        {
          id: "h17",
          pasillo: "31",
          codigo: "13576",
          descripcion: "GALLE.CER.MIX FRU/CHIA x 207g",
          bu: "0",
          qty: "10",
          unit: "UN",
        },
        {
          id: "h18",
          pasillo: "32",
          codigo: "14361",
          descripcion: "SERRANITAS OFERTA X315G",
          bu: "1",
          qty: "0",
          unit: "DI",
        },
        {
          id: "h19",
          pasillo: "32",
          codigo: "7049",
          descripcion: "SERRANAS SANDWICH 3 X 112 GRS",
          bu: "0",
          qty: "3",
          unit: "DI",
        },
        {
          id: "h20",
          pasillo: "33",
          codigo: "11074",
          descripcion: "GALLETA ROCKLET X118G",
          bu: "1",
          qty: "1",
          unit: "UN",
        },
        {
          id: "h21",
          pasillo: "33",
          codigo: "12794",
          descripcion: "GALLETA COFLER x 120grs",
          bu: "0",
          qty: "9",
          unit: "UN",
        },
        {
          id: "h22",
          pasillo: "33",
          codigo: "15201",
          descripcion: "TIRA SALADIX JAMON 6x40G",
          bu: "0",
          qty: "2",
          unit: "DI",
        },
        {
          id: "h23",
          pasillo: "33",
          codigo: "15202",
          descripcion: "TIRA SALADIX PIZZA 6x40G",
          bu: "0",
          qty: "2",
          unit: "DI",
        },
        {
          id: "h24",
          pasillo: "33",
          codigo: "15203",
          descripcion: "TIRA SALADIX CALABRESA 6x40g",
          bu: "0",
          qty: "3",
          unit: "DI",
        },
        {
          id: "h25",
          pasillo: "33",
          codigo: "15205",
          descripcion: "TIRA SALADIX DUO 6x33G",
          bu: "0",
          qty: "1",
          unit: "DI",
        },
        {
          id: "h26",
          pasillo: "38",
          codigo: "11695",
          descripcion: "GALLETA BLOCK 30X124G",
          bu: "0",
          qty: "9",
          unit: "UN",
        },
        {
          id: "h27",
          pasillo: "69",
          codigo: "15316",
          descripcion: "SALADIX SNACK ORIG x 80g",
          bu: "0",
          qty: "10",
          unit: "UN",
        },
        {
          id: "h28",
          pasillo: "71",
          codigo: "12490",
          descripcion: "SALADIX SNACK CROSS x 67g",
          bu: "0",
          qty: "4",
          unit: "UN",
        },
        {
          id: "h29",
          pasillo: "72",
          codigo: "15315",
          descripcion: "SALADIX SNACK CHEDDAR x 72g",
          bu: "0",
          qty: "10",
          unit: "UN",
        },
        {
          id: "h30",
          pasillo: "9(42)",
          codigo: "14375",
          descripcion: "GALL. RELL CHOCO. COFLER x 105g",
          bu: "0",
          qty: "2",
          unit: "DI",
        },
      ],
    },
    {
      name: "CHOCOLATES ARCOR J.V.",
      total_bu: "0",
      products: [
        {
          id: "ca1",
          pasillo: "35",
          codigo: "13357",
          descripcion: "MINITORTA AGUILA BLANCOx 69grs",
          bu: "0",
          qty: "2",
          unit: "UN",
        },
        {
          id: "ca2",
          pasillo: "35",
          codigo: "6596",
          descripcion: "ALF. COFLER BLOCK X60G",
          bu: "0",
          qty: "9",
          unit: "UN",
        },
        {
          id: "ca3",
          pasillo: "37",
          codigo: "3312",
          descripcion: "NUEVO TATIN SIMPLE NEGRO 56X33G",
          bu: "0",
          qty: "26",
          unit: "UN",
        },
        {
          id: "ca4",
          pasillo: "37",
          codigo: "3313",
          descripcion: "NUEVO TATIN SIMPLE BLANCO X33GR.",
          bu: "0",
          qty: "16",
          unit: "UN",
        },
        {
          id: "ca5",
          pasillo: "42",
          codigo: "13359",
          descripcion: "MINITORTA AGUILA BROWNIE x 71g",
          bu: "0",
          qty: "14",
          unit: "UN",
        },
        {
          id: "ca6",
          pasillo: "55",
          codigo: "12625",
          descripcion: "CEREAL MIX LIGHT YOG/FRUTILLA X26grs",
          bu: "0",
          qty: "6",
          unit: "UN",
        },
        {
          id: "ca7",
          pasillo: "55",
          codigo: "12626",
          descripcion: "CEREAL MIX YOGURTH FRUTILLA x 26grs",
          bu: "0",
          qty: "44",
          unit: "UN",
        },
        {
          id: "ca8",
          pasillo: "55",
          codigo: "13364",
          descripcion: "CEREAL MIX FRUTILLA/CHOCO x 26grs",
          bu: "0",
          qty: "20",
          unit: "UN",
        },
      ],
    },
    {
      name: "DIV.HARINAS BAGLEY",
      total_bu: "8",
      products: [
        {
          id: "hb1",
          pasillo: "61",
          codigo: "14323",
          descripcion: "CHOCOLINAS x 250g",
          bu: "0",
          qty: "15",
          unit: "UN",
        },
        {
          id: "hb2",
          pasillo: "63",
          codigo: "13348",
          descripcion: "RAM SONRISAS FRAMBUESA X108G",
          bu: "0",
          qty: "10",
          unit: "UN",
        },
        {
          id: "hb3",
          pasillo: "63",
          codigo: "13965",
          descripcion: "RAM MERENGADAS x 88g",
          bu: "0",
          qty: "7",
          unit: "UN",
        },
        {
          id: "hb4",
          pasillo: "73",
          codigo: "14408",
          descripcion: "TRAVIATA 3x108g",
          bu: "1",
          qty: "6",
          unit: "DI",
        },
        {
          id: "hb5",
          pasillo: "73",
          codigo: "14772",
          descripcion: "SURTIDO BAGLEY x 400GRS.",
          bu: "1",
          qty: "10",
          unit: "UN",
        },
        {
          id: "hb6",
          pasillo: "75",
          codigo: "14394",
          descripcion: "TRAVIATA CRACK KESITAS X96G",
          bu: "0",
          qty: "10",
          unit: "UN",
        },
        {
          id: "hb7",
          pasillo: "78",
          codigo: "15027",
          descripcion: "TRAVIATA CRACK KESITAS X3",
          bu: "1",
          qty: "0",
          unit: "DI",
        },
        {
          id: "hb8",
          pasillo: "79",
          codigo: "9463",
          descripcion: "CRIOLLITAS SIN SAL X169G",
          bu: "0",
          qty: "6",
          unit: "UN",
        },
        {
          id: "hb9",
          pasillo: "81",
          codigo: "9419",
          descripcion: "OPERA X 55 GRS.",
          bu: "0",
          qty: "8",
          unit: "UN",
        },
        {
          id: "hb10",
          pasillo: "82",
          codigo: "14392",
          descripcion: "TRAVIATA CRACK REX X3",
          bu: "1",
          qty: "0",
          unit: "DI",
        },
        {
          id: "hb11",
          pasillo: "83",
          codigo: "10173",
          descripcion: "KESITAS X 75 GRS",
          bu: "1",
          qty: "10",
          unit: "UN",
        },
        {
          id: "hb12",
          pasillo: "84",
          codigo: "7198",
          descripcion: "REX ESTUCHE X125G",
          bu: "1",
          qty: "2",
          unit: "UN",
        },
        {
          id: "hb13",
          pasillo: "85",
          codigo: "9341",
          descripcion: "OPERA SIMPLE X 92G",
          bu: "0",
          qty: "12",
          unit: "UN",
        },
        {
          id: "hb14",
          pasillo: "86",
          codigo: "10174",
          descripcion: "REX 75G",
          bu: "0",
          qty: "12",
          unit: "UN",
        },
        {
          id: "hb15",
          pasillo: "89",
          codigo: "10204",
          descripcion: "CRIOLLITAS ORIGINAL X 3",
          bu: "2",
          qty: "6",
          unit: "DI",
        },
      ],
    },
    {
      name: "CHOCOLATES BAGLEY JV",
      total_bu: "0",
      products: [
        {
          id: "cb1",
          pasillo: "44",
          codigo: "15007",
          descripcion: "ALF. CHOCOTORTA x71g",
          bu: "0",
          qty: "2",
          unit: "UN",
        },
      ],
    },
    {
      name: "COMESTIBLES LA CAMPAGNOLA",
      total_bu: "1",
      products: [
        {
          id: "lc1",
          pasillo: "123",
          codigo: "13133",
          descripcion: "TOMATE PERITA LC X400G",
          bu: "0",
          qty: "6",
          unit: "UN",
        },
        {
          id: "lc2",
          pasillo: "124",
          codigo: "10600",
          descripcion: "BEBIDA BC MULTIFRUTA X 1 LITRO",
          bu: "1",
          qty: "0",
          unit: "UN",
        },
        {
          id: "lc3",
          pasillo: "124",
          codigo: "14152",
          descripcion: "TOMATE CUBETEADO AJO Y CEB. LC X400GRS",
          bu: "0",
          qty: "12",
          unit: "UN",
        },
        {
          id: "lc4",
          pasillo: "124",
          codigo: "14153",
          descripcion: "TOMATE CUBETEADO OREG. LC X400GRS",
          bu: "0",
          qty: "12",
          unit: "UN",
        },
        {
          id: "lc5",
          pasillo: "125",
          codigo: "13314",
          descripcion: "SALSATI POMAROLA D.P X 340 GRS.",
          bu: "0",
          qty: "3",
          unit: "UN",
        },
        {
          id: "lc6",
          pasillo: "125",
          codigo: "13317",
          descripcion: "SALSATI FILETTO D.P. X 340 GRS.",
          bu: "0",
          qty: "6",
          unit: "UN",
        },
        {
          id: "lc7",
          pasillo: "126",
          codigo: "12347",
          descripcion: "SALSA BARBACOA LC x 250g",
          bu: "0",
          qty: "4",
          unit: "UN",
        },
        {
          id: "lc8",
          pasillo: "135",
          codigo: "13135",
          descripcion: "ATUN ACEITE LC x 170g",
          bu: "0",
          qty: "6",
          unit: "UN",
        },
        {
          id: "lc9",
          pasillo: "137",
          codigo: "13151",
          descripcion: "MERM. BC DURAZNO X390",
          bu: "0",
          qty: "6",
          unit: "UN",
        },
        {
          id: "lc10",
          pasillo: "137",
          codigo: "13155",
          descripcion: "MERM. BC NARANJA x 390g",
          bu: "0",
          qty: "6",
          unit: "UN",
        },
        {
          id: "lc11",
          pasillo: "89",
          codigo: "13241",
          descripcion: "CHOCLO LC AMARILLO ENTERO X 300G.",
          bu: "0",
          qty: "6",
          unit: "UN",
        },
        {
          id: "lc12",
          pasillo: "90",
          codigo: "13150",
          descripcion: "JALEA MEMBRILLO LC(coleccionable) X454G",
          bu: "0",
          qty: "2",
          unit: "UN",
        },
        {
          id: "lc13",
          pasillo: "92",
          codigo: "9849",
          descripcion: "CHOCLO AMAR. CREMOSO LC X 300G",
          bu: "0",
          qty: "6",
          unit: "UN",
        },
      ],
    },
    {
      name: "PASCUA — DIV. CHOCOLATES",
      total_bu: "0",
      products: [
        {
          id: "p1",
          pasillo: "L0101",
          codigo: "5745",
          descripcion: "HUEVO COFLER BLOCK X56G",
          bu: "0",
          qty: "3",
          unit: "UN",
        },
      ],
    },
  ],
};

// ─── FIRMA DIGITAL ────────────────────────────────────────────
function SigPad({ onSave, onCancel }) {
  const ref = useRef();
  const drawing = useRef(false);
  const gp = (e, cv) => {
    const r = cv.getBoundingClientRect(),
      s = e.touches ? e.touches[0] : e;
    return {
      x: (s.clientX - r.left) * (cv.width / r.width),
      y: (s.clientY - r.top) * (cv.height / r.height),
    };
  };
  const start = (e) => {
    drawing.current = true;
    const cv = ref.current,
      ctx = cv.getContext("2d"),
      p = gp(e, cv);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const draw = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const cv = ref.current,
      ctx = cv.getContext("2d"),
      p = gp(e, cv);
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const stop = () => (drawing.current = false);
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.82)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div style={card({ maxWidth: "380px", width: "100%" })}>
        <div style={{ fontWeight: 700, fontSize: "16px", marginBottom: "4px" }}>
          ✍️ Firma Digital
        </div>
        <p style={{ fontSize: "12px", color: C.muted, marginBottom: "12px" }}>
          Firmá con el dedo para confirmar el control
        </p>
        <canvas
          ref={ref}
          width={340}
          height={150}
          style={{
            border: `2px dashed ${C.bord}`,
            borderRadius: "8px",
            background: "#fff",
            width: "100%",
            cursor: "crosshair",
          }}
          onMouseDown={start}
          onMouseMove={draw}
          onMouseUp={stop}
          onMouseLeave={stop}
          onTouchStart={start}
          onTouchMove={draw}
          onTouchEnd={stop}
        />
        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          <button
            style={btn({
              background: C.surf2,
              color: C.muted,
              border: `1px solid ${C.bord}`,
              flex: 1,
            })}
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            style={btn({
              background: C.surf2,
              color: C.muted,
              border: `1px solid ${C.bord}`,
              flex: 1,
            })}
            onClick={() => {
              const cv = ref.current;
              cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
            }}
          >
            Limpiar
          </button>
          <button
            style={btn({
              background: C.green,
              color: "#0a0c10",
              fontWeight: 700,
              flex: 2,
            })}
            onClick={() => onSave(ref.current.toDataURL())}
          >
            ✓ Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL ERROR ──────────────────────────────────────────────
function ErrModal({ onConfirm, onCancel }) {
  const [m, sm] = useState("");
  const [custom, sc] = useState("");
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.82)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div style={card({ maxWidth: "380px", width: "100%" })}>
        <div
          style={{
            fontWeight: 700,
            fontSize: "15px",
            color: C.red,
            marginBottom: "12px",
          }}
        >
          ❌ Motivo del Error
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "7px",
            marginBottom: "12px",
          }}
        >
          {MOTIVOS.map((x) => (
            <button
              key={x}
              style={btn({
                background: m === x ? C.red : "transparent",
                color: m === x ? "#fff" : C.muted,
                border: `1px solid ${m === x ? C.red : C.bord}`,
                fontSize: "12px",
                padding: "6px 12px",
              })}
              onClick={() => sm(x)}
            >
              {x}
            </button>
          ))}
        </div>
        {m === "Otro" && (
          <input
            style={{ ...inp, marginBottom: "10px" }}
            placeholder="Describir..."
            value={custom}
            onChange={(e) => sc(e.target.value)}
          />
        )}
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            style={btn({
              background: C.surf2,
              color: C.muted,
              border: `1px solid ${C.bord}`,
              flex: 1,
            })}
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            style={btn({
              background: C.red,
              color: "#fff",
              fontWeight: 700,
              flex: 2,
            })}
            disabled={!m}
            onClick={() => onConfirm(m === "Otro" ? custom || "Otro" : m)}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
function PrintDoc({ cons, firmaData }) {
  if (!cons) return null;
  const ops = cons.activeOps || [];
  const errors = cons.lines.filter((l) => l.estado === "error");
  const okLines = cons.lines.filter((l) => l.estado === "ok");
  const ctrl = firmaData?.controlador || cons.controlador || "";

  // Inyectar CSS de impresión en el head del documento
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "rosarc-print-style";
    style.innerHTML = `
      @media print {
        .op-bloque { display: block !important; page-break-before: always !important; break-before: page !important; }
        .op-bloque-first { display: block !important; page-break-before: auto !important; break-before: auto !important; }
      }
    `;
    if (!document.getElementById("rosarc-print-style")) {
      document.head.appendChild(style);
    }
    return () => {
      const el = document.getElementById("rosarc-print-style");
      if (el) el.remove();
    };
  }, []);

  return (
    <div
      style={{
        background: "#fff",
        color: "#222",
        padding: "9mm 11mm",
        fontFamily: "Arial,sans-serif",
        fontSize: "7.5pt",
        maxWidth: "210mm",
        margin: "0 auto",
        boxShadow: "0 2px 20px rgba(0,0,0,.15)",
      }}
    >
      {/* Header — aparece solo en la primera hoja */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "4mm",
          paddingBottom: "3mm",
          borderBottom: "2.5pt solid #C0392B",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "22pt",
              fontWeight: 900,
              color: "#C0392B",
              letterSpacing: "2px",
              lineHeight: 1,
            }}
          >
            ROS-ARC
          </div>
          <div
            style={{
              fontSize: "6pt",
              color: "#666",
              letterSpacing: "3px",
              textTransform: "uppercase",
            }}
          >
            Distribuidora · Consolidados
          </div>
        </div>
        <div style={{ display: "flex", gap: "9px" }}>
          {[
            ["Pedido", `#${cons.numero}`],
            ["Fecha", cons.fecha],
            ["Líneas", cons.lines.length],
          ].map(([l, v]) => (
            <div
              key={l}
              style={{
                background: "#f8f8f8",
                border: "1pt solid #ddd",
                borderRadius: "3pt",
                padding: "3pt 8pt",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "5pt",
                  color: "#888",
                  textTransform: "uppercase",
                }}
              >
                {l}
              </div>
              <div
                style={{
                  fontSize: l === "Pedido" ? "13pt" : "9pt",
                  fontWeight: 900,
                }}
              >
                {v}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Resumen operarios */}
      {ops.length > 0 && (
        <div
          style={{
            background: "#f8f8f8",
            border: "1pt solid #ddd",
            borderRadius: "3pt",
            padding: "3.5pt 7pt",
            marginBottom: "3mm",
            display: "flex",
            gap: "7pt",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: "5pt",
              color: "#888",
              textTransform: "uppercase",
              minWidth: "48pt",
            }}
          >
            Armado por
          </span>
          {ops.map((op) => (
            <div
              key={op.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "3pt",
                background: "#fff",
                border: "1pt solid #ddd",
                borderRadius: "20pt",
                padding: "1.5pt 6pt",
              }}
            >
              <div
                style={{
                  width: "6pt",
                  height: "6pt",
                  borderRadius: "50%",
                  background: op.color,
                }}
              />
              <span style={{ fontSize: "6.5pt", fontWeight: 600 }}>
                {op.nombre}
              </span>
              {op.startTime && (
                <span style={{ fontSize: "5.5pt", color: "#888" }}>
                  {" "}
                  {fHora(op.startTime)}
                  {op.endTime
                    ? `→${fHora(op.endTime)} (${fTime(
                        Number(op.endTime) - Number(op.startTime)
                      ).slice(0, 5)})`
                    : ""}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Resumen control */}
      {(okLines.length > 0 || errors.length > 0) && (
        <div style={{ display: "flex", gap: "7pt", marginBottom: "4mm" }}>
          {[
            ["OK", okLines.length, "#06d6a0", "#effffa"],
            ["Errores", errors.length, "#FF4757", "#fff5f5"],
            ["Total", cons.lines.length, "#555", "#f8f8f8"],
          ].map(([l, v, c, bg]) => (
            <div
              key={l}
              style={{
                background: bg,
                border: `1pt solid ${c}40`,
                borderRadius: "3pt",
                padding: "2pt 7pt",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "5pt",
                  color: c,
                  textTransform: "uppercase",
                }}
              >
                {l}
              </div>
              <div style={{ fontSize: "11pt", fontWeight: 900, color: c }}>
                {v}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Errores */}
      {errors.length > 0 && (
        <div
          style={{
            background: "#fff5f5",
            border: "1pt solid #FF4757",
            borderRadius: "3pt",
            padding: "4pt 7pt",
            marginBottom: "4mm",
          }}
        >
          <div
            style={{
              fontSize: "6pt",
              color: "#c0392b",
              fontWeight: 700,
              letterSpacing: "1px",
              textTransform: "uppercase",
              marginBottom: "3pt",
            }}
          >
            ⚠ ERRORES
          </div>
          {errors.map((l) => (
            <div
              key={l.id}
              style={{
                display: "flex",
                gap: "5pt",
                padding: "1.5pt 0",
                borderBottom: ".5pt solid #fecaca",
                fontSize: "7pt",
              }}
            >
              <span style={{ color: "#999", minWidth: "20pt" }}>
                {l.pasillo || "—"}
              </span>
              <span style={{ flex: 1, fontWeight: 500 }}>{l.descripcion}</span>
              <span style={{ color: "#FF4757", fontWeight: 700 }}>
                {l.motivo}
              </span>
              <span style={{ color: "#999" }}>{l.operario}</span>
            </div>
          ))}
        </div>
      )}

      {/* Una sección por operario — cada una en su propia hoja al imprimir */}
      {(cons.activeOps || []).map((op, opIdx) => {
        const divOp = op.divisiones || [];
        const lineasOp =
          divOp.length > 0
            ? cons.lines.filter((l) => divOp.includes(l.seccion))
            : cons.lines;
        const secsOp = [...new Set(lineasOp.map((l) => l.seccion))];
        if (lineasOp.length === 0) return null;
        return (
          <div
            key={op.id}
            className={opIdx > 0 ? "op-bloque" : "op-bloque-first"}
          >
            {/* Encabezado del operario */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8pt",
                marginBottom: "4mm",
                paddingBottom: "2mm",
                borderBottom: `2pt solid ${op.color}`,
              }}
            >
              <div
                style={{
                  width: "14pt",
                  height: "14pt",
                  borderRadius: "50%",
                  background: op.color,
                }}
              />
              <div>
                <div
                  style={{ fontSize: "11pt", fontWeight: 900, color: op.color }}
                >
                  {op.nombre}
                </div>
                <div style={{ fontSize: "6pt", color: "#888" }}>
                  {lineasOp.length} líneas ·{" "}
                  {divOp.join(" · ") || "Todas las divisiones"}
                  {op.startTime ? ` · Inicio: ${fHora(op.startTime)}` : ""}
                  {op.endTime ? ` → ${fHora(op.endTime)}` : ""}
                </div>
              </div>
            </div>

            {/* Tablas por sección */}
            {secsOp.map((sec) => {
              const sl = lineasOp.filter((l) => l.seccion === sec);
              const secOk = sl.filter((l) => l.estado === "ok").length;
              return (
                <div key={sec} style={{ marginBottom: "3.5mm" }}>
                  <div
                    style={{
                      background: op.color,
                      color: "#fff",
                      padding: "2.5pt 5pt",
                      fontSize: "8pt",
                      fontWeight: 700,
                      letterSpacing: "2px",
                      textTransform: "uppercase",
                      marginBottom: "1pt",
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>{sec}</span>
                    <span style={{ fontSize: "6pt", opacity: 0.8 }}>
                      {secOk > 0
                        ? `${secOk}/${sl.length} ✓`
                        : sl.length + " líneas"}
                    </span>
                  </div>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "9pt",
                    }}
                  >
                    <thead>
                      <tr style={{ background: "#f0f0f0" }}>
                        {[
                          "PASILLO",
                          "CÓDIGO",
                          "DESCRIPCIÓN",
                          "BU",
                          "CANTIDAD",
                          "✓",
                        ].map((h) => (
                          <th
                            key={h}
                            style={{
                              fontSize: "5.5pt",
                              fontWeight: 700,
                              letterSpacing: "1px",
                              textTransform: "uppercase",
                              color: "#555",
                              padding: "2pt 3pt",
                              textAlign: h === "FINAL" ? "right" : "left",
                              borderBottom: "1pt solid #ccc",
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sl.map((p, i) => (
                        <tr
                          key={p.id}
                          style={{ background: i % 2 ? "#fafafa" : "#fff" }}
                        >
                          <td
                            style={{
                              padding: "3pt 4pt",
                              color: "#999",
                              fontSize: "9pt",
                              borderBottom: ".5pt solid #ebebeb",
                              textAlign: "center",
                            }}
                          >
                            {p.pasillo || "—"}
                          </td>
                          <td
                            style={{
                              padding: "2.5pt 3pt",
                              color: "#999",
                              fontSize: "6.5pt",
                              borderBottom: ".5pt solid #ebebeb",
                            }}
                          >
                            {p.codigo}
                          </td>
                          <td
                            style={{
                              padding: "3pt 4pt",
                              fontWeight: 500,
                              borderBottom: ".5pt solid #ebebeb",
                            }}
                          >
                            {p.descripcion}
                          </td>
                          <td
                            style={{
                              padding: "3pt 4pt",
                              textAlign: "center",
                              fontWeight: 1100,
                              color: op.color,
                              borderBottom: ".5pt solid #ebebeb",
                            }}
                          >
                            {p.unit === "BU" ? p.qty : (p.bu !== "0" ? p.bu : "—")}
                          </td>
                          <td
                            style={{
                              padding: "3pt 4pt",
                              textAlign: "right",
                              fontWeight: 900,
                              fontSize: "13pt",
                              borderBottom: ".5pt solid #ebebeb",
                            }}
                          >
                            {p.unit === "BU" ? (p.bu !== "0" ? p.bu : "0") : p.qty}
                          </td>
                          <td
                            style={{
                              padding: "3pt 4pt",
                              textAlign: "center",
                              color: "#888",
                              fontSize: "6.5pt",
                              borderBottom: ".5pt solid #ebebeb",
                            }}
                          ></td>
                          <td
                            style={{
                              padding: "2.5pt 3pt",
                              textAlign: "center",
                              borderBottom: ".5pt solid #ebebeb",
                            }}
                          >
                            {p.estado === "ok" && (
                              <span
                                style={{
                                  color: "#06d6a0",
                                  fontWeight: 700,
                                  fontSize: "9pt",
                                }}
                              >
                                ✓
                              </span>
                            )}
                            {p.estado === "error" && (
                              <span
                                style={{
                                  color: "#FF4757",
                                  fontWeight: 700,
                                  fontSize: "6.5pt",
                                }}
                              >
                                ✗{p.motivo ? ` ${p.motivo}` : ""}
                              </span>
                            )}
                            {!p.estado && (
                              <div
                                style={{
                                  width: "9pt",
                                  height: "9pt",
                                  border: "1pt solid #aaa",
                                  borderRadius: "2pt",
                                  display: "inline-block",
                                }}
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}

            {/* Firma del operario al pie de su sección */}
            <div
              style={{
                marginTop: "4mm",
                border: `1pt solid ${op.color}`,
                borderRadius: "3pt",
                padding: "4pt 7pt",
                display: "flex",
                gap: "12pt",
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: "5pt",
                    color: "#888",
                    textTransform: "uppercase",
                  }}
                >
                  Operario
                </div>
                <div
                  style={{
                    borderBottom: "1pt solid #ccc",
                    minHeight: "16pt",
                    fontSize: "10pt",
                    fontWeight: 700,
                    color: op.color,
                  }}
                >
                  {op.nombre}
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: "5pt",
                    color: "#888",
                    textTransform: "uppercase",
                  }}
                >
                  Firma
                </div>
                <div
                  style={{ borderBottom: "1pt solid #bbb", minHeight: "16pt" }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: "5pt",
                    color: "#888",
                    textTransform: "uppercase",
                  }}
                >
                  Hora fin
                </div>
                <div
                  style={{
                    borderBottom: "1pt solid #ccc",
                    minHeight: "16pt",
                    fontSize: "10pt",
                    fontWeight: 700,
                  }}
                >
                  {op.endTime ? fHora(op.endTime) : "___:___"}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Sección de control — última hoja */}
      <div className="op-bloque">
        <div
          style={{
            marginTop: "5mm",
            border: "1pt solid #C0392B",
            borderRadius: "3pt",
            padding: "5pt 8pt",
          }}
        >
          <div
            style={{
              fontSize: "5.5pt",
              color: "#C0392B",
              letterSpacing: "2px",
              textTransform: "uppercase",
              fontWeight: 700,
              marginBottom: "5pt",
            }}
          >
            ✓ Control y Firma
          </div>
          <div
            style={{
              display: "flex",
              gap: "9pt",
              marginBottom: ops.length > 0 ? "6pt" : 0,
            }}
          >
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: "5pt",
                  color: "#888",
                  textTransform: "uppercase",
                }}
              >
                Controlador
              </div>
              <div
                style={{
                  borderBottom: "1pt solid #ccc",
                  minHeight: "12pt",
                  fontSize: "10pt",
                  fontWeight: 700,
                }}
              >
                {ctrl}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: "5pt",
                  color: "#888",
                  textTransform: "uppercase",
                }}
              >
                Hora
              </div>
              <div
                style={{
                  borderBottom: "1pt solid #ccc",
                  minHeight: "12pt",
                  fontSize: "10pt",
                  fontWeight: 700,
                }}
              >
                {firmaData?.ts ? fHora(firmaData.ts) : "___:___"}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: "5pt",
                  color: "#888",
                  textTransform: "uppercase",
                }}
              >
                Firma
              </div>
              {firmaData?.firma ? (
                <img
                  src={firmaData.firma}
                  alt="firma"
                  style={{
                    height: "28pt",
                    background: "#f8f8f8",
                    borderRadius: "2pt",
                    border: "1pt solid #ddd",
                  }}
                />
              ) : (
                <div
                  style={{ borderBottom: "1pt solid #bbb", minHeight: "22pt" }}
                />
              )}
            </div>
          </div>
          {ops.length > 0 && (
            <div style={{ display: "flex", gap: "8pt" }}>
              {ops.map((op) => (
                <div key={op.id} style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: "5pt",
                      color: op.color,
                      textTransform: "uppercase",
                    }}
                  >
                    {op.nombre}
                  </div>
                  <div
                    style={{
                      borderBottom: "1pt solid #bbb",
                      minHeight: "20pt",
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        <div
          style={{
            marginTop: "4mm",
            paddingTop: "3mm",
            borderTop: "1pt solid #ddd",
            display: "flex",
            justifyContent: "space-between",
            fontSize: "5.5pt",
            color: "#aaa",
          }}
        >
          <span>Ros-ArC · #{cons.numero}</span>
          <span>
            {new Date().toLocaleDateString("es-AR")}{" "}
            {new Date().toLocaleTimeString("es-AR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MÓDULO OPERARIOS — ABM completo
// ═══════════════════════════════════════════════════════════════
function ModOperarios({ operarios, setOperarios, toast }) {
  const [showForm, sf] = useState(false);
  const [editing, se] = useState(null);
  const [fNombre, sn] = useState("");
  const [fCodigo, sc] = useState("");
  function openNew() {
    sn("");
    sc("");
    se(null);
    sf(true);
  }
  function openEdit(op) {
    sn(op.nombre);
    sc(op.codigo);
    se(op);
    sf(true);
  }

  function save() {
    if (!fNombre.trim()) {
      toast("⚠️ Ingresá el nombre", "error");
      return;
    }
    if (editing) {
      setOperarios((ops) =>
        ops.map((o) =>
          o.id === editing.id ? { ...o, nombre: fNombre, codigo: fCodigo } : o
        )
      );
      toast("✅ Operario actualizado");
    } else {
      const color = OP_COLORS[operarios.length % OP_COLORS.length];
      setOperarios((ops) => [
        ...ops,
        {
          id: Date.now(),
          nombre: fNombre,
          codigo: fCodigo || `OP-${String(ops.length + 1).padStart(2, "0")}`,
          color,
        },
      ]);
      toast("✅ Operario agregado");
    }
    sf(false);
  }

  function del(id) {
    if (!confirm("¿Eliminar este operario?")) return;
    setOperarios((ops) => ops.filter((o) => o.id !== id));
    toast("Operario eliminado");
  }

  return (
    <div style={BS}>
      <button
        style={btn({
          background: `linear-gradient(135deg,${C.accent},#5b21b6)`,
          color: "#fff",
          width: "100%",
          fontSize: "14px",
          padding: "13px",
        })}
        onClick={openNew}
      >
        + Agregar Operario
      </button>

      {showForm && (
        <div style={card({ borderColor: C.accent })}>
          <div style={secTit}>
            {editing ? "✏️ EDITAR" : "➕ NUEVO"} OPERARIO
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "9px",
              marginBottom: "12px",
            }}
          >
            <div>
              <label style={lbl}>Nombre completo</label>
              <input
                style={inp}
                value={fNombre}
                onChange={(e) => sn(e.target.value)}
                placeholder="Juan Pérez"
                autoFocus
              />
            </div>
            <div>
              <label style={lbl}>Legajo / Código</label>
              <input
                style={inp}
                value={fCodigo}
                onChange={(e) => sc(e.target.value)}
                placeholder="OP-01"
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              style={btn({
                background: C.surf2,
                color: C.muted,
                border: `1px solid ${C.bord}`,
                flex: 1,
              })}
              onClick={() => sf(false)}
            >
              Cancelar
            </button>
            <button
              style={btn({
                background: C.green,
                color: "#0a0c10",
                fontWeight: 700,
                flex: 2,
              })}
              onClick={save}
            >
              ✓ {editing ? "Guardar cambios" : "Agregar"}
            </button>
          </div>
        </div>
      )}

      {operarios.length === 0 && !showForm && (
        <div style={{ textAlign: "center", color: C.muted, padding: "40px" }}>
          Sin operarios. Agregá uno para empezar.
        </div>
      )}

      {operarios.map((op) => (
        <div
          key={op.id}
          style={{
            ...card({ padding: "13px 15px" }),
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "50%",
              background: op.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "16px",
              fontWeight: 700,
              color: "#fff",
              flexShrink: 0,
            }}
          >
            {op.nombre.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: "14px" }}>{op.nombre}</div>
            <div style={{ fontSize: "11px", color: C.muted, marginTop: "2px" }}>
              {op.codigo}
            </div>
          </div>
          <button
            style={btn({
              background: "transparent",
              color: C.blue,
              border: `1px solid ${C.bord}`,
              padding: "6px 10px",
              fontSize: "12px",
            })}
            onClick={() => openEdit(op)}
          >
            ✏️
          </button>
          <button
            style={btn({
              background: "transparent",
              color: C.red,
              border: `1px solid ${C.bord}`,
              padding: "6px 10px",
              fontSize: "12px",
            })}
            onClick={() => del(op.id)}
          >
            🗑
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── PARSER CSV RECEPCIÓN ─────────────────────────────────────
function parseDespachoCSV(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.split(",").map((c) => c.trim()));

  const info = {
    nroCarga: "",
    fecha: "",
    chofer: "",
    pallets: "",
    empresa: "ARCOR",
  };
  const productos = [];
  let empresaActual = "";
  let facturaActual = "";

  for (let i = 0; i < lines.length; i++) {
    const row = lines[i];
    if (!row || !row[0]) continue;

    // Header info
    if (row[0].includes("Nro. de Carga:")) {
      info.nroCarga = row[1] || "";
      const fechaRaw = row[4] || "";
      if (fechaRaw.includes("/")) {
        const p = fechaRaw.split("/");
        info.fecha = `20${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(
          2,
          "0"
        )}`;
      }
    }
    if (row[0].includes("Chofer:")) info.chofer = row[1] || "";
    if (row[0].includes("Cantidad de Pallets:")) info.pallets = row[1] || "";
    if (row[0] === "Empresa") empresaActual = row[1] || "";
    if (row[0].includes("Nro. de Factura")) facturaActual = row[1] || "";

    // Productos: EAN en col0 (numérico largo) o col0 vacío con col1 numérico
    const ean = row[0];
    const codigo = row[1];
    const desc = row[2];
    const unidad = row[3];
    const cant = row[4];

    const tieneProducto =
      desc &&
      cant &&
      /^\d+$/.test(cant) &&
      (/^\d{8,}$/.test(ean) || (ean === "" && /^\d+$/.test(codigo)));

    if (
      tieneProducto &&
      desc !== "Total de bultos para esta empresa" &&
      desc !== "Total General"
    ) {
      productos.push({
        id: `${codigo}-${i}`,
        ean: ean || "",
        codigo: codigo || "",
        descripcion: desc || "",
        unidad: unidad || "BULTOS",
        cantEsperada: parseInt(cant) || 0,
        cantReal: null, // null = no verificado
        empresa: empresaActual,
        factura: facturaActual,
        estado: "pendiente", // pendiente | ok | diferencia
        fotoVerificada: false,
        vencimiento: "",
      });
    }
  }

  return { info, productos };
}
// ═══════════════════════════════════════════════════════════════
// MÓDULO RECEPCIÓN v3 — con historial, filtro 3 días, eliminar y sync fix
// REEMPLAZAR desde "function ModRecepcion" hasta el cierre de la función (línea ~3554)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// MÓDULO RECEPCIÓN v4.1
// Flujo: CSV → lista completa → 📷 foto → IA detecta
//   · Matchea CSV → guarda automático (código+vencimiento), pide cantidad
//   · No matchea → panel para cargar como producto extra
// Sync: polling 5s igual que consolidados, trae datos del Sheet
//
// REEMPLAZAR desde "function useRecepcion" hasta el "}" de cierre de ModRecepcion
// ═══════════════════════════════════════════════════════════════

// ── Hook de sync para recepción (igual patrón que useConsolidados) ──
function useRecepcion() {
  const [despacho, setDespachoState] = useState(() => {
    try {
      const s = localStorage.getItem("rosarc_recepcion_v4");
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  });
  const [historial, setHistorialState] = useState(() => {
    try {
      const s = localStorage.getItem("rosarc_recepciones_v3");
      return s ? JSON.parse(s) : [];
    } catch {
      return [];
    }
  });
  const [syncOk, setSyncOk] = useState(false);
  const [lastSync, setLastSync] = useState("");

  const guardarDespacho = useCallback((fn) => {
    setDespachoState((prev) => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      try {
        localStorage.setItem("rosarc_recepcion_v4", JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const guardarHistorial = useCallback((fn) => {
    setHistorialState((prev) => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      try {
        localStorage.setItem("rosarc_recepciones_v3", JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  // Sync: trae el despacho activo del Sheet cada 5s
  const sincronizar = useCallback(async () => {
    try {
      const r = await fetch(`${APPS_SCRIPT_URL}?accion=leer_recepcion`);
      const d = await r.json();
      if (d.status === "ok" && d.despacho) {
        setDespachoState((prev) => {
          const remoto = d.despacho;
          if (!prev) {
            localStorage.setItem("rosarc_recepcion_v4", JSON.stringify(remoto));
            return remoto;
          }
          const mismasCarga = prev?.info?.nroCarga === remoto?.info?.nroCarga;
          if (!mismasCarga) {
            // Carga diferente: tomar remoto
            localStorage.setItem("rosarc_recepcion_v4", JSON.stringify(remoto));
            return remoto;
          }
          // Misma carga: merge producto a producto por _ts
          const prodsMerged = (remoto.productos || []).map((rp) => {
            const lp = (prev.productos || []).find(
              (p) => p.id === rp.id || p.codigo === rp.codigo
            );
            if (!lp) return rp;
            if (lp.cantReal === null && rp.cantReal !== null) return rp;
            if (lp.cantReal !== null && rp.cantReal === null) return lp;
            return (lp._ts || 0) >= (rp._ts || 0) ? lp : rp;
          });
          // Agregar productos extra locales (no estaban en CSV original)
          const extras = (prev.productos || []).filter(
            (p) => p.esExtra && !prodsMerged.find((m) => m.id === p.id)
          );
          const merged = { ...prev, productos: [...prodsMerged, ...extras] };
          localStorage.setItem("rosarc_recepcion_v4", JSON.stringify(merged));
          return merged;
        });
        setSyncOk(true);
        setLastSync(
          new Date().toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
          })
        );
      }
    } catch {}
  }, []);

  useEffect(() => {
    sincronizar();
  }, []);
  useEffect(() => {
    const t = setInterval(sincronizar, 5000);
    return () => clearInterval(t);
  }, [sincronizar]);

  return {
    despacho,
    guardarDespacho,
    historial,
    guardarHistorial,
    sincronizar,
    syncOk,
    lastSync,
  };
}

// ── Componente principal ────────────────────────────────────────
function ModRecepcion({ toast, operarios }) {
  const {
    despacho,
    guardarDespacho,
    historial,
    guardarHistorial,
    sincronizar,
    syncOk,
    lastSync,
  } = useRecepcion();
  const [tab, setTab] = useState("carga");
  const [operario, setOperario] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  // focusIdx: índice del producto recién detectado por foto, para hacer scroll/highlight
  const [focusIdx, setFocusIdx] = useState(null);
  const focusRef = useRef(null);

  // Scroll al producto detectado
  useEffect(() => {
    if (focusIdx !== null && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      focusRef.current.querySelector("input[type='number']")?.focus();
    }
  }, [focusIdx]);

  // Panel de confirmación — solo para productos NO encontrados en CSV
  const [confirmPanel, setConfirmPanel] = useState(null);
  // {
  //   iaResult: { codigo, ean, descripcion, vencimiento },
  //   matchIdx: número | null,   (índice en productos si matcheó)
  //   cantReal: "",
  //   esExtra: false
  // }

  // Historial: últimos 3 días, no ocultos
  const hace3dias = new Date();
  hace3dias.setDate(hace3dias.getDate() - 3);
  hace3dias.setHours(0, 0, 0, 0);
  const historialVisible = historial.filter((h) => {
    if (h.oculta) return false;
    return new Date(h.finalizadaEn || h.cargadoEn || 0) >= hace3dias;
  });

  // ── Cargar CSV ──────────────────────────────────────────────
  function handleCSV(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const { info, productos } = parseDespachoCSV(ev.target.result);
        if (productos.length === 0) {
          toast("⚠️ No se encontraron productos en el CSV", "error");
          return;
        }
        const nuevo = {
          info,
          productos,
          operario,
          cargadoEn: new Date().toISOString(),
        };
        guardarDespacho(nuevo);
        api.post("recepcion_despacho", {
          info: nuevo.info,
          operario: nuevo.operario,
          productos: nuevo.productos,
          timestamp: new Date().toISOString(),
        });
        setTab("control");
        toast(
          `✅ ${productos.length} productos cargados · Carga ${info.nroCarga}`
        );
      } catch {
        toast("❌ Error al leer el CSV", "error");
      }
    };
    reader.readAsText(file, "latin1");
  }

  // ── Foto → IA detecta ───────────────────────────────────────
  // ── Foto → Apps Script → IA detecta ────────────────────────
  // REEMPLAZAR la función handleFoto en ModRecepcion
  async function handleFoto(e) {
    const file = e.target.files[0];
    if (!file || !despacho) return;
    setLoading(true);
    setLoadingMsg("Analizando imagen con IA...");
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        // Extraer base64 sin el prefijo "data:image/jpeg;base64,"
        const base64 = ev.target.result.split(",")[1];
        const mediaType = file.type || "image/jpeg";

        // Llamar al Apps Script proxy (no a Anthropic directamente)
        const res = await fetch(APPS_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo: "analizar_foto",
            data: { imageBase64: base64, mediaType },
          }),
          // SIN mode: "no-cors" — necesitamos leer la respuesta
        });

        const d = await res.json();

        if (d.status !== "ok" || !d.resultado) {
          throw new Error(d.mensaje || "Sin resultado de IA");
        }

        const iaResult = d.resultado;

        // Buscar match en productos del CSV
        const prods = despacho.productos || [];
        let matchIdx = null;
        let matchScore = 0;
        prods.forEach((p, i) => {
          let score = 0;
          if (iaResult.codigo && p.codigo) {
            const iaCod = iaResult.codigo.replace(/^0+/, "");
            const pCod = p.codigo.replace(/^0+/, "");
            if (iaCod === pCod) score += 3;
          }
          if (iaResult.ean && p.ean && iaResult.ean === p.ean) score += 2;
          if (score > matchScore) {
            matchScore = score;
            matchIdx = i;
          }
        });

        if (matchScore > 0 && matchIdx !== null) {
          // ✅ MATCH: guardar vencimiento automáticamente
          const prodsMod = [...prods];
          prodsMod[matchIdx] = {
            ...prodsMod[matchIdx],
            vencimiento: iaResult.vencimiento || prodsMod[matchIdx].vencimiento,
            fotoVerificada: true,
            _ts: Date.now(),
          };
          const actualizado = { ...despacho, productos: prodsMod };
          guardarDespacho(actualizado);
          clearTimeout(window._recepcionTimer);
          window._recepcionTimer = setTimeout(() => {
            api.post("recepcion_despacho", {
              info: actualizado.info,
              operario,
              productos: actualizado.productos,
              timestamp: new Date().toISOString(),
            });
          }, 1500);
          setFocusIdx(matchIdx);
          const prod = prods[matchIdx];
          const vencMsg = iaResult.vencimiento
            ? ` · Vence: ${iaResult.vencimiento}`
            : "";
          toast(`📷 ${prod.descripcion}${vencMsg} — ingresá la cantidad`);
        } else {
          // ❌ NO MATCH: panel para carga manual como extra
          setConfirmPanel({
            iaResult,
            matchIdx: null,
            cantReal: "",
            esExtra: true,
          });
        }
      } catch (err) {
        console.error("handleFoto error:", err);
        toast(
          "⚠️ No se pudo analizar la imagen. Podés cargarlo manual.",
          "error"
        );
        setConfirmPanel({
          iaResult: { codigo: "", ean: "", descripcion: "", vencimiento: "" },
          matchIdx: null,
          cantReal: "",
          esExtra: true,
          manualError: true,
        });
      } finally {
        setLoading(false);
        setLoadingMsg("");
      }
    };
    reader.readAsDataURL(file);
  }

  // ── Confirmar producto extra desde el panel ────────────────
  function confirmarProducto() {
    if (!confirmPanel || !despacho) return;
    const { iaResult, cantReal } = confirmPanel;
    const cant = parseInt(cantReal) || 0;
    const prods = [...(despacho.productos || [])];

    prods.push({
      id: `extra-${Date.now()}`,
      codigo: iaResult.codigo || "—",
      ean: iaResult.ean || "",
      descripcion: iaResult.descripcion || "Producto extra",
      cantEsperada: 0,
      cantReal: cant,
      unidad: "BULTOS",
      empresa: "",
      factura: "",
      estado: "extra",
      vencimiento: iaResult.vencimiento || "",
      fotoVerificada: true,
      esExtra: true,
      _ts: Date.now(),
    });

    const actualizado = { ...despacho, productos: prods };
    guardarDespacho(actualizado);
    setConfirmPanel(null);

    clearTimeout(window._recepcionTimer);
    window._recepcionTimer = setTimeout(() => {
      api.post("recepcion_despacho", {
        info: actualizado.info,
        operario,
        productos: actualizado.productos,
        timestamp: new Date().toISOString(),
      });
    }, 1500);

    toast("➕ Producto extra agregado");
  }

  // ── Editar cantidad manual desde la lista ──────────────────
  function setCantidad(idx, valor) {
    if (!despacho) return;
    const prods = [...despacho.productos];
    const prod = prods[idx];
    const cant = parseInt(valor) || 0;
    const estado =
      cant === prod.cantEsperada ? "ok" : cant > 0 ? "diferencia" : "pendiente";
    prods[idx] = { ...prod, cantReal: cant, estado, _ts: Date.now() };
    const actualizado = { ...despacho, productos: prods };
    guardarDespacho(actualizado);
    clearTimeout(window._recepcionTimer);
    window._recepcionTimer = setTimeout(() => {
      api.post("recepcion_despacho", {
        info: actualizado.info,
        operario,
        productos: actualizado.productos,
        timestamp: new Date().toISOString(),
      });
    }, 2000);
  }

  // ── Finalizar ───────────────────────────────────────────────
  function finalizarRecepcion() {
    if (!despacho) return;
    api.post("recepcion_despacho", {
      info: despacho.info,
      operario,
      productos: despacho.productos,
      timestamp: new Date().toISOString(),
    });
    const entrada = {
      ...despacho,
      finalizadaEn: new Date().toISOString(),
      id: despacho.info?.nroCarga || Date.now(),
      oculta: false,
    };
    guardarHistorial((prev) => {
      const sinDup = prev.filter(
        (h) => h.info?.nroCarga !== entrada.info?.nroCarga
      );
      return [entrada, ...sinDup];
    });
    guardarDespacho(null);
    setTab("resumen");
  }

  function ocultarRecepcion(nroCarga) {
    guardarHistorial((prev) =>
      prev.map((h) =>
        h.info?.nroCarga === nroCarga ? { ...h, oculta: true } : h
      )
    );
    toast("Recepción ocultada del listado");
  }

  // ════════════════════════════════════════════════════════════
  // RENDER — TAB CARGA
  // ════════════════════════════════════════════════════════════
  if (tab === "carga")
    return (
      <div style={BS}>
        <div style={card()}>
          <div style={secTit}>📦 RECEPCIÓN DE MERCADERÍA</div>

          {/* Indicador sync */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "12px",
            }}
          >
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: syncOk ? C.green : C.muted,
              }}
            />
            <span style={{ fontSize: "10px", color: C.muted }}>
              {syncOk ? `Sincronizado ${lastSync}` : "Conectando..."}
            </span>
          </div>

          <div style={{ marginBottom: "12px" }}>
            <label style={lbl}>Operario que recepciona</label>
            <select
              style={inp}
              value={operario}
              onChange={(e) => setOperario(e.target.value)}
            >
              <option value="">— Seleccionar —</option>
              {operarios.map((op) => (
                <option key={op.id} value={op.nombre}>
                  {op.nombre}
                </option>
              ))}
            </select>
          </div>

          <label
            style={{
              ...btn({
                background: `linear-gradient(135deg,${C.accent},#5b21b6)`,
                color: "#fff",
                width: "100%",
                fontSize: "14px",
                padding: "14px",
              }),
              cursor: "pointer",
            }}
          >
            📂 Cargar CSV de Despacho
            <input
              type="file"
              accept=".csv,.txt"
              style={{ display: "none" }}
              onChange={handleCSV}
            />
          </label>
          <p
            style={{
              fontSize: "11px",
              color: C.muted,
              marginTop: "10px",
              lineHeight: 1.5,
            }}
          >
            Cargá el archivo CSV de Arcor. El sistema extrae todos los productos
            automáticamente.
          </p>
        </div>

        {despacho && (
          <div style={card({ borderColor: C.green })}>
            <div style={secTit}>📋 DESPACHO EN CURSO</div>
            <div style={{ fontSize: "13px", marginBottom: "4px" }}>
              <strong>Nro. Carga:</strong> {despacho.info.nroCarga} ·{" "}
              <strong>Fecha:</strong> {despacho.info.fecha}
            </div>
            <div
              style={{ fontSize: "12px", color: C.muted, marginBottom: "8px" }}
            >
              Chofer: {despacho.info.chofer} · Pallets: {despacho.info.pallets}
            </div>
            {(() => {
              const total = (despacho.productos || []).length;
              const verificados = (despacho.productos || []).filter(
                (p) => p.fotoVerificada || p.cantReal !== null
              ).length;
              return (
                <div style={{ marginBottom: "10px" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "11px",
                      color: C.muted,
                      marginBottom: "4px",
                    }}
                  >
                    <span>Progreso</span>
                    <span>
                      {verificados}/{total}
                    </span>
                  </div>
                  <div
                    style={{
                      height: "4px",
                      background: C.bord,
                      borderRadius: "2px",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${
                          total > 0 ? (verificados / total) * 100 : 0
                        }%`,
                        background: C.green,
                        borderRadius: "2px",
                        transition: "width .3s",
                      }}
                    />
                  </div>
                </div>
              );
            })()}
            <button
              style={btn({
                background: C.green,
                color: "#0a0c10",
                fontWeight: 700,
                width: "100%",
              })}
              onClick={() => setTab("control")}
            >
              → Continuar control
            </button>
          </div>
        )}

        {historialVisible.length > 0 && (
          <div style={card()}>
            <div style={secTit}>🗂 ÚLTIMAS RECEPCIONES (3 días)</div>
            {historialVisible.map((h) => {
              const ok = (h.productos || []).filter(
                (p) => p.estado === "ok"
              ).length;
              const diff = (h.productos || []).filter(
                (p) => p.estado === "diferencia"
              ).length;
              const total = (h.productos || []).length;
              const fechaStr = h.finalizadaEn
                ? new Date(h.finalizadaEn).toLocaleDateString("es-AR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—";
              return (
                <div
                  key={h.info?.nroCarga || h.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px 0",
                    borderBottom: `1px solid ${C.bord}`,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: "13px" }}>
                      Carga #{h.info?.nroCarga}
                    </div>
                    <div style={{ fontSize: "11px", color: C.muted }}>
                      {fechaStr} · {h.operario || "—"}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: "6px",
                        marginTop: "4px",
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={pill(C.green)}>{ok} OK</span>
                      {diff > 0 && (
                        <span style={pill(C.orange)}>{diff} difer.</span>
                      )}
                      <span style={pill(C.muted)}>{total} total</span>
                    </div>
                  </div>
                  <button
                    style={btn({
                      background: "transparent",
                      color: C.red,
                      border: `1px solid ${C.bord}`,
                      padding: "6px 10px",
                      fontSize: "12px",
                    })}
                    title="Ocultar (los datos se conservan para métricas)"
                    onClick={() => {
                      if (
                        window.confirm(
                          `¿Ocultar Carga #${h.info?.nroCarga}? Los datos se conservan para métricas.`
                        )
                      )
                        ocultarRecepcion(h.info?.nroCarga);
                    }}
                  >
                    🗑
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );

  // ════════════════════════════════════════════════════════════
  // RENDER — TAB CONTROL
  // ════════════════════════════════════════════════════════════
  if (tab === "control" && despacho) {
    const prods = despacho.productos || [];
    const total = prods.length;
    const ok = prods.filter((p) => p.estado === "ok").length;
    const diff = prods.filter((p) => p.estado === "diferencia").length;
    const pend = prods.filter((p) => p.estado === "pendiente").length;
    const extra = prods.filter((p) => p.estado === "extra").length;
    const pct = total > 0 ? Math.round(((ok + diff + extra) / total) * 100) : 0;
    const empresas = [...new Set(prods.map((p) => p.empresa || "EXTRA"))];

    return (
      <div style={BS}>
        {/* Spinner de carga IA */}
        {loading && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,.8)",
              zIndex: 2000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div
              style={{
                width: "52px",
                height: "52px",
                border: `4px solid ${C.accent}`,
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
            <div style={{ color: "#fff", fontSize: "14px" }}>{loadingMsg}</div>
          </div>
        )}

        {/* Panel — SOLO para productos no encontrados en CSV */}
        {confirmPanel && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,.85)",
              zIndex: 1500,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                ...card({ borderColor: C.orange }),
                width: "100%",
                maxWidth: "500px",
                borderRadius: "16px 16px 0 0",
                padding: "20px",
                maxHeight: "90vh",
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "14px",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: "15px" }}>
                  ⚠️ Producto no encontrado en CSV
                </div>
                <button
                  style={btn({
                    background: C.surf2,
                    color: C.muted,
                    padding: "4px 10px",
                    fontSize: "12px",
                  })}
                  onClick={() => setConfirmPanel(null)}
                >
                  ✕
                </button>
              </div>

              {/* Lo que detectó la IA */}
              <div
                style={{
                  background: C.surf2,
                  borderRadius: "8px",
                  padding: "12px",
                  marginBottom: "14px",
                }}
              >
                <div
                  style={{
                    fontSize: "10px",
                    color: C.blue,
                    fontWeight: 700,
                    letterSpacing: "1px",
                    marginBottom: "8px",
                  }}
                >
                  📷 DETECTADO POR IA
                </div>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    marginBottom: "4px",
                  }}
                >
                  {confirmPanel.iaResult.descripcion || "—"}
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {confirmPanel.iaResult.codigo && (
                    <span style={pill(C.blue)}>
                      Cód: {confirmPanel.iaResult.codigo}
                    </span>
                  )}
                  {confirmPanel.iaResult.vencimiento &&
                    (() => {
                      const st = vencSt(confirmPanel.iaResult.vencimiento);
                      return (
                        <span style={pill(st.c)}>
                          Vence: {confirmPanel.iaResult.vencimiento} · {st.l}
                        </span>
                      );
                    })()}
                </div>
              </div>

              {/* Campos editables */}
              <div
                style={{
                  background: "rgba(255,140,66,.08)",
                  border: `1px solid ${C.orange}40`,
                  borderRadius: "8px",
                  padding: "12px",
                  marginBottom: "14px",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    color: C.orange,
                    marginBottom: "10px",
                  }}
                >
                  Se va a guardar como <strong>producto extra</strong>. Editá
                  los datos si es necesario.
                </div>
                <label style={lbl}>Descripción</label>
                <input
                  style={{ ...inp, marginBottom: "6px" }}
                  value={confirmPanel.iaResult.descripcion || ""}
                  onChange={(e) =>
                    setConfirmPanel((p) => ({
                      ...p,
                      iaResult: { ...p.iaResult, descripcion: e.target.value },
                    }))
                  }
                  placeholder="Nombre del producto"
                />
                <label style={lbl}>Código interno</label>
                <input
                  style={{ ...inp, marginBottom: "6px" }}
                  value={confirmPanel.iaResult.codigo || ""}
                  onChange={(e) =>
                    setConfirmPanel((p) => ({
                      ...p,
                      iaResult: { ...p.iaResult, codigo: e.target.value },
                    }))
                  }
                  placeholder="Ej: 14361"
                />
                <label style={lbl}>Fecha vencimiento</label>
                <input
                  style={inp}
                  type="date"
                  value={confirmPanel.iaResult.vencimiento || ""}
                  onChange={(e) =>
                    setConfirmPanel((p) => ({
                      ...p,
                      iaResult: { ...p.iaResult, vencimiento: e.target.value },
                    }))
                  }
                />
              </div>

              {/* Cantidad */}
              <div style={{ marginBottom: "16px" }}>
                <label style={{ ...lbl, fontSize: "12px" }}>
                  Cantidad de bultos
                </label>
                <input
                  type="number"
                  style={{
                    ...inp,
                    fontSize: "28px",
                    fontWeight: 900,
                    textAlign: "center",
                    padding: "14px",
                    borderColor: C.orange,
                  }}
                  placeholder="0"
                  value={confirmPanel.cantReal}
                  onChange={(e) =>
                    setConfirmPanel((p) => ({ ...p, cantReal: e.target.value }))
                  }
                  autoFocus
                />
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  style={btn({
                    background: "transparent",
                    color: C.muted,
                    border: `1px solid ${C.bord}`,
                    flex: 1,
                  })}
                  onClick={() => setConfirmPanel(null)}
                >
                  Cancelar
                </button>
                <button
                  style={btn({
                    background: `linear-gradient(135deg,${C.orange},#e67e22)`,
                    color: "#fff",
                    fontWeight: 700,
                    flex: 2,
                    fontSize: "14px",
                  })}
                  onClick={confirmarProducto}
                >
                  ➕ Guardar como extra
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header stats */}
        <div style={card({ padding: "12px 14px" })}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "8px",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: "15px" }}>
              Carga #{despacho.info.nroCarga}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "11px", color: C.muted }}>
                {despacho.info.fecha}
              </span>
              <div
                style={{
                  width: "7px",
                  height: "7px",
                  borderRadius: "50%",
                  background: syncOk ? C.green : C.muted,
                }}
                title={syncOk ? `Sync ${lastSync}` : "Sin sync"}
              />
            </div>
          </div>
          <div
            style={{
              height: "6px",
              background: C.bord,
              borderRadius: "3px",
              marginBottom: "8px",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                background: `linear-gradient(90deg,${C.green},${C.blue})`,
                borderRadius: "3px",
                transition: "width .3s",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <span style={pill(C.muted)}>⏳ {pend} pendientes</span>
            <span style={pill(C.green)}>✓ {ok} OK</span>
            {diff > 0 && (
              <span style={pill(C.orange)}>⚠ {diff} diferencias</span>
            )}
            {extra > 0 && <span style={pill(C.blue)}>➕ {extra} extras</span>}
          </div>
        </div>

        {/* Botón foto global — captura nueva foto para detectar producto */}
        <label
          style={{
            ...btn({
              background: `linear-gradient(135deg,${C.accent},#5b21b6)`,
              color: "#fff",
              width: "100%",
              fontSize: "15px",
              padding: "16px",
            }),
            cursor: "pointer",
          }}
        >
          📷 FOTOGRAFIAR PRODUCTO
          <input
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={handleFoto}
          />
        </label>

        {/* Lista de productos por empresa */}
        {empresas.map((empresa) => {
          const prodsEmp = prods.filter(
            (p) => (p.empresa || "EXTRA") === empresa
          );
          return (
            <div key={empresa} style={card()}>
              <div
                style={{
                  ...secTit,
                  color: empresa === "EXTRA" ? C.blue : C.gold,
                }}
              >
                {empresa === "EXTRA" ? "➕ PRODUCTOS EXTRA" : empresa} —{" "}
                {prodsEmp.length} productos
              </div>
              {prodsEmp.map((prod) => {
                const idx = prods.indexOf(prod);
                const esOk = prod.estado === "ok";
                const esDiff = prod.estado === "diferencia";
                const esPend = prod.estado === "pendiente";
                const esExtra = prod.estado === "extra";
                const isFocused = focusIdx === idx;
                const borderColor = isFocused
                  ? C.accent
                  : esOk
                  ? C.green
                  : esDiff
                  ? C.orange
                  : esExtra
                  ? C.blue
                  : C.bord;

                return (
                  <div
                    key={prod.id}
                    ref={isFocused ? focusRef : null}
                    style={{
                      borderLeft: `3px solid ${borderColor}`,
                      paddingLeft: "10px",
                      marginBottom: "12px",
                      paddingBottom: "10px",
                      borderBottom: `1px solid ${C.bord}`,
                      background: isFocused ? `${C.accent}12` : "transparent",
                      borderRadius: isFocused ? "0 8px 8px 0" : undefined,
                      transition: "background .4s",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: "6px",
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: "13px",
                            lineHeight: 1.3,
                          }}
                        >
                          {prod.descripcion}
                        </div>
                        <div
                          style={{
                            fontSize: "10px",
                            color: C.muted,
                            marginTop: "2px",
                          }}
                        >
                          Cód: {prod.codigo}
                          {prod.factura ? ` · Fact: ${prod.factura}` : ""}
                          {prod.fotoVerificada && (
                            <span style={{ color: C.green, marginLeft: "6px" }}>
                              📷✓
                            </span>
                          )}
                        </div>
                        {prod.vencimiento &&
                          (() => {
                            const st = vencSt(prod.vencimiento);
                            return (
                              <span
                                style={{
                                  ...pill(st.c),
                                  marginTop: "4px",
                                  display: "inline-flex",
                                  fontSize: "9px",
                                }}
                              >
                                Vence {prod.vencimiento} · {st.l}
                              </span>
                            );
                          })()}
                      </div>
                      <div
                        style={{
                          textAlign: "right",
                          flexShrink: 0,
                          marginLeft: "8px",
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: "16px" }}>
                          {esExtra ? "—" : prod.cantEsperada}
                        </div>
                        <div style={{ fontSize: "9px", color: C.muted }}>
                          {prod.unidad}
                        </div>
                      </div>
                    </div>

                    {/* Input cantidad manual */}
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <input
                          type="number"
                          style={{
                            ...inp,
                            fontSize: "18px",
                            fontWeight: 700,
                            textAlign: "center",
                            borderColor: esOk
                              ? C.green
                              : esDiff
                              ? C.orange
                              : C.bord,
                            color: esOk ? C.green : esDiff ? C.orange : C.text,
                          }}
                          placeholder={
                            esExtra ? "Cantidad" : `Esp: ${prod.cantEsperada}`
                          }
                          value={prod.cantReal ?? ""}
                          onChange={(e) => setCantidad(idx, e.target.value)}
                        />
                      </div>
                      <div style={{ fontSize: "24px", flexShrink: 0 }}>
                        {esOk && "✅"}
                        {esDiff && "⚠️"}
                        {esExtra && "➕"}
                        {esPend && <span style={{ color: C.muted }}>○</span>}
                      </div>
                    </div>

                    {esDiff && prod.cantReal !== null && (
                      <div
                        style={{
                          marginTop: "6px",
                          padding: "4px 8px",
                          background: "rgba(255,140,66,.15)",
                          borderRadius: "6px",
                          fontSize: "11px",
                          color: C.orange,
                          fontWeight: 600,
                        }}
                      >
                        ⚠ Diferencia: esperado {prod.cantEsperada} · recibido{" "}
                        {prod.cantReal}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Botones finales */}
        <div style={card()}>
          <button
            style={btn({
              background: `linear-gradient(135deg,${C.green},#059669)`,
              color: "#0a0c10",
              fontWeight: 700,
              width: "100%",
              fontSize: "14px",
              padding: "14px",
              marginBottom: "8px",
            })}
            onClick={finalizarRecepcion}
          >
            ✓ FINALIZAR Y ENVIAR AL SHEET
          </button>
          <button
            style={btn({
              background: "transparent",
              color: C.muted,
              border: `1px solid ${C.bord}`,
              width: "100%",
            })}
            onClick={() => setTab("carga")}
          >
            ← Volver
          </button>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // RENDER — RESUMEN POST-FINALIZACIÓN
  // ════════════════════════════════════════════════════════════
  if (tab === "resumen") {
    const ultima = historial[0];
    if (!ultima) {
      setTab("carga");
      return null;
    }
    const ok = (ultima.productos || []).filter((p) => p.estado === "ok");
    const diff = (ultima.productos || []).filter(
      (p) => p.estado === "diferencia"
    );
    const extra = (ultima.productos || []).filter((p) => p.estado === "extra");
    const pend = (ultima.productos || []).filter(
      (p) => p.estado === "pendiente"
    );

    return (
      <div style={BS}>
        <div
          style={card({
            borderColor: C.green,
            textAlign: "center",
            padding: "24px",
          })}
        >
          <div style={{ fontSize: "48px", marginBottom: "8px" }}>✅</div>
          <div style={{ fontSize: "18px", fontWeight: 900, color: C.green }}>
            Recepción completada
          </div>
          <div style={{ fontSize: "12px", color: C.muted, marginTop: "4px" }}>
            Carga #{ultima.info?.nroCarga}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: "6px",
          }}
        >
          {[
            [ok.length, "✓ OK", C.green],
            [diff.length, "⚠ Difer.", C.orange],
            [extra.length, "➕ Extra", C.blue],
            [pend.length, "⏳ Pend.", C.muted],
          ].map(([v, l, c]) => (
            <div key={l} style={card({ padding: "10px", textAlign: "center" })}>
              <div style={{ fontSize: "22px", fontWeight: 900, color: c }}>
                {v}
              </div>
              <div style={{ fontSize: "9px", color: C.muted }}>{l}</div>
            </div>
          ))}
        </div>

        {diff.length > 0 && (
          <div style={card({ borderColor: C.orange })}>
            <div style={secTit}>⚠️ DIFERENCIAS</div>
            {diff.map((p) => (
              <div
                key={p.id}
                style={{
                  padding: "8px 0",
                  borderBottom: `1px solid ${C.bord}`,
                  fontSize: "12px",
                }}
              >
                <div style={{ fontWeight: 600 }}>{p.descripcion}</div>
                <div style={{ color: C.orange }}>
                  Esperado: {p.cantEsperada} · Recibido: {p.cantReal}
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          style={btn({
            background: C.accent,
            color: "#fff",
            fontWeight: 700,
            width: "100%",
            fontSize: "14px",
            padding: "14px",
          })}
          onClick={() => setTab("carga")}
        >
          + Nueva recepción
        </button>
      </div>
    );
  }

  // Fallback
  return (
    <div style={BS}>
      <div style={{ textAlign: "center", color: C.muted, padding: "40px" }}>
        Cargá un CSV de despacho para empezar.
        <br />
        <button
          style={btn({
            background: C.accent,
            color: "#fff",
            marginTop: "12px",
          })}
          onClick={() => setTab("carga")}
        >
          → Ir a carga
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MÓDULO ARMADO — Carga XLS + número automático + imprimir
// ═══════════════════════════════════════════════════════════════
function ModArmado({ toast, operarios, cons, setCons }) {
  const [screen, setScr] = useState("list");
  const [currentId, setCId] = useState(null);
  const [fNum, sfn] = useState("");
  const [fPrefijo, sfp] = useState("");
  const [fFecha, sff] = useState(todayStr());
  const [fHoraInicio, sfh] = useState(nowTime());
  const [fOps, sfo] = useState([]);
  const [fCtrl, sfc] = useState("");
  const [fDivisiones, setFDivisiones] = useState({});
  const [armarOpId, setArmarOpId] = useState(null); // operario seleccionado para armar

  const [xlsData, setXLS] = useState({
    sections: [],
    numero: "",
    fecha: "",
    prefijo: "",
  });

  const [fileName, setFN] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const xlsCargado = xlsData.sections.length > 0;

  // ── Leer XLS real con librería XLSX ────────────────────────
  function handleXLS(e) {
    const file = e.target.files[0];
    if (!file) return;
    setFN(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        console.log(
          "CELDAS:",
          "A1=",
          sheet["A1"]?.v,
          "B1=",
          sheet["B1"]?.v,
          "D1=",
          sheet["D1"]?.v
        );
        const csv = XLSX.utils.sheet_to_csv(sheet);
        // LOG TEMPORAL - borrar después
        const csvLines = csv.split("\n");
        const menthoLines = csvLines.filter(
          (l) => l.includes("MENTHO") || l.includes("10130")
        );
        console.log("CSV MENTHO:", menthoLines);
        const sinPasillo = csvLines.filter((l, i) => {
          if (i < 5) return false;
          const cols = l.split(",");
          return cols[0] === "" && cols[1] && /^\d/.test(cols[1]);
        });
        console.log("SIN PASILLO primeros 3:", sinPasillo.slice(0, 3));
        let prefijo = "",
          numero = "";
        try {
          const raw = evt.target.result;
          const bytes = new Uint8Array(raw);
          const rosarc = [0x52, 0x6f, 0x73, 0x2d, 0x41, 0x72, 0x43];
          let encontrado = false;

          // Buscar "Ros-ArC" en binario para prefijos 13/46/78/91/99/HEL
          for (let i = 0; i < bytes.length - 300; i++) {
            if (rosarc.every((b, j) => bytes[i + j] === b)) {
              encontrado = true;
              // Buscar prefijo: patrón 01 00 1d 00 XX 00 [string]
              for (let j = i; j < Math.min(i + 300, bytes.length - 10); j++) {
                if (
                  bytes[j] === 0x01 &&
                  bytes[j + 1] === 0x00 &&
                  bytes[j + 2] === 0x1d &&
                  bytes[j + 3] === 0x00
                ) {
                  const strLen = bytes[j + 4];
                  if (strLen > 0 && strLen <= 5) {
                    let s = "";
                    for (let k = 0; k < strLen; k++)
                      s += String.fromCharCode(bytes[j + 6 + k]);
                    if (s.trim()) {
                      prefijo = s.trim();
                      break;
                    }
                  }
                }
              }
              // Buscar número: patrón 03 02 0e 00 00 00 03 00 1e 00 [8 bytes double]
              for (let j = i; j < Math.min(i + 300, bytes.length - 20); j++) {
                if (
                  bytes[j] === 0x03 &&
                  bytes[j + 1] === 0x02 &&
                  bytes[j + 2] === 0x0e &&
                  bytes[j + 3] === 0x00 &&
                  bytes[j + 4] === 0x00 &&
                  bytes[j + 5] === 0x00 &&
                  bytes[j + 6] === 0x03 &&
                  bytes[j + 7] === 0x00 &&
                  bytes[j + 8] === 0x1e &&
                  bytes[j + 9] === 0x00
                ) {
                  const view = new DataView(raw, j + 10, 8);
                  const num = Math.round(view.getFloat64(0, true));
                  if (num > 10000 && num < 999999) {
                    numero = String(num);
                    break;
                  }
                }
              }
              break;
            }
          }

          // Fallback T2/T3/T4 si no encontró Ros-ArC
          if (!encontrado || !numero || !prefijo) {
            for (let i = 0; i < bytes.length - 2; i++) {
              if (
                bytes[i] === 0x54 &&
                (bytes[i + 1] === 0x32 ||
                  bytes[i + 1] === 0x33 ||
                  bytes[i + 1] === 0x34) &&
                bytes[i + 2] === 0x04
              ) {
                if (!prefijo)
                  prefijo = String.fromCharCode(bytes[i], bytes[i + 1]);
                if (!numero) {
                  const view = new DataView(raw, i + 32, 8);
                  const num = Math.round(view.getFloat64(0, true));
                  if (num > 1000 && num < 9999999) numero = String(num);
                }
                break;
              }
            }
          }
        } catch (e) {}

        const { sections, fecha } = parseXLS(csv);
        if (sections.length > 0) {
          const xlsDate = fecha || todayStr();
          setXLS({ sections, numero, fecha: xlsDate, prefijo });
          sfn(numero);
          sfp(prefijo);
          if (fecha) sff(xlsDate);
          const total = sections.reduce((a, s) => a + s.products.length, 0);
          const tag = prefijo && numero ? `${prefijo}-${numero}` : numero;
          toast(
            tag
              ? `✅ ${file.name} — ${total} productos · ${tag}`
              : `✅ ${file.name} — ${total} productos · Ingresá el número`
          );
        } else {
          toast(
            "⚠️ No se encontraron productos. Verificá el archivo.",
            "error"
          );
          setXLS({ sections: [], numero: "", fecha: "", prefijo: "" });
          sfn("");
          sfp("");
        }
      } catch (err) {
        console.error(err);
        toast("❌ Error al leer el archivo", "error");
        setXLS({ sections: [], numero: "", fecha: "", prefijo: "" });
        sfn("");
        sfp("");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  const totalPiq = (xlsData.sections || []).reduce(
    (a, s) => a + s.products.length,
    0
  );

  function crear() {
    if (!xlsCargado) {
      toast("⚠️ Primero cargá el archivo XLS", "error");
      return;
    }
    if (!fNum) {
      toast("⚠️ Ingresá el número de consolidado", "error");
      return;
    }
    if (fOps.length === 0) {
      toast("⚠️ Seleccioná al menos 1 operario", "error");
      return;
    }
    const todasAsignadas = xlsData.sections.every((sec) =>
      fOps.some((id) => (fDivisiones[id] || []).includes(sec.name))
    );
    if (!todasAsignadas) {
      toast("⚠️ Asigná todas las divisiones antes de continuar", "error");
      return;
    }
    const now = Date.now();
    const lines = xlsData.sections.flatMap((sec) =>
      sec.products.map((p) => ({
        ...p,
        id: `${sec.name.replace(/\s/g, "")}-${p.id}`,
        seccion: sec.name,
        estado: null,
        motivo: null,
        operario: null,
        ts: null,
      }))
    );
    const numeroCompleto = fPrefijo ? `${fPrefijo}-${fNum}` : fNum;
    const c = {
      id: now,
      numero: numeroCompleto,
      prefijo: fPrefijo,
      fecha: fFecha,
      horaInicio: fHoraInicio,
      controlador: fCtrl,
      piqueos: totalPiq,
      activeOps: fOps.map((id) => {
        const op = operarios.find((o) => o.id === id);
        const divs = fDivisiones[id] || [];
        const piqueos =
          divs.length > 0
            ? xlsData.sections
                .filter((s) => divs.includes(s.name))
                .reduce((a, s) => a + s.products.length, 0)
            : Math.round(totalPiq / Math.max(fOps.length, 1));
        return {
          ...op,
          startTime: now,
          endTime: null,
          finished: false,
          divisiones: divs,
          piqueos,
        };
      }),
      startTime: now,
      finished: false,
      totalTime: null,
      lines,
    };
    setCons((cs) => [...cs, c]);
    setCId(now);
    setScr("print");
    // Enviar al Sheet en segundo plano
    api.post("crear_consolidado", { ...c, id: String(now) });
  }

  // ── Finalizar operario individual ──────────────────────────
  function finalizarOp(consId, opId) {
    const now = Date.now();
    const c = cons.find((x) => x.id === consId);
    const op = c?.activeOps.find((o) => o.id === opId);
    const startTs = Number(op?.startTime || c?.startTime || 0);
const duracionMin = startTs > 0 ? Math.round((now - startTs) / 60000) : 0;
const divOp = op?.divisiones || [];
const lineasOp = divOp.length > 0
  ? (c?.lines || []).filter((l) => divOp.includes(l.seccion))
  : (c?.lines || []);
  const piqueos = lineasOp.filter(l => l.estado === "armado" && l.operario === op?.nombre).length
  || lineasOp.filter(l => l.estado === "armado").length
  || lineasOp.length;

    setCons((cs) =>
      cs.map((x) =>
        x.id !== consId
          ? x
          : {
              ...x,
              activeOps: x.activeOps.map((o) =>
                o.id === opId && !o.finished
                  ? { ...o, endTime: now, finished: true }
                  : o
              ),
            }
      )
    );

    if (op) {
      toast(`✅ ${op.nombre} finalizó · ${duracionMin}min · ${piqueos} piq`);
      api.post("finalizar_operario", {
        consId: String(consId),
        numero: c?.numero,
        fecha: c?.fecha,
        nombre: op.nombre,
        codigo: op.codigo || "",
        // DESPUÉS:
horaInicio: startTs > 0 ? fHora(startTs) : fHora(Number(c?.startTime || 0)),
        horaFin: fHora(now),
        startTime: startTs,
        endTime: now,
        duracion: duracionMin,
        piqueos,
        divisiones: (op.divisiones || []).join(", "),
      });
    }
  }

  if (screen === "print") {
    const c = cons.find((x) => x.id === currentId);
    return (
      <div
        style={{
          background: "#e8e8e8",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <style>{`
          @media print {
            .no-print { display: none !important; }
            .op-bloque { page-break-before: always !important; break-before: page !important; }
            .op-bloque-first { page-break-before: auto !important; break-before: auto !important; }
          }
        `}</style>
        <div
          className="no-print"
          style={{
            background: C.surf,
            padding: "10px 18px",
            display: "flex",
            gap: "8px",
            alignItems: "center",
            borderBottom: `1px solid ${C.bord}`,
          }}
        >
          <button
            style={btn({
              background: C.red,
              color: "#fff",
              fontSize: "13px",
              padding: "9px 16px",
            })}
            onClick={() => window.print()}
          >
            🖨 Imprimir Consolidado
          </button>
          <span style={{ fontSize: "11px", color: C.muted }}>
            {totalPiq} líneas · A4
          </span>
          <button
            style={btn({
              background: "transparent",
              color: C.muted,
              border: `1px solid ${C.bord}`,
              marginLeft: "auto",
              fontSize: "12px",
            })}
            onClick={() => setScr("list")}
          >
            ← Volver al listado
          </button>
        </div>
        <div style={{ padding: "18px", overflowY: "auto", flex: 1 }}>
          <PrintDoc cons={c} />
        </div>
      </div>
    );
  }
  if (screen === "armar_movil") {
    const c = cons.find((x) => x.id === currentId);
    if (!c) return null;

    // Si no eligió operario todavía → mostrar selector
    if (!armarOpId) {
      return (
        <div style={BS}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <button
              style={btn({ background: "transparent", color: C.muted, border: `1px solid ${C.bord}`, padding: "6px 12px" })}
              onClick={() => setScr("list")}
            >
              ← Volver
            </button>
            <div>
              <div style={{ fontWeight: 700, fontSize: "15px" }}>#{c.numero}</div>
              <div style={{ fontSize: "11px", color: C.muted }}>{c.fecha}</div>
            </div>
          </div>

          <div style={card({ borderColor: C.accent })}>
            <div style={secTit}>👷 ¿QUIÉN SOS?</div>
            <p style={{ fontSize: "12px", color: C.muted, marginBottom: "12px" }}>
              Elegí tu nombre para ver tus productos asignados.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {c.activeOps.map((op) => (
                <button
                  key={op.id}
                  style={btn({
                    background: op.finished ? C.surf2 : `${op.color}18`,
                    color: op.finished ? C.muted : op.color,
                    border: `2px solid ${op.finished ? C.bord : op.color}`,
                    fontSize: "15px",
                    padding: "14px",
                    justifyContent: "flex-start",
                    gap: "12px",
                    opacity: op.finished ? 0.5 : 1,
                  })}
                  onClick={() => {
                    if (!op.finished) {
                      // Registrar hora de inicio del operario en este dispositivo
                      setCons((cs) => cs.map((x) => {
                        if (x.id !== currentId) return x;
                        return {
                          ...x,
                          activeOps: x.activeOps.map((o) =>
                            // DESPUÉS:
o.id === op.id && (!o.startTime || o.startTime === c.startTime)
                              ? { ...o, startTime: Date.now() }
                              : o
                          ),
                        };
                      }));
                      setArmarOpId(op.id);
                    }
                  }}
                >
                  <div style={{
                    width: "36px", height: "36px", borderRadius: "50%",
                    background: op.color, display: "flex", alignItems: "center",
                    justifyContent: "center", fontSize: "16px", fontWeight: 700,
                    color: "#fff", flexShrink: 0,
                  }}>
                    {op.nombre.charAt(0)}
                  </div>
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: 700 }}>{op.nombre}</div>
                    <div style={{ fontSize: "11px", opacity: 0.7 }}>
                      {op.finished ? "✅ Ya finalizó" : `${(op.divisiones || []).join(" · ") || "Todas las divisiones"}`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    // Operario seleccionado → mostrar sus productos
    const op = c.activeOps.find((o) => o.id === armarOpId);
    if (!op) return null;

    const divOp = op.divisiones || [];
    const lineasOp = divOp.length > 0
      ? c.lines.filter((l) => divOp.includes(l.seccion))
      : c.lines;

    const marcadas = lineasOp.filter((l) => l.estado === "armado").length;
    const total = lineasOp.length;
    const pct = total > 0 ? Math.round((marcadas / total) * 100) : 0;
    const todasListas = marcadas === total;

    const secciones = [...new Set(lineasOp.map((l) => l.seccion))];

    function marcarLinea(lineId) {
      setCons((cs) => cs.map((x) => {
        if (x.id !== currentId) return x;
        const line = x.lines.find((l) => l.id === lineId);
        const nuevoEstado = line?.estado === "armado" ? null : "armado";
        const nuevasLines = x.lines.map((l) =>
          l.id === lineId
            ? { ...l, estado: nuevoEstado, operario: op.nombre, ts: Date.now() }
            : l
        );
        if (line) {
          api.post("actualizar_linea", {
            consId: String(currentId),
            codigo: line.codigo,
            descripcion: line.descripcion,
            estado: nuevoEstado || "pendiente",
            motivo: "",
            operario: op.nombre,
          });
        }
        // Contar cuántos armados tiene el operario después del cambio
const piquesActuales = nuevasLines.filter(
  (l) => l.estado === "armado" && l.operario === op.nombre
).length;

return {
  ...x,
  lines: nuevasLines,
  activeOps: x.activeOps.map((o) =>
    o.id === armarOpId
      ? { ...o, piqueos: piquesActuales }
      : o
  ),
};
      }));
    }

    function finalizarMiParte() {
      finalizarOp(currentId, armarOpId);
      toast(`✅ ${op.nombre} finalizó su parte`);
      setArmarOpId(null);
      setScr("list");
    }
    
    function imprimirTicketFinal() {
      const fecha = new Date().toLocaleDateString("es-AR");
      const ahora = new Date().toLocaleTimeString("es-AR", { hour:"2-digit", minute:"2-digit" });
      const win = window.open("", "_blank", "width=420,height=320");
      if (win) {
        win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
        <style>
          * { margin:0; padding:0; box-sizing:border-box; }
          body { font-family: Arial, sans-serif; padding: 8mm; width: 105mm; }
          .logo { font-size: 16pt; font-weight: 900; color: #7c3aed; letter-spacing: 2px; }
          .linea { border-top: 1px dashed #ccc; margin: 5px 0; }
          .fila { display: flex; justify-content: space-between; font-size: 8pt; padding: 2px 0; }
          .fila span:first-child { color: #666; }
          .fila span:last-child { font-weight: 700; }
          .op { font-size: 16pt; font-weight: 900; color: #7c3aed; margin: 5px 0 1px; }
          .divs { font-size: 8pt; color: #444; margin-bottom: 4px; }
          .piq { font-size: 28pt; font-weight: 900; text-align: center; margin: 4px 0; }
          .piq-label { font-size: 7pt; text-align: center; color: #666; letter-spacing: 1px; text-transform: uppercase; }
          .firma { border-top: 1px solid #000; margin-top: 8mm; padding-top: 2mm; font-size: 7pt; color: #666; }
          .hora-fin { font-size: 7pt; color: #666; margin-top: 4px; }
          @media print { @page { size: A4; margin: 0; } }
        </style>
        </head><body>
          <div class="logo">ROS-ARC</div>
          <div style="font-size:7pt;color:#666;letter-spacing:2px;">TICKET DE ARMADO</div>
          <div style="font-size:20pt;font-weight:900;margin:3px 0;">#${c.numero}</div>
          <div class="linea"></div>
          <div class="fila"><span>Fecha</span><span>${fecha}</span></div>
          <div class="fila"><span>Hora fin</span><span>${ahora}</span></div>
          <div class="fila"><span>Total líneas</span><span>${lineasOp.length}</span></div>
          <div class="linea"></div>
          <div class="op">${op.nombre}</div>
          <div class="divs">${divOp.join(" · ") || "Todas las divisiones"}</div>
          <div class="piq">${lineasOp.filter(l => l.estado === "armado").length}</div>
          <div class="piq-label">piqueos marcados</div>
          <div class="linea"></div>
          <div class="firma">Firma: ___________________________</div>
          <div class="hora-fin">Hora fin: ____________</div>
        </body></html>`);
        win.document.close();
        setTimeout(() => { win.print(); }, 300);
      }
    }

    return (
      <div style={BS}>
        {/* Header */}
        <div style={card({ padding: "12px 14px" })}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
            <button
              style={btn({ background: "transparent", color: C.muted, border: `1px solid ${C.bord}`, padding: "5px 10px", fontSize: "12px" })}
              onClick={() => setArmarOpId(null)}
            >
              ← Cambiar
            </button>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: "14px" }}>#{c.numero} · {op.nombre}</div>
              <div style={{ fontSize: "11px", color: C.muted }}>
                {divOp.join(" · ") || "Todas las divisiones"}
              </div>
            </div>
            <div style={{
              width: "44px", height: "44px", borderRadius: "50%",
              background: op.color, display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: "18px", fontWeight: 700, color: "#fff",
            }}>
              {op.nombre.charAt(0)}
            </div>
          </div>

          {/* Barra de progreso */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: C.muted, marginBottom: "4px" }}>
            <span>Progreso</span>
            <span style={{ fontWeight: 700, color: todasListas ? C.green : C.text }}>{marcadas}/{total}</span>
          </div>
          <div style={{ height: "8px", background: C.bord, borderRadius: "4px" }}>
            <div style={{
              height: "100%",
              width: `${pct}%`,
              background: todasListas ? C.green : `linear-gradient(90deg,${op.color},${C.blue})`,
              borderRadius: "4px",
              transition: "width .3s",
            }} />
          </div>
        </div>

        {/* Productos por sección */}
        {secciones.map((sec) => {
          const prods = lineasOp.filter((l) => l.seccion === sec);
          const secOk = prods.filter((l) => l.estado === "ok").length;
          return (
            <div key={sec} style={card()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <span style={{ ...secTit, marginBottom: 0, paddingBottom: 0, borderBottom: "none", color: op.color }}>
                  {sec}
                </span>
                <span style={pill(secOk === prods.length ? C.green : C.muted)}>
                  {secOk}/{prods.length}
                </span>
              </div>

              {prods.map((p) => {
                const esOk = p.estado === "armado";
                return (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "11px 0",
                      borderBottom: `1px solid ${C.bord}`,
                      opacity: esOk ? 0.5 : 1,
                      transition: "opacity .2s",
                    }}
                  >
                    {/* Pasillo */}
                    <div style={{
                      width: "32px", height: "32px", borderRadius: "6px",
                      background: C.surf2, display: "flex", alignItems: "center",
                      justifyContent: "center", fontSize: "10px", fontWeight: 700,
                      color: C.muted, flexShrink: 0,
                    }}>
                      {p.pasillo || "—"}
                    </div>

                    {/* Info producto */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: "13px", fontWeight: 600, lineHeight: 1.3,
                        textDecoration: esOk ? "line-through" : "none",
                        color: esOk ? C.muted : C.text,
                      }}>
                        {p.descripcion}
                      </div>
                      <div style={{ fontSize: "10px", color: C.muted, marginTop: "2px" }}>
                        {p.codigo}
{p.unit === "BU" && p.bu !== "0"
  ? ` · ${p.qty} BU · ${p.bu} UN`
  : p.unit === "BU"
  ? ` · ${p.qty} BU`
  : ` · ${p.qty} ${p.unit}`}
                      </div>
                    </div>

                    {/* Cantidad grande */}
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                    {p.unit === "BU" ? (
  <div style={{ textAlign: "right" }}>
    <div style={{ fontSize: "26px", fontWeight: 900, color: esOk ? C.green : C.orange, lineHeight: 1 }}>
      {p.qty}
    </div>
    <div style={{ fontSize: "10px", fontWeight: 700, color: esOk ? C.green : C.orange }}>BU</div>
    {p.bu !== "0" && (
      <>
        <div style={{ fontSize: "18px", fontWeight: 700, color: esOk ? C.green : C.text, lineHeight: 1 }}>
          {p.bu}
        </div>
        <div style={{ fontSize: "10px", color: C.muted }}>UN</div>
      </>
    )}
  </div>
) : (
  <div style={{ textAlign: "right" }}>
    <div style={{ fontSize: "26px", fontWeight: 900, color: esOk ? C.green : C.text, lineHeight: 1 }}>
      {p.qty}
    </div>
    <div style={{ fontSize: "10px", color: C.muted }}>{p.unit}</div>
  </div>
)}
                    </div>

                    {/* Botón check */}
                    <button
                      style={{
                        width: "44px", height: "44px", borderRadius: "10px",
                        border: `2px solid ${esOk ? C.green : C.bord}`,
                        background: esOk ? C.green : "transparent",
                        color: esOk ? "#0a0c10" : C.muted,
                        fontSize: "20px", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0, transition: "all .15s",
                      }}
                      onClick={() => marcarLinea(p.id)}
                    >
                      {esOk ? "✓" : "○"}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Botón finalizar */}
        <div style={card()}>
          <button
            style={btn({
              background: todasListas
                ? `linear-gradient(135deg,${C.green},#059669)`
                : C.surf2,
              color: todasListas ? "#0a0c10" : C.muted,
              fontWeight: 700,
              width: "100%",
              fontSize: "15px",
              padding: "16px",
              opacity: todasListas ? 1 : 0.6,
            })}
disabled={false}
onClick={() => {
  if (!todasListas) {
    if (!window.confirm(`Faltan ${total - marcadas} productos sin marcar. ¿Finalizar igual?`)) return;
  }
  finalizarMiParte();
}}
          >
            {todasListas ? "✅ FINALIZAR MI PARTE" : `⏳ Faltan ${total - marcadas} productos`}
          </button>
        </div>
      </div>
    );
  }
  // ── Setup screen ───────────────────────────────────────────
  if (screen === "setup")
    return (
      <div style={BS}>
        {/* Carga XLS */}
        <div style={card()}>
          <div style={secTit}>📁 CARGAR ARCHIVO XLS</div>
          <label
            style={{
              ...btn({
                background: `linear-gradient(135deg,${C.accent},#5b21b6)`,
                color: "#fff",
                width: "100%",
                fontSize: "14px",
                padding: "14px",
              }),
              cursor: "pointer",
            }}
          >
            📂 Seleccionar archivo .xls / .xlsx / .csv
            <input
              type="file"
              accept=".xls,.xlsx,.csv,.txt"
              style={{ display: "none" }}
              onChange={handleXLS}
            />
          </label>
          <div
            style={{
              marginTop: "10px",
              padding: "10px 12px",
              background: C.surf2,
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <span style={{ fontSize: "18px" }}>{xlsCargado ? "📄" : "📂"}</span>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: xlsCargado ? C.text : C.muted,
                }}
              >
                {xlsCargado ? fileName : "Ningún archivo cargado"}
              </div>
              <div style={{ fontSize: "10px", color: C.muted }}>
                {xlsCargado
                  ? `${totalPiq} productos · ${xlsData.sections.length} divisiones`
                  : "Seleccioná el XLS para continuar"}
              </div>
            </div>
            {xlsCargado && <span style={pill(C.green)}>✓ Listo</span>}
          </div>
          {xlsCargado && (
            <div
              style={{
                marginTop: "8px",
                display: "flex",
                gap: "5px",
                flexWrap: "wrap",
              }}
            >
              {xlsData.sections.map((s) => (
                <span key={s.name} style={pill(C.blue, { fontSize: "9px" })}>
                  {s.name} ({s.products.length})
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Datos del consolidado */}
        <div style={card()}>
          <div style={secTit}>📋 DATOS DEL CONSOLIDADO</div>

          {/* Número del consolidado — solo lectura, viene del XLS */}
          <div style={{ marginBottom: "10px" }}>
            <label style={lbl}>Consolidado</label>
            {fNum ? (
              <div
                style={{
                  background: C.surf2,
                  borderRadius: "8px",
                  padding: "10px 14px",
                  border: `1px solid ${C.green}`,
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                <span
                  style={{
                    fontSize: "22px",
                    fontWeight: 900,
                    color: C.green,
                    letterSpacing: "1px",
                  }}
                >
                  {fPrefijo ? `${fPrefijo}-${fNum}` : fNum}
                </span>
                <span style={pill(C.green, { fontSize: "9px" })}>
                  ✓ desde XLS
                </span>
              </div>
            ) : (
              <div
                style={{
                  background: C.surf2,
                  borderRadius: "8px",
                  padding: "10px 14px",
                  border: `1px solid ${C.orange}`,
                  color: C.orange,
                  fontSize: "12px",
                }}
              >
                ⚠ El XLS no contiene número — subí el archivo Ros-ArC
              </div>
            )}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "9px",
            }}
          >
            <div>
              <label style={lbl}>Fecha</label>
              <input
                type="date"
                style={inp}
                value={fFecha}
                onChange={(e) => sff(e.target.value)}
              />
            </div>
            <div>
              <label style={lbl}>Hora arranque</label>
              <input
                type="time"
                style={inp}
                value={fHoraInicio}
                onChange={(e) => sfh(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Selección operarios */}
        <div style={card()}>
          <div style={secTit}>👷 OPERARIOS ASIGNADOS</div>
          {operarios.length === 0 && (
            <div
              style={{
                color: C.muted,
                fontSize: "12px",
                textAlign: "center",
                padding: "16px",
              }}
            >
              Sin operarios cargados. Ir a la pestaña 👷 para agregar.
            </div>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px",
            }}
          >
            {operarios.map((op) => (
              <div
                key={op.id}
                style={{
                  ...card({
                    padding: "11px 12px",
                    cursor: "pointer",
                    borderColor: fOps.some((x) => String(x) === String(op.id))
                      ? C.green
                      : C.bord,
                    background: fOps.some((x) => String(x) === String(op.id))
                      ? "rgba(6,214,160,.06)"
                      : C.surf2,
                  }),
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  position: "relative",
                }}
                onClick={() =>
                  sfo((s) =>
                    s.some((x) => String(x) === String(op.id))
                      ? s.filter((x) => String(x) !== String(op.id))
                      : [...s, op.id]
                  )
                }
              >
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    background: op.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "#fff",
                    flexShrink: 0,
                  }}
                >
                  {op.nombre.charAt(0)}
                </div>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600 }}>
                    {op.nombre}
                  </div>
                  <div style={{ fontSize: "10px", color: C.muted }}>
                    {op.codigo}
                  </div>
                </div>
                {fOps.map(String).includes(String(op.id)) && (
                  <span
                    style={{
                      position: "absolute",
                      top: "6px",
                      right: "9px",
                      color: C.green,
                      fontWeight: 700,
                      fontSize: "16px",
                    }}
                  >
                    ✓
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
        {fOps.length > 0 && xlsCargado && (
          <div style={card({ borderColor: C.blue })}>
            <div style={secTit}>📋 ASIGNAR DIVISIONES POR OPERARIO</div>
            {fOps.map((opId) => {
              const op = operarios.find((o) => o.id === opId);
              if (!op) return null;
              const divs = fDivisiones[opId] || [];
              const piqueos = xlsData.sections
                .filter((s) => divs.includes(s.name))
                .reduce((a, s) => a + s.products.length, 0);
              return (
                <div key={opId} style={{ marginBottom: "12px" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "6px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "7px",
                      }}
                    >
                      <div
                        style={{
                          width: "24px",
                          height: "24px",
                          borderRadius: "50%",
                          background: op.color,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "11px",
                          fontWeight: 700,
                          color: "#fff",
                        }}
                      >
                        {op.nombre.charAt(0)}
                      </div>
                      <span style={{ fontWeight: 700, fontSize: "13px" }}>
                        {op.nombre}
                      </span>
                    </div>
                    <span style={pill(divs.length > 0 ? op.color : C.muted)}>
                      {piqueos} piqueos
                    </span>
                  </div>
                  <div
                    style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}
                  >
                    {xlsData.sections.map((sec) => {
                      const selec = divs.includes(sec.name);
                      const asignadaAotro =
                        !selec &&
                        fOps.some(
                          (otherId) =>
                            otherId !== opId &&
                            (fDivisiones[otherId] || []).includes(sec.name)
                        );
                      return (
                        <button
                          key={sec.name}
                          disabled={asignadaAotro}
                          style={btn({
                            background: selec ? op.color : "transparent",
                            color: selec
                              ? "#fff"
                              : asignadaAotro
                              ? C.bord
                              : C.muted,
                            opacity: asignadaAotro ? 0.3 : 1,
                            border: `1px solid ${selec ? op.color : C.bord}`,
                            fontSize: "10px",
                            padding: "4px 8px",
                            borderRadius: "6px",
                          })}
                          onClick={() =>
                            setFDivisiones((prev) => ({
                              ...prev,
                              [opId]: selec
                                ? divs.filter((x) => x !== sec.name)
                                : [...divs, sec.name],
                            }))
                          }
                        >
                          {sec.name} ({sec.products.length})
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <button
          style={btn({
            background: `linear-gradient(135deg,${C.green},#059669)`,
            color: "#0a0c10",
            fontWeight: 700,
            width: "100%",
            fontSize: "14px",
            padding: "14px",
          })}
          onClick={crear}
        >
          🖨 GENERAR E IMPRIMIR CONSOLIDADO
        </button>
        <button
          style={btn({
            background: "transparent",
            color: C.muted,
            border: `1px solid ${C.bord}`,
            width: "100%",
          })}
          onClick={() => setScr("list")}
        >
          ← Volver
        </button>
      </div>
    );

  // ── Lista de consolidados ──────────────────────────────────
  return (
    <div style={BS}>
      <button
        style={btn({
          background: `linear-gradient(135deg,${C.accent},#5b21b6)`,
          color: "#fff",
          width: "100%",
          fontSize: "14px",
          padding: "13px",
        })}
        onClick={() => {
          // FIX: resetear todo a vacío al crear nuevo
          setXLS({ sections: [], numero: "", fecha: "", prefijo: "" });
          setFN("");
          sfn("");
          sfp("");
          sff(todayStr());
          sfh(nowTime());
          sfo([]);
          sfc("");
          setFDivisiones({});
          setScr("setup");
        }}
      >
        + Nuevo Consolidado
      </button>
      {cons.length === 0 && (
        <div style={{ textAlign: "center", color: C.muted, padding: "40px" }}>
          Sin consolidados. Cargá el XLS y creá uno.
        </div>
      )}
      {[...cons].reverse().map((c) => {
        const ok = c.lines.filter((l) => l.estado === "ok").length;
        const err = c.lines.filter((l) => l.estado === "error").length;
        const tot = c.lines.length;
        const armado = c.lines.filter((l) => l.estado === "armado").length;
        const pct = tot > 0 ? Math.round(((ok + err + armado) / tot) * 100) : 0;
        const opsListas = c.activeOps.filter((o) => o.finished).length;
        return (
          <div
            key={c.id}
            style={card({
              borderLeft: `3px solid ${c.finished ? C.green : C.gold}`,
            })}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: "8px",
              }}
            >
              <div>
                <span style={{ fontSize: "18px", fontWeight: 900 }}>
                  #{c.numero}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    color: C.muted,
                    marginLeft: "8px",
                  }}
                >
                  {String(c.fecha).slice(0, 10)} · {c.horaInicio}
                </span>
              </div>
              <span style={pill(c.finished ? C.green : C.gold)}>
                {c.finished ? "CONTROLADO" : "ARMANDO"}
              </span>
            </div>

            {/* Estado operarios con botón Finalizar */}
            <div
              style={{
                display: "flex",
                gap: "7px",
                flexWrap: "wrap",
                marginBottom: "9px",
              }}
            >
              {c.activeOps.map((op) => (
                <div
                  key={op.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    background: C.surf2,
                    borderRadius: "8px",
                    padding: "6px 10px",
                    border: `1px solid ${op.finished ? C.green : C.gold}`,
                  }}
                >
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      background: op.color,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "10px",
                      fontWeight: 700,
                      color: "#fff",
                    }}
                  >
                    {op.nombre.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 600 }}>
                      {op.nombre}
                    </div>
                    <div style={{ fontSize: "9px", color: C.muted }}>
                      {op.finished
                        ? `✓ ${
                            op.endTime && op.startTime
                              ? fTime(
                                  Number(op.endTime) - Number(op.startTime)
                                ).slice(0, 5)
                              : "—"
                          }`
                        : "En curso..."}
                    </div>
                  </div>
                  {op.finished && <span style={{ fontSize: "14px" }}>✅</span>}
                </div>
              ))}
            </div>

            <div
              style={{
                display: "flex",
                gap: "7px",
                marginBottom: "8px",
                flexWrap: "wrap",
              }}
            >
              <span style={pill(C.blue)}>{tot} líneas</span>
              {ok > 0 && <span style={pill(C.green)}>✓ {ok} OK</span>}
              {err > 0 && <span style={pill(C.red)}>✗ {err} errores</span>}
              <span style={pill(opsListas === c.activeOps.length ? C.green : C.gold)}>
  {opsListas}/{c.activeOps.length} operarios listos
</span>
{armado > 0 && <span style={pill(C.accent)}>🔨 {armado} armados</span>}
            </div>
            {pct > 0 && (
              <div
                style={{
                  height: "4px",
                  background: C.bord,
                  borderRadius: "2px",
                  marginBottom: "9px",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${pct}%`,
                    background: `linear-gradient(90deg,${C.green},${C.blue})`,
                    borderRadius: "2px",
                  }}
                />
              </div>
            )}
            <div style={{ display: "flex", gap: "7px" }}>
              <button
                style={btn({
                  background: `linear-gradient(135deg,${C.accent},#5b21b6)`,
                  color: "#fff",
                  flex: 2,
                  fontSize: "12px",
                  padding: "8px",
                })}
                onClick={() => {
                  setCId(c.id);
                  setArmarOpId(null);
                  setScr("armar_movil");
                }}
              >
                📱 Armar
              </button>
              <button
                style={btn({
                  background: C.surf2,
                  color: C.muted,
                  border: `1px solid ${C.bord}`,
                  flex: 1,
                  fontSize: "12px",
                  padding: "8px",
                })}
                onClick={() => {
                  const fecha = new Date().toLocaleDateString("es-AR");
                  const win = window.open("", "_blank", "width=500,height=600");
                  if (win) {
                    const ticketsHTML = c.activeOps.map(op => {
                      const divs = op.divisiones || [];
                      const lineasOp = divs.length > 0
                        ? c.lines.filter(l => divs.includes(l.seccion))
                        : c.lines;
                      return `
                        <div class="ticket">
                          <div class="logo">ROS-ARC</div>
                          <div class="subtit">TICKET DE ARMADO</div>
                          <div class="num">#${c.numero}</div>
                          <div class="linea"></div>
                          <div class="fila"><span>Fecha</span><span>${fecha}</span></div>
                          <div class="fila"><span>Hora inicio</span><span>${c.horaInicio || "—"}</span></div>
                          <div class="fila"><span>Total líneas</span><span>${lineasOp.length}</span></div>
                          <div class="linea"></div>
                          <div class="op" style="color:${op.color}">${op.nombre}</div>
                          <div class="divs">${divs.join(" · ") || "Todas las divisiones"}</div>
                          <div class="piq">${lineasOp.length}</div>
                          <div class="piq-label">PIQUEOS ASIGNADOS</div>
                          <div class="linea"></div>
                          <div class="firma">Firma: ___________________________</div>
                          <div class="hora-fin">Hora fin: ____________</div>
                        </div>`;
                    }).join('<div style="page-break-after:always"></div>');
                
                    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
                    <style>
                      * { margin:0; padding:0; box-sizing:border-box; }
                      body { font-family: Arial, sans-serif; }
                      .ticket { padding:8mm; width:105mm; height:148mm; display:inline-block; vertical-align:top; border:1px dashed #ccc; }
                      .logo { font-size:18pt; font-weight:900; color:#7c3aed; letter-spacing:2px; }
                      .subtit { font-size:7pt; color:#666; letter-spacing:2px; text-transform:uppercase; margin-bottom:4px; }
                      .num { font-size:22pt; font-weight:900; margin:3px 0; }
                      .linea { border-top:1px dashed #ccc; margin:5px 0; }
                      .fila { display:flex; justify-content:space-between; font-size:8pt; padding:2px 0; }
                      .fila span:first-child { color:#666; }
                      .fila span:last-child { font-weight:700; }
                      .op { font-size:16pt; font-weight:900; margin:5px 0 1px; }
                      .divs { font-size:8pt; color:#444; margin-bottom:4px; }
                      .piq { font-size:32pt; font-weight:900; text-align:center; margin:4px 0; color:#333; }
                      .piq-label { font-size:7pt; text-align:center; color:#666; letter-spacing:1px; text-transform:uppercase; }
                      .firma { border-top:1px solid #000; margin-top:6mm; padding-top:2mm; font-size:7pt; color:#666; }
                      .hora-fin { font-size:7pt; color:#666; margin-top:4px; }
                      @media print { @page { size:A4; margin:10mm; } }
                    </style>
                    </head><body>
                      <div style="display:flex;flex-wrap:wrap;gap:4mm;">
                        ${ticketsHTML}
                      </div>
                      <script>setTimeout(()=>window.print(),300);<\/script>
                    </body></html>`);
                    win.document.close();
                  }
                }}
              >
                🖨
              </button>
              <button
                style={btn({
                  background: "transparent",
                  color: C.red,
                  border: `1px solid ${C.red}`,
                  fontSize: "12px",
                  padding: "8px 10px",
                })}
                onClick={() => setCons((cs) => cs.filter((x) => x.id !== c.id))}
              >
                🗑
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MÓDULO CONTROL DIGITAL
// ═══════════════════════════════════════════════════════════════
function ModControl({ toast, operarios, cons, setCons, sincronizar }) {
  const [firmados, setF] = useDB("rosarc_ctrl3", []);
  const [currentId, setCId] = useState(null);
  const [showSig, sSig] = useState(false);
  const [ctrl, sCtrl] = useState("");
  const [errLine, sEl] = useState(null);
  const [filterV, sfV] = useState("todos");
  const [showPrint, sPrint] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!currentId) return;
    const t = setInterval(() => {
      sincronizar && sincronizar();
    }, 5000);
    return () => clearInterval(t);
  }, [currentId, sincronizar]);

  const c = cons.find((x) => String(x.id) === String(currentId));
  const fdata = firmados.find((x) => String(x.id) === String(currentId));
  // REEMPLAZAR por:
  const st = Number(c?.startTime);
  const elapsed = c
    ? c.totalTime || (st > 1600000000000 ? Math.max(0, Date.now() - st) : 0)
    : 0;

    function markLine(lid, estado, motivo = null) {
      if (!ctrl && estado) {
        toast("⚠️ Seleccioná el controlador primero", "error");
        return;
      }
      setCons((cs) =>
        cs.map((x) =>
          String(x.id) !== String(currentId)
            ? x
            : {
                ...x,
                lines: x.lines.map((l) =>
                  l.id !== lid
                    ? l
                    : {
                        ...l,
                        estado,
                        motivo,
                        operario: l.operario || "—",
                        controlador: ctrl || "Controlador",
                        ts: Date.now(),
                      }
                ),
              }
        )
      );
      const c = cons.find((x) => x.id === currentId);
      const line = c?.lines.find((l) => l.id === lid);
      if (line && estado) {
        api.post("actualizar_linea", {
          consId: String(currentId),
          codigo: line.codigo,
          descripcion: line.descripcion,
          estado,
          motivo: motivo || "",
          operario: line.operario || "—",      // ← armador original
          controlador: ctrl || "Controlador",  // ← controlador separado
        });
      }
    }
  function cerrar(sigData) {
    const now = Date.now();
    const c = cons.find((x) => x.id === currentId);
    setF((fs) => {
      const ex = fs.find((x) => x.id === currentId);
      const entry = {
        id: currentId,
        controlador: ctrl,
        firma: sigData,
        ts: now,
      };
      return ex
        ? fs.map((x) => (x.id === currentId ? entry : x))
        : [...fs, entry];
    });
    setCons((cs) =>
      cs.map((x) =>
        x.id !== currentId
          ? x
          : {
              ...x,
              finished: true,
              endTime: now,
              totalTime: now - Number(x.startTime),
              controlador: ctrl,
            }
      )
    );
    api.post("cerrar_consolidado", {
      consId: String(currentId),
      numero: c?.numero,
      fecha: c?.fecha,
      controlador: ctrl,
      horaFin: fHora(now),
      totalTime: c ? now - Number(c.startTime) : 0,
    });
    sSig(false);
    toast("✅ Control cerrado y firmado");
    setCId(null);
  }

  if (showPrint && c)
    return (
      <div
        style={{
          background: "#e8e8e8",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            background: C.surf,
            padding: "10px 18px",
            display: "flex",
            gap: "8px",
            alignItems: "center",
            borderBottom: `1px solid ${C.bord}`,
          }}
        >
          <button
            style={btn({
              background: C.red,
              color: "#fff",
              fontSize: "13px",
              padding: "8px 14px",
            })}
            onClick={() => window.print()}
          >
            🖨 Imprimir
          </button>
          <button
            style={btn({
              background: "transparent",
              color: C.muted,
              border: `1px solid ${C.bord}`,
              marginLeft: "auto",
            })}
            onClick={() => sPrint(false)}
          >
            ← Volver
          </button>
        </div>
        <div style={{ padding: "18px", overflowY: "auto", flex: 1 }}>
          <PrintDoc cons={c} firmaData={fdata} />
        </div>
      </div>
    );

  if (!currentId)
    return (
      <div style={BS}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "2px",
          }}
        >
          <div style={secTit}>🔍 CONTROL DE CONSOLIDADOS</div>
          <button
            style={btn({
              background: C.surf2,
              color: C.blue,
              border: `1px solid ${C.bord}`,
              fontSize: "11px",
              padding: "5px 10px",
            })}
            onClick={() => sincronizar && sincronizar()}
          >
            🔄 Actualizar
          </button>
        </div>
        {cons.length === 0 && (
          <div style={{ textAlign: "center", color: C.muted, padding: "40px" }}>
            No hay consolidados generados aún.
          </div>
        )}
        {cons.map((c) => {
          const fd = firmados.find((x) => x.id === c.id);
          const ok = c.lines.filter((l) => l.estado === "ok").length;
          const err = c.lines.filter((l) => l.estado === "error").length;
          const pend = c.lines.filter((l) => !l.estado).length;
          const pct =
            c.lines.length > 0
              ? Math.round(((ok + err) / c.lines.length) * 100)
              : 0;
          return (
            <div
              key={c.id}
              style={card({
                borderLeft: `3px solid ${
                  c.finished || fd ? C.blue : pct > 0 ? C.orange : C.gold
                }`,
              })}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <div>
                  <span style={{ fontWeight: 900, fontSize: "16px" }}>
                    #{c.numero}
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      color: C.muted,
                      marginLeft: "8px",
                    }}
                  >
                    {c.fecha} · {c.horaInicio}
                  </span>
                </div>
                <span style={pill(fd ? C.blue : pct > 0 ? C.orange : C.gold)}>
                  {c.finished || fd
                    ? "CERRADO"
                    : pct > 0
                    ? "EN PROGRESO"
                    : "PENDIENTE"}
                </span>
              </div>
              {pct > 0 && (
                <div
                  style={{
                    height: "4px",
                    background: C.bord,
                    borderRadius: "2px",
                    marginBottom: "8px",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${pct}%`,
                      background: `linear-gradient(90deg,${C.green},${C.blue})`,
                      borderRadius: "2px",
                    }}
                  />
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  gap: "7px",
                  marginBottom: "8px",
                  flexWrap: "wrap",
                }}
              >
                <span style={pill(C.muted)}>⏳ {pend}</span>
                {ok > 0 && <span style={pill(C.green)}>✓ {ok}</span>}
                {err > 0 && <span style={pill(C.red)}>✗ {err}</span>}
                {fd && <span style={pill(C.blue)}>🕵️ {fd.controlador}</span>}
              </div>
              {fd?.firma && (
                <img
                  src={fd.firma}
                  alt="firma"
                  style={{
                    height: "32px",
                    background: "#fff",
                    borderRadius: "4px",
                    border: `1px solid ${C.bord}`,
                    marginBottom: "8px",
                  }}
                />
              )}
              <div style={{ display: "flex", gap: "7px" }}>
                <button
                  style={btn({
                    background: `linear-gradient(135deg,${C.accent},#5b21b6)`,
                    color: "#fff",
                    flex: 2,
                    fontSize: "12px",
                    padding: "9px",
                  })}
                  onClick={() => {
                    setCId(String(c.id));
                    sCtrl(c.controlador || fd?.controlador || "");
                    sfV("todos");
                  }}
                >
                  🔍 {fd ? "Revisar" : "Controlar"}
                </button>
                <button
                  style={btn({
                    background: C.surf2,
                    color: C.muted,
                    border: `1px solid ${C.bord}`,
                    flex: 1,
                    fontSize: "12px",
                    padding: "9px",
                  })}
                  onClick={() => {
                    setCId(String(c.id));
                    sPrint(true);
                  }}
                >
                  🖨
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );

  if (c) {
    const okN = c.lines.filter((l) => l.estado === "ok").length;
    const errN = c.lines.filter((l) => l.estado === "error").length;
    const pendN = c.lines.filter((l) => !l.estado).length;
    const pct =
      c.lines.length > 0
        ? Math.round(((okN + errN) / c.lines.length) * 100)
        : 0;
    const errors = c.lines.filter((l) => l.estado === "error");
    const sections = [...new Set(c.lines.map((l) => l.seccion))];
    const filtered = c.lines.filter((l) =>
      filterV === "todos"
        ? true
        : filterV === "pendientes"
        ? !l.estado
        : filterV === "ok"
        ? l.estado === "ok"
        : l.estado === "error"
    );
    return (
      <div style={BS}>
        {showSig && <SigPad onSave={cerrar} onCancel={() => sSig(false)} />}
        {errLine && (
          <ErrModal
            onConfirm={(m) => {
              markLine(errLine, "error", m);
              sEl(null);
              toast(`❌ ${m}`, "error");
            }}
            onCancel={() => sEl(null)}
          />
        )}
        <div style={card({ padding: "12px 14px" })}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "7px",
            }}
          >
            <span style={{ fontWeight: 900, fontSize: "16px" }}>
              #{c.numero}{" "}
              <span
                style={{ fontSize: "11px", color: C.muted, fontWeight: 400 }}
              >
                {c.fecha}
              </span>
            </span>
            <span
              style={{
                fontFamily: "monospace",
                fontSize: "22px",
                fontWeight: 900,
                color: C.gold,
              }}
            >
              {fTime(elapsed).slice(0, 5)}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "6px",
            }}
          >
            <div
              style={{
                flex: 1,
                height: "6px",
                background: C.bord,
                borderRadius: "3px",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: `linear-gradient(90deg,${C.green},${C.blue})`,
                  borderRadius: "3px",
                  transition: "width .3s",
                }}
              />
            </div>
            <span style={{ fontSize: "12px", fontWeight: 700, color: C.blue }}>
              {pct}%
            </span>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <span style={pill(C.muted)}>⏳ {pendN}</span>
            <span style={pill(C.green)}>✓ {okN}</span>
            {errN > 0 && <span style={pill(C.red)}>✗ {errN}</span>}
          </div>
        </div>
        <div style={card({ padding: "12px 14px" })}>
          <label style={lbl}>CONTROLADOR</label>
          <select
            style={inp}
            value={ctrl}
            onChange={(e) => sCtrl(e.target.value)}
          >
            <option value="">— Seleccionar controlador —</option>
            {operarios.map((op) => (
              <option key={op.id} value={op.nombre}>
                {op.nombre}
              </option>
            ))}
          </select>
        </div>
        {errors.length > 0 && (
          <div
            style={card({
              borderColor: C.red,
              background: "rgba(255,71,87,.04)",
              padding: "12px 14px",
            })}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: C.red,
                letterSpacing: "2px",
                marginBottom: "8px",
              }}
            >
              ⚠ ERRORES
            </div>
            {errors.map((l) => (
              <div
                key={l.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "7px 0",
                  borderBottom: `1px solid ${C.bord}`,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "12px", fontWeight: 500 }}>
                    {l.descripcion}
                  </div>
                  <div style={{ fontSize: "10px", color: C.red }}>
                    ⚠ {l.motivo} · {l.operario} · {fHora(l.ts)}
                  </div>
                </div>
                <button
                  style={btn({
                    background: "transparent",
                    color: C.orange,
                    border: `1px solid ${C.orange}`,
                    fontSize: "11px",
                    padding: "4px 9px",
                  })}
                  onClick={() => markLine(l.id, null)}
                >
                  ↩
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {[
            ["todos", "Todas", C.blue],
            ["pendientes", "Pendientes", C.muted],
            ["ok", "✓ OK", C.green],
            ["errores", "✗ Errores", C.red],
          ].map(([f, l, c2]) => (
            <button
              key={f}
              style={btn({
                background: filterV === f ? `${c2}18` : "transparent",
                color: filterV === f ? c2 : C.muted,
                border: `1px solid ${filterV === f ? c2 : C.bord}`,
                fontSize: "11px",
                padding: "5px 11px",
              })}
              onClick={() => sfV(f)}
            >
              {l}
            </button>
          ))}
        </div>
        {sections.map((sec) => {
          const sl = filtered.filter((l) => l.seccion === sec);
          if (sl.length === 0) return null;
          const secOk = c.lines.filter(
            (l) => l.seccion === sec && l.estado === "ok"
          ).length;
          const secTot = c.lines.filter((l) => l.seccion === sec).length;
          return (
            <div key={sec} style={card()}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "10px",
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: C.blue,
                    letterSpacing: "2px",
                    textTransform: "uppercase",
                  }}
                >
                  {sec}
                </span>
                <span style={pill(secOk === secTot ? C.green : C.muted)}>
                  {secOk}/{secTot}
                </span>
              </div>
              {sl.map((line) => {
                const isOk = line.estado === "ok";
                const isErr = line.estado === "error";
                const isPend = line.estado !== "ok" && line.estado !== "error";
                return (
                  <div
                    key={line.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "9px",
                      padding: "10px 0",
                      borderBottom: `1px solid ${C.bord}`,
                    }}
                  >
                    <div
                      style={{
                        width: "28px",
                        height: "28px",
                        background: C.surf2,
                        borderRadius: "6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "10px",
                        fontWeight: 700,
                        color: C.muted,
                        flexShrink: 0,
                      }}
                    >
                      {line.pasillo || "—"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          textDecoration: isOk ? "line-through" : "none",
                          color: isOk ? C.muted : C.text,
                          whiteSpace: "normal",
                          lineHeight: 1.3,
                        }}
                      >
                        {line.descripcion}
                      </div>
                      <div style={{ fontSize: "10px", color: C.muted }}>
                        {line.codigo} ·{" "}
                        {line.unit === "BU" ? (
  <span>
    <strong style={{ color: C.orange, fontSize: "15px" }}>
      {line.qty} BU
    </strong>
    {line.bu !== "0" && (
      <strong style={{ color: C.text, fontSize: "15px" }}>
        {" · "}{line.bu} UN
      </strong>
    )}
  </span>
) : (
  <strong style={{ color: C.text, fontSize: "15px" }}>
    {line.qty} {line.unit}
  </strong>
)}
                        {isErr ? (
                          <span style={{ color: C.red }}>
                            {" "}
                            · ⚠ {line.motivo}
                          </span>
                        ) : (
                          ""
                        )}
                      </div>
                    </div>
                    {isPend && (
                      <div
                        style={{ display: "flex", gap: "6px", flexShrink: 0 }}
                      >
                        <button
                          style={btn({
                            background: C.green,
                            color: "#0a0c10",
                            fontSize: "14px",
                            fontWeight: 700,
                            padding: "10px 16px",
                            borderRadius: "10px",
                          })}
                          onClick={() => markLine(line.id, "ok")}
                        >
                          ✓ OK
                        </button>
                        <button
                          style={btn({
                            background: C.red,
                            color: "#fff",
                            fontSize: "12px",
                            fontWeight: 700,
                            padding: "10px 8px",
                            borderRadius: "10px",
                          })}
                          onClick={() => sEl(line.id)}
                        >
                          ✗
                        </button>
                      </div>
                    )}
                    {isOk && (
                      <span style={{ fontSize: "22px", flexShrink: 0 }}>
                        ✅
                      </span>
                    )}
                    {isErr && (
                      <div
                        style={{
                          flexShrink: 0,
                          display: "flex",
                          gap: "5px",
                          alignItems: "center",
                        }}
                      >
                        <span style={{ fontSize: "20px" }}>❌</span>
                        <button
                          style={btn({
                            background: "transparent",
                            color: C.orange,
                            border: `1px solid ${C.orange}`,
                            fontSize: "10px",
                            padding: "3px 8px",
                          })}
                          onClick={() => markLine(line.id, null)}
                        >
                          ↩
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        <div style={card()}>
          <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
            <button
              style={btn({
                background: C.surf2,
                color: C.muted,
                border: `1px solid ${C.bord}`,
                flex: 1,
              })}
              onClick={() => setCId(null)}
            >
              ← Volver
            </button>
            <button
              style={btn({
                background: `linear-gradient(135deg,${C.accent},#5b21b6)`,
                color: "#fff",
                flex: 1,
              })}
              onClick={() => sPrint(true)}
            >
              🖨 Imprimir
            </button>
          </div>
          <button
            style={btn({
              background:
                pendN > 0
                  ? C.surf2
                  : `linear-gradient(135deg,${C.green},#059669)`,
              color: pendN > 0 ? C.muted : "#0a0c10",
              fontWeight: 700,
              width: "100%",
              fontSize: "14px",
              padding: "13px",
              opacity: pendN > 0 ? 0.6 : 1,
            })}
            disabled={pendN > 0}
            onClick={() => {
              if (!ctrl) {
                toast("⚠️ Seleccioná el controlador", "error");
                return;
              }
              sSig(true);
            }}
          >
            {pendN > 0
              ? `⏳ Faltan ${pendN} líneas`
              : "✍️ FIRMAR Y CERRAR CONTROL"}
          </button>
        </div>
      </div>
    );
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// MÓDULO MÉTRICAS
// ═══════════════════════════════════════════════════════════════
function ModMetricas({ toast, cons, prods }) {
  const [sending, setSending] = useState(false);
  const [lastSent, setLastSent] = useDB("rosarc_last_sent", null);
  const [historial, setHistorial] = useDB("rosarc_envios", []);

  const today = todayStr();
  const consHoy = cons.filter((c) => c.fecha === today);
  const totalOk = cons
    .flatMap((c) => c.lines || [])
    .filter((l) => l.estado === "ok").length;
  const totalErr = cons
    .flatMap((c) => c.lines || [])
    .filter((l) => l.estado === "error").length;
  const totalMin =
    cons
      .filter((c) => c.totalTime)
      .reduce((a, c) => a + (c.totalTime || 0), 0) / 60000;
  const totalPiq = cons.reduce((a, c) => a + (c.piqueos || 0), 0);
  const ritmo =
    totalMin > 0 && totalPiq > 0 ? (totalPiq / totalMin).toFixed(1) : "—";

  const erroresAll = cons.flatMap((c) =>
    (c.lines || [])
      .filter((l) => l.estado === "error")
      .map((l) => ({ ...l, consolidado: c.numero, fecha: c.fecha }))
  );
  const errPorMotivo = {};
  erroresAll.forEach((e) => {
    errPorMotivo[e.motivo] = (errPorMotivo[e.motivo] || 0) + 1;
  });
  const topErrores = Object.entries(errPorMotivo)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const opStats = {};
  cons.forEach((c) => {
    (c.activeOps || []).forEach((op) => {
      if (!opStats[op.id])
        opStats[op.id] = { ...op, consolidados: 0, minutos: 0, piqueos: 0 };
      opStats[op.id].consolidados++;
      if (op.endTime && op.startTime)
        opStats[op.id].minutos += Math.round(
          (Number(op.endTime) - Number(op.startTime)) / 60000
        );
      opStats[op.id].piqueos +=
        (c.piqueos || 0) / Math.max((c.activeOps || []).length, 1);
    });
  });
  const opArr = Object.values(opStats).map((o) => ({
    ...o,
    piqMin: o.minutos > 0 ? (o.piqueos / o.minutos).toFixed(1) : "—",
  }));

  async function enviar() {
    if (APPS_SCRIPT_URL.includes("TU_URL_AQUI")) {
      toast("⚠️ Configurá tu URL de Apps Script primero", "error");
      return;
    }
    setSending(true);
    try {
      const payload = {
        tipo: "cierre_diario",
        data: {
          consolidados: cons.map((c) => ({
            numero: c.numero,
            fecha: c.fecha,
            horaInicio: c.horaInicio,
            horaFin: c.endTime ? fHora(c.endTime) : "",
            totalTime: c.totalTime || 0,
            activeOps: c.activeOps || [],
            piqueos: c.piqueos || 0,
            ok: (c.lines || []).filter((l) => l.estado === "ok").length,
            errores: (c.lines || []).filter((l) => l.estado === "error").length,
            controlador: c.controlador || "",
            estado: c.finished ? "Finalizado" : "Pendiente",
          })),
          errores: erroresAll.map((e) => ({
            fecha: e.fecha || today,
            consolidado: e.consolidado,
            seccion: e.seccion || "",
            codigo: e.codigo || "",
            producto: e.descripcion || "",
            motivo: e.motivo || "",
            operario: e.operario || "",
            hora: e.ts ? fHora(e.ts) : "",
            pasillo: e.pasillo || "",
          })),
          operarios: cons.flatMap((c) =>
            (c.activeOps || []).map((op) => ({
              fecha: c.fecha,
              consolidado: c.numero,
              nombre: op.nombre,
              codigo: op.codigo,
              horaInicio: op.startTime ? fHora(op.startTime) : "",
              horaFin: op.endTime ? fHora(op.endTime) : "",
              duracion:
                op.endTime && op.startTime
                  ? Number(op.endTime) - Number(op.startTime)
                  : 0,
              piqueos: Math.round(
                (c.piqueos || 0) / Math.max((c.activeOps || []).length, 1)
              ),
            }))
          ),
          recepciones: (prods?.productos || []).map((p) => ({
            nombre: p.descripcion || "",
            codigo: p.codigo || "",
            cat: p.empresa || "",
            fecha: p.vencimiento || "",
            cantidad: p.cantEsperada || 0,
            fechaRegistro: prods?.info?.fecha || todayStr(),
            operario: prods?.operario || "",
          })),
        },
      };
      await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        mode: "no-cors",
      });
      const ts = new Date().toLocaleString("es-AR");
      setLastSent(ts);
      setHistorial((h) => [
        { ts, consolidados: cons.length, errores: erroresAll.length, ok: true },
        ...h.slice(0, 9),
      ]);
      toast(
        `✅ Enviado — ${cons.length} consolidados · ${erroresAll.length} errores`
      );
    } catch (e) {
      toast("❌ Error al enviar. Verificá la URL.", "error");
      setHistorial((h) => [
        { ts: new Date().toLocaleString("es-AR"), ok: false, error: e.message },
        ...h.slice(0, 9),
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={BS}>
      {/* Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: "8px",
        }}
      >
        {[
          [cons.length, "Consolidados", C.gold],
          [totalPiq, "Piqueos", C.blue],
          [ritmo, "Piq./min", C.green],
          [totalOk, "✓ OK", C.green],
          [totalErr, "✗ Errores", C.red],
          [prods?.productos?.length || 0, "Recepciones", C.accent],
        ].map(([v, l, c]) => (
          <div
            key={l}
            style={card({
              padding: "12px",
              textAlign: "center",
              background: C.surf2,
            })}
          >
            <div style={{ fontSize: "24px", fontWeight: 900, color: c }}>
              {v}
            </div>
            <div
              style={{
                fontSize: "9px",
                color: C.muted,
                letterSpacing: "1px",
                textTransform: "uppercase",
                marginTop: "2px",
              }}
            >
              {l}
            </div>
          </div>
        ))}
      </div>
      {topErrores.length > 0 && (
        <div style={card()}>
          <div style={secTit}>⚠️ TOP ERRORES</div>
          {topErrores.map(([motivo, cant]) => (
            <div
              key={motivo}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "8px 0",
                borderBottom: `1px solid ${C.bord}`,
              }}
            >
              <div style={{ flex: 1, fontSize: "13px", fontWeight: 500 }}>
                {motivo}
              </div>
              <div
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <div
                  style={{
                    height: "6px",
                    width: `${Math.min(cant * 24, 120)}px`,
                    background: C.red,
                    borderRadius: "3px",
                    opacity: 0.7,
                  }}
                />
                <span style={pill(C.red)}>{cant}x</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {opArr.length > 0 && (
        <div style={card()}>
          <div style={secTit}>👷 RENDIMIENTO OPERARIOS</div>
          {opArr.map((op, i) => (
            <div
              key={op.id || i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "10px 0",
                borderBottom: `1px solid ${C.bord}`,
              }}
            >
              <div
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "50%",
                  background: op.color || OP_COLORS[i % OP_COLORS.length],
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                {op.nombre.charAt(0)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "13px", fontWeight: 600 }}>
                  {op.nombre}
                </div>
                <div style={{ fontSize: "10px", color: C.muted }}>
                  {op.consolidados} consolidado(s) · {Math.round(op.minutos)}{" "}
                  min
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: "18px",
                    fontWeight: 900,
                    color: C.gold,
                    fontFamily: "monospace",
                  }}
                >
                  {op.piqMin}
                </div>
                <div style={{ fontSize: "9px", color: C.muted }}>piq/min</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div
        style={card({
          borderColor: C.green,
          background: "rgba(6,214,160,.04)",
        })}
      >
        <div style={secTit}>📤 ENVIAR A GOOGLE SHEETS</div>
        <p
          style={{
            fontSize: "12px",
            color: C.muted,
            marginBottom: "12px",
            lineHeight: 1.6,
          }}
        >
          Enviará todos los datos acumulados al Sheet conectado con Looker
          Studio.
          {lastSent && (
            <>
              <br />
              <span style={{ color: C.green }}>Último envío: {lastSent}</span>
            </>
          )}
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "8px",
            marginBottom: "10px",
          }}
        >
          {[
            [`📋 ${cons.length} consolidados`, C.blue],
            [`⚠️ ${erroresAll.length} errores`, C.red],
            [`👷 ${opArr.length} operarios`, C.green],
            [`📦 ${prods?.productos?.length || 0} recepciones`, C.accent],
          ].map(([l, c]) => (
            <div
              key={l}
              style={{
                background: C.surf2,
                borderRadius: "6px",
                padding: "7px 10px",
                fontSize: "12px",
                color: c,
              }}
            >
              {l}
            </div>
          ))}
        </div>
        <button
          style={btn({
            background: sending
              ? C.surf2
              : `linear-gradient(135deg,${C.green},#059669)`,
            color: sending ? C.muted : "#0a0c10",
            fontWeight: 700,
            width: "100%",
            fontSize: "14px",
            padding: "14px",
            opacity: sending ? 0.7 : 1,
          })}
          disabled={sending}
          onClick={enviar}
        >
          {sending ? "⏳ Enviando..." : "📤 CERRAR DÍA Y ENVIAR A SHEETS"}
        </button>
      </div>
      {historial.length > 0 && (
        <div style={card()}>
          <div style={secTit}>📜 HISTORIAL DE ENVÍOS</div>
          {historial.map((h, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "8px 0",
                borderBottom:
                  i < historial.length - 1 ? `1px solid ${C.bord}` : "none",
              }}
            >
              <span style={{ fontSize: "16px" }}>{h.ok ? "✅" : "❌"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "12px", fontWeight: 500 }}>{h.ts}</div>
                {h.ok && (
                  <div style={{ fontSize: "10px", color: C.muted }}>
                    {h.consolidados} consolidados · {h.errores} errores
                  </div>
                )}
                {!h.ok && (
                  <div style={{ fontSize: "10px", color: C.red }}>
                    {h.error || "Error de conexión"}
                  </div>
                )}
              </div>
              <span style={pill(h.ok ? C.green : C.red)}>
                {h.ok ? "OK" : "ERROR"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// APP PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("armado");
  const [toast, setT] = useState({ msg: "", type: "ok" });
  const [operariosRaw, setOperariosRaw] = useDB("rosarc_ops_v6", []);
  const [prods] = useDB("rosarc_recepcion_v2", null);
  const { cons, setCons, sincronizar, syncOk, lastSync } = useConsolidados();

  const setOperarios = useCallback(
    (fn) => {
      setOperariosRaw((prev) => {
        const next = typeof fn === "function" ? fn(prev) : fn;
        fetch(APPS_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipo: "guardar_operarios", data: next }),
          mode: "no-cors",
        }).catch(() => {});
        return next;
      });
    },
    [setOperariosRaw]
  );

  const operarios = operariosRaw;

  useEffect(() => {
    fetch(`${APPS_SCRIPT_URL}?accion=leer_operarios`)
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "ok" && d.operarios && d.operarios.length > 0)
          setOperariosRaw(d.operarios);
      })
      .catch(() => {});
  }, []);

  function showToast(msg, type = "ok") {
    setT({ msg, type });
    setTimeout(() => setT({ msg: "", type: "ok" }), 3500);
  }

  const tabs = [
    { id: "armado", icon: "🖨", label: "Armado" },
    { id: "control", icon: "🔍", label: "Control" },
    { id: "recepcion", icon: "📦", label: "Recepción" },
    { id: "operarios", icon: "👷", label: "Operarios" },
    { id: "metricas", icon: "📊", label: "Métricas" },
  ];

  const sinURL = APPS_SCRIPT_URL.includes("TU_URL_AQUI");

  return (
    <div
      style={{
        background: C.bg,
        minHeight: "100vh",
        color: C.text,
        fontFamily: "system-ui,sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`@keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}} *{box-sizing:border-box;} @media print{.no-print{display:none!important}}@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
      {toast.msg && (
        <div
          style={{
            position: "fixed",
            bottom: "18px",
            right: "18px",
            background: toast.type === "error" ? C.red : C.surf2,
            border: `1px solid ${C.bord}`,
            borderRadius: "10px",
            padding: "11px 16px",
            fontSize: "13px",
            zIndex: 9999,
            boxShadow: "0 8px 24px rgba(0,0,0,.5)",
            maxWidth: "300px",
          }}
        >
          {toast.msg}
        </div>
      )}
      <div
        className="no-print"
        style={{
          background: C.surf,
          borderBottom: `1px solid ${C.bord}`,
          padding: "0 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: "52px",
          position: "sticky",
          top: 0,
          zIndex: 100,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              fontSize: "18px",
              fontWeight: 900,
              letterSpacing: "3px",
              background: `linear-gradient(135deg,${C.blue},${C.accent})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              flexShrink: 0,
            }}
          >
            ROS-ARC
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              cursor: "pointer",
            }}
            onClick={sincronizar}
            title="Toca para sincronizar"
          >
            <div
              style={{
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                background: sinURL ? C.orange : syncOk ? C.green : C.muted,
                animation:
                  !syncOk && !sinURL ? "pulse 1.5s infinite" : undefined,
              }}
            />
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: "2px",
            background: C.surf2,
            borderRadius: "8px",
            padding: "3px",
            overflowX: "auto",
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              style={{
                ...btn({
                  fontSize: "11px",
                  padding: "5px 10px",
                  borderRadius: "6px",
                  background: tab === t.id ? C.accent : "transparent",
                  color: tab === t.id ? "#fff" : C.muted,
                  whiteSpace: "nowrap",
                }),
                border: "none",
              }}
              onClick={() => setTab(t.id)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>
      {sinURL && (
        <div
          style={{
            background: "rgba(255,140,66,.1)",
            borderBottom: `1px solid ${C.orange}40`,
            padding: "7px 14px",
            fontSize: "11px",
            color: C.orange,
            display: "flex",
            gap: "6px",
          }}
        >
          ⚠️ Modo local — configurá tu URL de Apps Script en línea 3 para
          sincronizar entre dispositivos.
        </div>
      )}
      {tab === "armado" && (
        <ModArmado
          toast={showToast}
          operarios={operarios}
          cons={cons}
          setCons={setCons}
        />
      )}
      {tab === "control" && (
        <ModControl
          toast={showToast}
          operarios={operarios}
          cons={cons}
          setCons={setCons}
          sincronizar={sincronizar}
        />
      )}
      {tab === "recepcion" && (
        <ModRecepcion toast={showToast} operarios={operarios} />
      )}
      {tab === "operarios" && (
        <ModOperarios
          operarios={operarios}
          setOperarios={setOperarios}
          toast={showToast}
        />
      )}
      {tab === "metricas" && (
        <ModMetricas toast={showToast} cons={cons} prods={prods} />
      )}
    </div>
  );
}
