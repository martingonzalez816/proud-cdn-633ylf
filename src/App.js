import { useState, useEffect, useRef, useCallback } from "react";

// ─── CONFIG — pegá tu URL de Apps Script acá ─────────────────
const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyFgyn7X_rDZ_qboQwoZatRFttzlvnYhmxWU55xlyQHVsJuKSU2QrTY7ZGx8lvqjOQ/exec";

// ─── PALETA ───────────────────────────────────────────────────
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

// ─── HELPERS ──────────────────────────────────────────────────
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

// ─── DB HOOK ──────────────────────────────────────────────────
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

// ─── ESTILOS ──────────────────────────────────────────────────
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
const bodyStyle = {
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

// ─── PARSER CSV/XLS ───────────────────────────────────────────
function parseCSV(text) {
  const lines = text
    .split("\n")
    .map((l) => l.split(",").map((c) => c.replace(/^"|"$/g, "").trim()));
  const sections = [];
  let current = null;
  for (const row of lines) {
    if (!row || !row[0]) continue;
    const first = row[0];
    if (
      (first.startsWith("DIV") ||
        first.startsWith("CHOCOLATES") ||
        first.startsWith("COMESTIBLES")) &&
      !row[1]
    ) {
      if (current) sections.push(current);
      current = { name: first, products: [], total_bu: "0" };
      continue;
    }
    if (row[2] && row[2].includes("Total en BU")) {
      if (current) current.total_bu = row[4] || "0";
      continue;
    }
    if (current && row[1] && /^\d+$/.test(row[1]) && row[2]) {
      current.products.push({
        id: `${row[0] || "?"}-${row[1]}`,
        pasillo: row[0] || "",
        codigo: row[1],
        descripcion: row[2],
        bu: row[5] || "0",
        qty: row[7] || row[3] || "0",
        unit: row[8] || row[4] || "UN",
      });
    }
  }
  if (current) sections.push(current);
  return sections.filter((s) => s.products.length > 0);
}

// ─── DATOS MUESTRA ────────────────────────────────────────────
const SAMPLE = [
  {
    name: "DIV. GOLOSINAS",
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
        descripcion: "MASTICABLES x 800g FRUTA",
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
        pasillo: "06",
        codigo: "11828",
        descripcion: "RELL. MIEL 135u x675g",
        bu: "0",
        qty: "1",
        unit: "DI",
      },
      {
        id: "g5",
        pasillo: "13",
        codigo: "12392",
        descripcion: "MOGUL x 500Grs FRUTILLAS ACIDAS",
        bu: "0",
        qty: "2",
        unit: "UN",
      },
      {
        id: "g6",
        pasillo: "17",
        codigo: "14184",
        descripcion: "MOGUL. JELLY BEANS 10X50G",
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
        pasillo: "093",
        codigo: "13174",
        descripcion: "BIZC. VAINILLA x 480g",
        bu: "0",
        qty: "1",
        unit: "UN",
      },
      {
        id: "a3",
        pasillo: "095",
        codigo: "14550",
        descripcion: "FLAN AGRUP. DD LECHE GODET x 8u",
        bu: "0",
        qty: "16",
        unit: "UN",
      },
      {
        id: "a4",
        pasillo: "107",
        codigo: "14429",
        descripcion: "JG. PV. ARC NARANJA 18 X 15g",
        bu: "0",
        qty: "3",
        unit: "DI",
      },
      {
        id: "a5",
        pasillo: "139",
        codigo: "13480",
        descripcion: "FIDEOS ARC TIRABUZON x 500g",
        bu: "2",
        qty: "0",
        unit: "DI",
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
        pasillo: "48",
        codigo: "10340",
        descripcion: "COFLER AIRE. LECHE X55g",
        bu: "0",
        qty: "5",
        unit: "UN",
      },
      {
        id: "c3",
        pasillo: "53",
        codigo: "6072",
        descripcion: "CHOCOLATE C/LECHE 10x25g",
        bu: "0",
        qty: "50",
        unit: "UN",
      },
      {
        id: "c4",
        pasillo: "57",
        codigo: "3465",
        descripcion: "OBLEA B-O-B LECHE X30G",
        bu: "0",
        qty: "24",
        unit: "UN",
      },
    ],
  },
  {
    name: "DIV. HARINAS BAGLEY",
    total_bu: "8",
    products: [
      {
        id: "h1",
        pasillo: "73",
        codigo: "14408",
        descripcion: "TRAVIATA 3x108g",
        bu: "1",
        qty: "6",
        unit: "DI",
      },
      {
        id: "h2",
        pasillo: "73",
        codigo: "14772",
        descripcion: "SURTIDO BAGLEY x 400GRS.",
        bu: "1",
        qty: "10",
        unit: "UN",
      },
      {
        id: "h3",
        pasillo: "83",
        codigo: "10173",
        descripcion: "KESITAS X 75 GRS",
        bu: "1",
        qty: "10",
        unit: "UN",
      },
      {
        id: "h4",
        pasillo: "84",
        codigo: "7198",
        descripcion: "REX ESTUCHE X125G",
        bu: "1",
        qty: "2",
        unit: "UN",
      },
      {
        id: "h5",
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
        codigo: "14152",
        descripcion: "TOMATE CUBETEADO AJO Y CEB. X400GRS",
        bu: "0",
        qty: "12",
        unit: "UN",
      },
      {
        id: "lc3",
        pasillo: "135",
        codigo: "13135",
        descripcion: "ATUN ACEITE LC x 170g",
        bu: "0",
        qty: "6",
        unit: "UN",
      },
    ],
  },
];

// ─── FIRMA DIGITAL ────────────────────────────────────────────
function SigPad({ onSave, onCancel }) {
  const ref = useRef();
  const drawing = useRef(false);
  const gp = (e, c) => {
    const r = c.getBoundingClientRect(),
      s = e.touches ? e.touches[0] : e;
    return {
      x: (s.clientX - r.left) * (c.width / r.width),
      y: (s.clientY - r.top) * (c.height / r.height),
    };
  };
  const start = (e) => {
    drawing.current = true;
    const c = ref.current,
      ctx = c.getContext("2d"),
      p = gp(e, c);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const draw = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const c = ref.current,
      ctx = c.getContext("2d"),
      p = gp(e, c);
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
              const c = ref.current;
              c.getContext("2d").clearRect(0, 0, c.width, c.height);
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

// ─── DOCUMENTO A4 ─────────────────────────────────────────────
function PrintDoc({ cons, firmaData }) {
  if (!cons) return null;
  const ops = cons.activeOps || [];
  const errors = cons.lines.filter((l) => l.estado === "error");
  const okLines = cons.lines.filter((l) => l.estado === "ok");
  const sections = [...new Set(cons.lines.map((l) => l.seccion))];
  const ctrl = firmaData?.controlador || cons.controlador || "";
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
                  {op.endTime ? `→${fHora(op.endTime)}` : ""}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {(okLines.length > 0 || errors.length > 0) && (
        <div style={{ display: "flex", gap: "7pt", marginBottom: "4mm" }}>
          {[
            ["OK", okLines.length, "#06d6a0", "#effffa"],
            ["Errores", errors.length, "#FF4757", "#fff5f5"],
            ["Total", cons.lines.length, "#666", "#f8f8f8"],
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
      {sections.map((sec) => {
        const sl = cons.lines.filter((l) => l.seccion === sec);
        const secOk = sl.filter((l) => l.estado === "ok").length;
        return (
          <div key={sec} style={{ marginBottom: "3.5mm" }}>
            <div
              style={{
                background: "#C0392B",
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
                {secOk > 0 ? `${secOk}/${sl.length} ✓` : sl.length + " líneas"}
              </span>
            </div>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "7pt",
              }}
            >
              <thead>
                <tr style={{ background: "#f0f0f0" }}>
                  {[
                    "PASILLO",
                    "CÓDIGO",
                    "DESCRIPCIÓN",
                    "BU",
                    "FINAL",
                    "UN",
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
                        padding: "2.5pt 3pt",
                        color: "#999",
                        fontSize: "6.5pt",
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
                        padding: "2.5pt 3pt",
                        fontWeight: 500,
                        borderBottom: ".5pt solid #ebebeb",
                      }}
                    >
                      {p.descripcion}
                    </td>
                    <td
                      style={{
                        padding: "2.5pt 3pt",
                        textAlign: "center",
                        fontWeight: 700,
                        color: "#C0392B",
                        borderBottom: ".5pt solid #ebebeb",
                      }}
                    >
                      {p.bu !== "0" ? p.bu : "—"}
                    </td>
                    <td
                      style={{
                        padding: "2.5pt 3pt",
                        textAlign: "right",
                        fontWeight: 700,
                        fontSize: "8.5pt",
                        borderBottom: ".5pt solid #ebebeb",
                      }}
                    >
                      {p.qty}
                    </td>
                    <td
                      style={{
                        padding: "2.5pt 3pt",
                        textAlign: "center",
                        color: "#888",
                        fontSize: "6.5pt",
                        borderBottom: ".5pt solid #ebebeb",
                      }}
                    >
                      {p.unit}
                    </td>
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
                  style={{ borderBottom: "1pt solid #bbb", minHeight: "20pt" }}
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
  );
}

// ═══════════════════════════════════════════════════════════════
// MÓDULO MÉTRICAS / CIERRE DEL DÍA
// ═══════════════════════════════════════════════════════════════
function ModMetricas({ toast, cons, firmados, prods }) {
  const [sending, setSending] = useState(false);
  const [lastSent, setLastSent] = useDB("rosarc_last_sent", null);
  const [historial, setHistorial] = useDB("rosarc_envios", []);

  // Calcular métricas del día
  const today = todayStr();
  const consHoy = cons.filter((c) => c.fecha === today);
  const consFinalizados = consHoy.filter((c) => c.finished);
  const totalPiqueos = consHoy.reduce((a, c) => a + (c.piqueos || 0), 0);
  const totalOk = cons
    .flatMap((c) => c.lines || [])
    .filter((l) => l.estado === "ok").length;
  const totalErr = cons
    .flatMap((c) => c.lines || [])
    .filter((l) => l.estado === "error").length;
  const totalMin =
    consFinalizados.reduce((a, c) => a + (c.totalTime || 0), 0) / 60000;
  const ritmoGlobal =
    totalMin > 0 && totalPiqueos > 0
      ? (totalPiqueos / totalMin).toFixed(1)
      : "—";

  // Top errores
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

  // Rendimiento por operario
  const opStats = {};
  cons.forEach((c) => {
    (c.activeOps || []).forEach((op) => {
      if (!opStats[op.nombre])
        opStats[op.nombre] = {
          nombre: op.nombre,
          codigo: op.codigo,
          consolidados: 0,
          minutos: 0,
          piqueos: 0,
        };
      opStats[op.nombre].consolidados++;
      if (op.endTime && op.startTime)
        opStats[op.nombre].minutos += Math.round(
          (op.endTime - op.startTime) / 60000
        );
      opStats[op.nombre].piqueos +=
        (c.piqueos || 0) / ((c.activeOps || []).length || 1);
    });
  });
  const opArr = Object.values(opStats).map((o) => ({
    ...o,
    piqMin: o.minutos > 0 ? (o.piqueos / o.minutos).toFixed(1) : "—",
  }));

  async function enviarASheets() {
    if (APPS_SCRIPT_URL.includes("TU_URL_AQUI")) {
      toast("⚠️ Configurá tu URL de Apps Script primero", "error");
      return;
    }
    setSending(true);
    try {
      // Armar payload completo
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
                op.endTime && op.startTime ? op.endTime - op.startTime : 0,
              piqueos: (c.piqueos || 0) / ((c.activeOps || []).length || 1),
            }))
          ),
          recepciones: prods.map((p) => ({
            nombre: p.nombre,
            codigo: p.codigo || "",
            cat: p.cat || "",
            fecha: p.fecha,
            cantidad: p.cantidad || 1,
            fechaRegistro: p.fechaRegistro || today,
          })),
        },
      };

      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        mode: "no-cors", // necesario para Apps Script
      });

      const ts = new Date().toLocaleString("es-AR");
      setLastSent(ts);
      setHistorial((h) => [
        { ts, consolidados: cons.length, errores: erroresAll.length, ok: true },
        ...h.slice(0, 9),
      ]);
      toast(
        `✅ Datos enviados a Google Sheets — ${cons.length} consolidados, ${erroresAll.length} errores`
      );
    } catch (e) {
      toast("❌ Error al enviar. Verificá la URL de Apps Script.", "error");
      setHistorial((h) => [
        {
          ts: new Date().toLocaleString("es-AR"),
          consolidados: 0,
          errores: 0,
          ok: false,
          error: e.message,
        },
        ...h.slice(0, 9),
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={bodyStyle}>
      {/* Resumen del día */}
      <div style={card()}>
        <div style={secTit}>📊 RESUMEN DEL DÍA — {today}</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: "8px",
            marginBottom: "12px",
          }}
        >
          {[
            [consHoy.length, "Consolidados", C.gold],
            [totalPiqueos, "Piqueos totales", C.blue],
            [ritmoGlobal, "Piqueos/min", C.green],
            [totalOk, "✓ OK", C.green],
            [totalErr, "✗ Errores", C.red],
            [prods.length, "Recepciones", C.accent],
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
      </div>

      {/* Top errores */}
      {topErrores.length > 0 && (
        <div style={card()}>
          <div style={secTit}>⚠️ TOP ERRORES DEL DÍA</div>
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
                    width: `${Math.min(cant * 20, 120)}px`,
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

      {/* Rendimiento por operario */}
      {opArr.length > 0 && (
        <div style={card()}>
          <div style={secTit}>👷 RENDIMIENTO POR OPERARIO</div>
          {opArr.map((op) => (
            <div
              key={op.nombre}
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
                  background: OP_COLORS[opArr.indexOf(op) % OP_COLORS.length],
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
                  min totales
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

      {/* Envío a Sheets */}
      <div
        style={card({
          borderColor: C.green,
          background: "rgba(6,214,160,.04)",
        })}
      >
        <div style={secTit}>📤 ENVIAR A GOOGLE SHEETS</div>
        <div
          style={{
            fontSize: "12px",
            color: C.muted,
            marginBottom: "12px",
            lineHeight: 1.6,
          }}
        >
          Enviará todos los datos del día al Sheet conectado con Looker Studio.
          <br />
          {lastSent && (
            <span style={{ color: C.green }}>Último envío: {lastSent}</span>
          )}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "8px",
            marginBottom: "8px",
            fontSize: "12px",
          }}
        >
          {[
            [`📋 ${cons.length} consolidados`, C.blue],
            [`⚠️ ${erroresAll.length} errores`, C.red],
            [`👷 ${opArr.length} operarios`, C.green],
            [`📦 ${prods.length} recepciones`, C.accent],
          ].map(([l, c]) => (
            <div
              key={l}
              style={{
                background: C.surf2,
                borderRadius: "6px",
                padding: "8px 10px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span style={{ color: c }}>{l}</span>
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
          onClick={enviarASheets}
        >
          {sending ? "⏳ Enviando..." : "📤 CERRAR DÍA Y ENVIAR A SHEETS"}
        </button>
      </div>

      {/* Historial de envíos */}
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
                    {h.consolidados} consolidados · {h.errores} errores enviados
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
// MÓDULO 1 — RECEPCIÓN
// ═══════════════════════════════════════════════════════════════
function ModRecepcion({ toast }) {
  const [prods, setProds] = useDB("rosarc_venc", []);
  const [form, sf] = useState({
    nombre: "",
    codigo: "",
    cat: "Galletitas",
    fecha: "",
    cantidad: 1,
  });
  const [filter, sfil] = useState("todos");
  const [search, ss] = useState("");
  const [loading, sl] = useState(false);
  const [preview, sp] = useState(null);
  const [showF, ssf] = useState(false);
  const cats = [
    "Galletitas",
    "Caramelos",
    "Snacks",
    "Chocolates",
    "Bebidas",
    "Lácteos",
    "Otro",
  ];

  async function handleImg(e) {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      sp(ev.target.result);
      sl(true);
      ssf(true);
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 400,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: f.type || "image/jpeg",
                      data: ev.target.result.split(",")[1],
                    },
                  },
                  {
                    type: "text",
                    text: 'Analizá esta caja. Respondé SOLO JSON sin markdown:\n{"nombre":"","codigo":"","categoria":"Galletitas|Caramelos|Snacks|Chocolates|Bebidas|Lácteos|Otro","fecha_vencimiento":"YYYY-MM-DD"}',
                  },
                ],
              },
            ],
          }),
        });
        const d = await res.json();
        const p = JSON.parse(
          d.content
            .map((i) => i.text || "")
            .join("")
            .replace(/```json|```/g, "")
            .trim()
        );
        sf((x) => ({
          ...x,
          nombre: p.nombre || "",
          codigo: p.codigo || "",
          cat: p.categoria || "Otro",
          fecha: p.fecha_vencimiento || "",
        }));
        toast("✅ IA extrajo los datos");
      } catch {
        toast("⚠️ Completá manualmente", "error");
      } finally {
        sl(false);
      }
    };
    reader.readAsDataURL(f);
  }

  function add() {
    if (!form.nombre || !form.fecha) {
      toast("⚠️ Nombre y fecha requeridos", "error");
      return;
    }
    setProds((ps) => [
      ...ps,
      { id: Date.now(), ...form, fechaRegistro: todayStr() },
    ]);
    sf({ nombre: "", codigo: "", cat: "Galletitas", fecha: "", cantidad: 1 });
    sp(null);
    ssf(false);
    toast(`📦 "${form.nombre}" registrado`);
  }

  const colorMap = {
    todos: C.accent,
    [C.red]: C.red,
    [C.orange]: C.orange,
    [C.yellow]: C.yellow,
    [C.green]: C.green,
  };
  const counts = { [C.red]: 0, [C.orange]: 0, [C.yellow]: 0, [C.green]: 0 };
  prods.forEach((p) => counts[vencSt(p.fecha).c]++);
  const filtered = prods
    .filter(
      (p) =>
        (filter === "todos" || vencSt(p.fecha).c === filter) &&
        (!search ||
          p.nombre.toLowerCase().includes(search.toLowerCase()) ||
          p.codigo.includes(search))
    )
    .sort((a, b) => {
      const o = { [C.red]: 0, [C.orange]: 1, [C.yellow]: 2, [C.green]: 3 };
      return (o[vencSt(a.fecha).c] || 0) - (o[vencSt(b.fecha).c] || 0);
    });

  return (
    <div style={bodyStyle}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: "8px",
        }}
      >
        {[
          [C.red, "Vencidos"],
          [C.orange, "Críticos"],
          [C.yellow, "Alerta"],
          [C.green, "OK"],
        ].map(([c, l]) => (
          <div
            key={l}
            style={card({
              padding: "12px",
              textAlign: "center",
              cursor: "pointer",
              borderColor: filter === c ? c : C.bord,
            })}
            onClick={() => sfil(filter === c ? "todos" : c)}
          >
            <div style={{ fontSize: "26px", fontWeight: 900, color: c }}>
              {counts[c]}
            </div>
            <div
              style={{
                fontSize: "9px",
                color: C.muted,
                letterSpacing: "1px",
                textTransform: "uppercase",
              }}
            >
              {l}
            </div>
          </div>
        ))}
      </div>
      <div style={card()}>
        <div style={secTit}>📦 REGISTRAR MERCADERÍA</div>
        <p
          style={{
            fontSize: "11px",
            color: C.muted,
            marginBottom: "12px",
            lineHeight: 1.5,
          }}
        >
          📱 La cámara funciona cuando la app está publicada en la web.
          <br />
          En este entorno de previsualización usá el botón Manual.
        </p>
        <div
          style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
            marginBottom: "12px",
          }}
        >
          <label
            style={{
              ...btn({
                background: `linear-gradient(135deg,${C.accent},#5b21b6)`,
                color: "#fff",
              }),
              cursor: "pointer",
            }}
          >
            📷 Cámara
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={handleImg}
            />
          </label>
          <label
            style={{
              ...btn({
                background: "linear-gradient(135deg,#0e7490,#0369a1)",
                color: "#fff",
              }),
              cursor: "pointer",
            }}
          >
            🖼 Galería
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleImg}
            />
          </label>
          <button
            style={btn({
              background: C.surf2,
              color: C.muted,
              border: `1px solid ${C.bord}`,
            })}
            onClick={() => ssf((s) => !s)}
          >
            ✏️ Manual
          </button>
        </div>
        {preview && (
          <img
            src={preview}
            alt=""
            style={{
              width: "100%",
              maxHeight: "140px",
              objectFit: "cover",
              borderRadius: "8px",
              marginBottom: "10px",
            }}
          />
        )}
        {loading && (
          <div
            style={{
              height: "3px",
              background: `linear-gradient(90deg,${C.blue},${C.accent},${C.blue})`,
              backgroundSize: "200%",
              borderRadius: "2px",
              marginBottom: "10px",
              animation: "shimmer 1.2s infinite",
            }}
          />
        )}
        {showF && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
            <div>
              <label style={lbl}>Nombre del producto</label>
              <input
                style={inp}
                value={form.nombre}
                onChange={(e) => sf((f) => ({ ...f, nombre: e.target.value }))}
                placeholder="Serranas Sandwich"
              />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
              }}
            >
              <div>
                <label style={lbl}>Código</label>
                <input
                  style={inp}
                  value={form.codigo}
                  onChange={(e) =>
                    sf((f) => ({ ...f, codigo: e.target.value }))
                  }
                  placeholder="07049"
                />
              </div>
              <div>
                <label style={lbl}>Categoría</label>
                <select
                  style={inp}
                  value={form.cat}
                  onChange={(e) => sf((f) => ({ ...f, cat: e.target.value }))}
                >
                  {cats.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
              }}
            >
              <div>
                <label style={lbl}>Fecha Vencimiento</label>
                <input
                  type="date"
                  style={inp}
                  value={form.fecha}
                  onChange={(e) => sf((f) => ({ ...f, fecha: e.target.value }))}
                />
              </div>
              <div>
                <label style={lbl}>Cantidad recibida</label>
                <input
                  type="number"
                  style={inp}
                  value={form.cantidad}
                  min="1"
                  onChange={(e) =>
                    sf((f) => ({
                      ...f,
                      cantidad: parseInt(e.target.value) || 1,
                    }))
                  }
                />
              </div>
            </div>
            <button
              style={btn({
                background: `linear-gradient(135deg,${C.green},#059669)`,
                color: "#0a0c10",
                fontWeight: 700,
                width: "100%",
              })}
              onClick={add}
            >
              ✓ Agregar al inventario
            </button>
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          gap: "7px",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <button
          style={btn({
            background: filter === "todos" ? C.accent : "transparent",
            color: filter === "todos" ? "#fff" : C.muted,
            border: `1px solid ${filter === "todos" ? C.accent : C.bord}`,
            fontSize: "12px",
            padding: "6px 12px",
          })}
          onClick={() => sfil("todos")}
        >
          Todos {prods.length}
        </button>
        {[
          [C.red, "Vencidos"],
          [C.orange, "Críticos"],
          [C.yellow, "Alerta"],
          [C.green, "OK"],
        ].map(([c, l]) => (
          <button
            key={l}
            style={btn({
              background: filter === c ? `${c}18` : "transparent",
              color: filter === c ? c : C.muted,
              border: `1px solid ${filter === c ? c : C.bord}`,
              fontSize: "12px",
              padding: "6px 12px",
            })}
            onClick={() => sfil(filter === c ? "todos" : c)}
          >
            {l} {counts[c]}
          </button>
        ))}
        <input
          style={{
            ...inp,
            width: "150px",
            marginLeft: "auto",
            padding: "6px 10px",
            fontSize: "12px",
          }}
          placeholder="🔍 Buscar..."
          value={search}
          onChange={(e) => ss(e.target.value)}
        />
      </div>
      <div style={card({ padding: 0, overflow: "hidden" })}>
        {filtered.length === 0 ? (
          <div style={{ padding: "32px", textAlign: "center", color: C.muted }}>
            Sin productos para mostrar
          </div>
        ) : (
          filtered.map((p, i) => {
            const st = vencSt(p.fecha);
            const fd = new Date(p.fecha + "T00:00:00").toLocaleDateString(
              "es-AR",
              { day: "2-digit", month: "2-digit", year: "numeric" }
            );
            return (
              <div
                key={p.id}
                style={{
                  padding: "12px 14px",
                  borderBottom:
                    i < filtered.length - 1 ? `1px solid ${C.bord}` : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  borderLeft: `3px solid ${st.c}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 500,
                      fontSize: "13px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.nombre}
                  </div>
                  <div style={{ fontSize: "10px", color: C.muted }}>
                    {p.codigo && `#${p.codigo} · `}
                    {p.cat} · {p.cantidad}u
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div
                    style={{ fontSize: "12px", color: st.c, fontWeight: 700 }}
                  >
                    {fd}
                  </div>
                  <div style={{ fontSize: "10px", color: st.c }}>
                    {st.d < 0 ? `hace ${Math.abs(st.d)}d` : `${st.d}d`}
                  </div>
                </div>
                <span style={pill(st.c)}>{st.l}</span>
                <button
                  style={btn({
                    background: "transparent",
                    color: C.red,
                    padding: "4px 6px",
                    fontSize: "12px",
                  })}
                  onClick={() =>
                    setProds((ps) => ps.filter((x) => x.id !== p.id))
                  }
                >
                  ✕
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MÓDULO 2 — ARMADO (carga XLS → impresión)
// ═══════════════════════════════════════════════════════════════
function ModArmado({ toast, operarios, cons, setCons }) {
  const [screen, setScr] = useState("list");
  const [currentId, setCId] = useState(null);
  const [fNum, sfn] = useState("");
  const [fFecha, sff] = useState(todayStr());
  const [fHora, sfh] = useState(nowTime());
  const [fOps, sfo] = useState([]);
  const [fCtrl, sfc] = useState("");
  const [sections, setSec] = useState(SAMPLE);
  const [fileName, setFN] = useState("Datos de muestra (XLS Tanda 4)");

  function handleXLS(e) {
    const file = e.target.files[0];
    if (!file) return;
    setFN(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = parseCSV(ev.target.result);
        if (parsed.length > 0) {
          setSec(parsed);
          toast(
            `✅ ${file.name} — ${parsed.reduce(
              (a, s) => a + s.products.length,
              0
            )} productos`
          );
        } else {
          toast("⚠️ No se encontraron productos. Usando muestra.", "error");
          setSec(SAMPLE);
        }
      } catch {
        toast("⚠️ Error leyendo el archivo.", "error");
        setSec(SAMPLE);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  const totalPiq = sections.reduce((a, s) => a + s.products.length, 0);

  function crear() {
    if (!fNum) {
      toast("⚠️ Ingresá el número", "error");
      return;
    }
    if (fOps.length === 0) {
      toast("⚠️ Seleccioná operarios", "error");
      return;
    }
    const now = Date.now();
    const lines = sections.flatMap((sec) =>
      sec.products.map((p) => ({
        ...p,
        id: `${sec.name}-${p.id}`,
        seccion: sec.name,
        estado: null,
        motivo: null,
        operario: null,
        ts: null,
      }))
    );
    const c = {
      id: now,
      numero: fNum,
      fecha: fFecha,
      horaInicio: fHora,
      controlador: fCtrl,
      piqueos: totalPiq,
      activeOps: fOps.map((id) => {
        const op = operarios.find((o) => o.id === id);
        return { ...op, startTime: now, endTime: null, finished: false };
      }),
      startTime: now,
      finished: false,
      totalTime: null,
      lines,
    };
    setCons((cs) => [...cs, c]);
    setCId(now);
    setScr("print");
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
            ← Volver
          </button>
        </div>
        <div style={{ padding: "18px", overflowY: "auto", flex: 1 }}>
          <PrintDoc cons={c} />
        </div>
      </div>
    );
  }

  if (screen === "setup")
    return (
      <div style={bodyStyle}>
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
            📂 Seleccionar .xls / .xlsx / .csv
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
            <span style={{ fontSize: "18px" }}>📄</span>
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>
                {fileName}
              </div>
              <div style={{ fontSize: "10px", color: C.muted }}>
                {totalPiq} productos · {sections.length} secciones
              </div>
            </div>
            <span style={pill(C.green, { marginLeft: "auto" })}>Cargado</span>
          </div>
          <div
            style={{
              marginTop: "10px",
              display: "flex",
              gap: "6px",
              flexWrap: "wrap",
            }}
          >
            {sections.map((s) => (
              <span key={s.name} style={pill(C.blue)}>
                {s.name} ({s.products.length})
              </span>
            ))}
          </div>
        </div>
        <div style={card()}>
          <div style={secTit}>📋 DATOS DEL CONSOLIDADO</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "9px",
              marginBottom: "9px",
            }}
          >
            <div>
              <label style={lbl}>Nro. Consolidado</label>
              <input
                style={inp}
                value={fNum}
                onChange={(e) => sfn(e.target.value)}
                placeholder="82570"
              />
            </div>
            <div>
              <label style={lbl}>Fecha</label>
              <input
                type="date"
                style={inp}
                value={fFecha}
                onChange={(e) => sff(e.target.value)}
              />
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "9px",
            }}
          >
            <div>
              <label style={lbl}>Hora arranque</label>
              <input
                type="time"
                style={inp}
                value={fHora}
                onChange={(e) => sfh(e.target.value)}
              />
            </div>
            <div>
              <label style={lbl}>Controlador</label>
              <input
                style={inp}
                value={fCtrl}
                onChange={(e) => sfc(e.target.value)}
                placeholder="Nombre"
              />
            </div>
          </div>
        </div>
        <div style={card()}>
          <div style={secTit}>👷 OPERARIOS ASIGNADOS</div>
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
                    borderColor: fOps.includes(op.id) ? C.green : C.bord,
                    background: fOps.includes(op.id)
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
                    s.includes(op.id)
                      ? s.filter((x) => x !== op.id)
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
                {fOps.includes(op.id) && (
                  <span
                    style={{
                      position: "absolute",
                      top: "6px",
                      right: "9px",
                      color: C.green,
                      fontWeight: 700,
                    }}
                  >
                    ✓
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
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
          🖨 GENERAR E IMPRIMIR
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

  return (
    <div style={bodyStyle}>
      <button
        style={btn({
          background: `linear-gradient(135deg,${C.accent},#5b21b6)`,
          color: "#fff",
          width: "100%",
          fontSize: "14px",
          padding: "13px",
        })}
        onClick={() => {
          sfn("");
          sff(todayStr());
          sfh(nowTime());
          sfo([]);
          sfc("");
          setSec(SAMPLE);
          setFN("Datos de muestra");
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
        const pct = tot > 0 ? Math.round(((ok + err) / tot) * 100) : 0;
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
                  {c.fecha} · {c.horaInicio}
                </span>
              </div>
              <span style={pill(c.finished ? C.green : C.gold)}>
                {c.finished ? "CONTROLADO" : "LISTO PARA ARMAR"}
              </span>
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
              {ok > 0 && <span style={pill(C.green)}>✓ {ok}</span>}
              {err > 0 && <span style={pill(C.red)}>✗ {err}</span>}
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
                  background: C.surf2,
                  color: C.muted,
                  border: `1px solid ${C.bord}`,
                  flex: 1,
                  fontSize: "12px",
                  padding: "8px",
                })}
                onClick={() => {
                  setCId(c.id);
                  setScr("print");
                }}
              >
                🖨 Reimprimir
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
// MÓDULO 3 — CONTROL DIGITAL
// ═══════════════════════════════════════════════════════════════
function ModControl({ toast, operarios, cons, setCons }) {
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

  const c = cons.find((x) => x.id === currentId);
  const fdata = firmados.find((x) => x.id === currentId);
  const elapsed = c ? c.totalTime || Date.now() - c.startTime : 0;

  function markLine(lid, estado, motivo = null) {
    setCons((cs) =>
      cs.map((x) =>
        x.id !== currentId
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
                      operario: ctrl || "Controlador",
                      ts: Date.now(),
                    }
              ),
            }
      )
    );
  }
  function cerrar(sigData) {
    setF((fs) => {
      const ex = fs.find((x) => x.id === currentId);
      const entry = {
        id: currentId,
        controlador: ctrl,
        firma: sigData,
        ts: Date.now(),
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
              endTime: Date.now(),
              totalTime: Date.now() - x.startTime,
              controlador: ctrl,
            }
      )
    );
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
      <div style={bodyStyle}>
        <div style={secTit}>🔍 CONTROL DE CONSOLIDADOS</div>
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
                  fd ? C.blue : pct > 0 ? C.orange : C.gold
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
                  {fd ? "CERRADO" : pct > 0 ? "EN PROGRESO" : "PENDIENTE"}
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
                    setCId(c.id);
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
                    setCId(c.id);
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
      <div style={bodyStyle}>
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
          <label style={lbl}>TU NOMBRE (controlador)</label>
          <input
            style={inp}
            value={ctrl}
            onChange={(e) => sCtrl(e.target.value)}
            placeholder="Ingresá tu nombre"
          />
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
                const isOk = line.estado === "ok",
                  isErr = line.estado === "error",
                  isPend = !line.estado;
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
                        }}
                      >
                        {line.descripcion}
                      </div>
                      <div style={{ fontSize: "10px", color: C.muted }}>
                        {line.codigo} ·{" "}
                        <strong style={{ color: C.text }}>
                          {line.qty} {line.unit}
                        </strong>
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
                            fontSize: "14px",
                            fontWeight: 700,
                            padding: "10px 16px",
                            borderRadius: "10px",
                          })}
                          onClick={() => sEl(line.id)}
                        >
                          ✗ Error
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
                toast("⚠️ Ingresá tu nombre primero", "error");
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
// APP PRINCIPAL
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("recepcion");
  const [toast, setT] = useState({ msg: "", type: "ok" });
  const [operarios] = useDB("rosarc_ops_v5", [
    { id: 1, nombre: "Operario 1", codigo: "OP-01", color: OP_COLORS[0] },
    { id: 2, nombre: "Operario 2", codigo: "OP-02", color: OP_COLORS[1] },
    { id: 3, nombre: "Operario 3", codigo: "OP-03", color: OP_COLORS[2] },
    { id: 4, nombre: "Operario 4", codigo: "OP-04", color: OP_COLORS[3] },
  ]);
  const [cons, setCons] = useDB("rosarc_cons4", []);
  const [prods] = useDB("rosarc_venc", []);

  function showToast(msg, type = "ok") {
    setT({ msg, type });
    setTimeout(() => setT({ msg: "", type: "ok" }), 3500);
  }

  const tabs = [
    { id: "recepcion", icon: "📦", label: "Recepción" },
    { id: "armado", icon: "🖨", label: "Armado" },
    { id: "control", icon: "🔍", label: "Control" },
    { id: "metricas", icon: "📊", label: "Métricas" },
  ];

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
      <style>{`@keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}} *{box-sizing:border-box;} @media print{.no-print{display:none!important}}`}</style>
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
          padding: "0 14px",
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
        <div
          style={{
            fontSize: "19px",
            fontWeight: 900,
            letterSpacing: "3px",
            background: `linear-gradient(135deg,${C.blue},${C.accent})`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          ROS-ARC
        </div>
        <div
          style={{
            display: "flex",
            gap: "2px",
            background: C.surf2,
            borderRadius: "8px",
            padding: "3px",
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              style={{
                ...btn({
                  fontSize: "11px",
                  padding: "5px 11px",
                  borderRadius: "6px",
                  background: tab === t.id ? C.accent : "transparent",
                  color: tab === t.id ? "#fff" : C.muted,
                }),
                border: "none",
              }}
              onClick={() => setTab(t.id)}
            >
              {t.icon}{" "}
              <span
                style={{ display: window.innerWidth > 400 ? "inline" : "none" }}
              >
                {t.label}
              </span>
            </button>
          ))}
        </div>
      </div>
      {tab === "recepcion" && <ModRecepcion toast={showToast} />}
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
        />
      )}
      {tab === "metricas" && (
        <ModMetricas
          toast={showToast}
          cons={cons}
          firmados={[]}
          prods={prods}
        />
      )}
    </div>
  );
}
