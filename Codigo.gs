/**
 * SOAZ - Módulo de Inspección de Calidad (Papaya)
 * Backend Google Apps Script para Google Sheets + alertas por email.
 *
 * INSTRUCCIONES DE DESPLIEGUE:
 * 1. Abre https://script.google.com y crea/abre el proyecto vinculado.
 * 2. Borra TODO el contenido actual y pega este archivo completo.
 * 3. Pega el ID de TU hoja en CONFIG.SPREADSHEET_ID.
 * 4. Ajusta CONFIG.ALERT_EMAILS y (si quieres) CONFIG.APP_PASSWORD.
 * 5. Guarda > Implementar > Nueva implementación > Aplicación web
 *    - Ejecutar como: Yo
 *    - Quién tiene acceso: Cualquier persona
 * 6. Copia la URL /exec y pégala en index.html (apiBaseUrl) si cambió.
 *
 * SEGURIDAD (simple):
 * - La contraseña vive SOLO aquí (nunca en index.html).
 * - authenticate es pública; el resto de acciones exigen un token válido.
 */

var CONFIG = {
  // Contraseña fija del turno. La app NUNCA la conoce; solo la valida el backend.
  APP_PASSWORD: "Chula2025",

  // Contraseña para editar la lista de correos (reporte y alertas). Solo en backend.
  EMAILS_EDIT_PASSWORD: "280208",

  // OBLIGATORIO: ID de TU hoja. URL: https://docs.google.com/spreadsheets/d/ESTE_ID/edit
  SPREADSHEET_ID: "1U31X4I7eGsxDd7OLRjpw75jlQH6wXfABv4mN0HcA5mc",

  // Misma lista para alertas (3 errores) y reportes periódicos.
  // Se puede editar desde la app; si no hay lista guardada, usa estos.
  ALERT_EMAILS: ["antoniozm007@gmail.com"],
  REPORT_EMAILS: ["antoniozm007@gmail.com"],

  // Listas iniciales de Calidad y Supervisor (editables desde la app).
  CALIDAD_NAMES: ["MICAELA P.", "YOLANDA C.", "KARLA S.", "MARIA R.", "GRACIELA C."],
  SUPERVISOR_NAMES: ["YURIDIA M.", "FERNANDO B.", "MARIO S.", "EMANUEL G."],

  // Vigencia del token de sesión (horas).
  SESSION_HOURS: 12,

  // Nombres de hojas.
  SHEET_SIMPLE: "Inspecciones Simples",
  SHEET_DETAILED: "Inspecciones Detalladas",
  SHEET_DETAILED_RAW: "Inspecciones Bruto",
  SHEET_PACKERS: "Empacadores",
  SHEET_ALERTS: "Alertas",
  SHEET_LOG: "Log",
  SHEET_SUMMARY: "Resumen Empacadores",
  SHEET_SESSIONS: "Sesiones"
};

var HEADERS = {
  simple: [
    "Timestamp", "Día operativo", "Inicio de turno", "Supervisor",
    "Código empacador", "Nombre empacador", "Defecto", "Detalle", "Record ID"
  ],
  // Formato limpio: 1 fila = 1 caja. Una columna por cada defecto.
  // Supervisor e inicio de turno viven en la fila amarilla de CAMBIO DE TURNO.
  detailed: [
    "Audit ID",
    "Timestamp",
    "Código empacador",
    "Nombre empacador",
    "Count",
    "Papayas con defecto",
    "Papayas buenas",
    "Golpe / Tallones",
    "Mal Acomodo",
    "Pudrición",
    "Mal Envuelto",
    "Colores Mixtos",
    "Calibre Revuelto",
    "Mal Pesado",
    "Calidad",
    "Supervisor"
  ],
  // Misma info de cajas, sin marcadores de turno; Turno, Calidad y Supervisor en columnas.
  detailedRaw: [
    "Audit ID",
    "Timestamp",
    "Código empacador",
    "Nombre empacador",
    "Count",
    "Papayas con defecto",
    "Papayas buenas",
    "Golpe / Tallones",
    "Mal Acomodo",
    "Pudrición",
    "Mal Envuelto",
    "Colores Mixtos",
    "Calibre Revuelto",
    "Mal Pesado",
    "Turno",
    "Calidad",
    "Supervisor"
  ],
  packers: ["Código", "Nombre", "Activo"],
  alerts: [
    "Timestamp", "Día operativo", "Supervisor", "Código empacador",
    "Nombre empacador", "Modo", "Registro 1", "Registro 2", "Registro 3",
    "Emails", "Alert ID"
  ],
  log: ["Timestamp", "Origen", "Datos"],
  summary: ["Día operativo", "Código", "Nombre", "Errores", "Última actualización"],
  sessions: ["Token", "Supervisor", "Creado", "Expira"]
};

/* =========================================================================
 *  ENTRADAS HTTP
 * ========================================================================= */

function doGet(e) {
  try {
    var result;
    if (e && e.parameter && e.parameter.payload) {
      var getPayload = JSON.parse(e.parameter.payload);
      result = executeAction_(getPayload);
    } else {
      result = {
        ok: true,
        service: "SOAZ Inspección de Calidad",
        version: "report-v14",
        message: "API activa. v14: Calidad/Supervisor + Golpe / Tallones."
      };
    }
    return respond_(e, result);
  } catch (error) {
    return respond_(e, { ok: false, error: errText_(error) });
  }
}

function doPost(e) {
  try {
    var payload = parseIncomingPayload_(e);
    return respond_(e, executeAction_(payload));
  } catch (error) {
    return respond_(e, { ok: false, error: errText_(error) });
  }
}

function respond_(e, obj) {
  var text = JSON.stringify(obj);
  var callback = e && e.parameter ? e.parameter.callback : "";
  if (callback && /^[A-Za-z_][A-Za-z0-9_]*$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + "(" + text + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}

function parseIncomingPayload_(e) {
  if (e && e.parameter && e.parameter.payload) {
    return JSON.parse(e.parameter.payload);
  }
  if (e && e.postData && e.postData.contents) {
    var contents = String(e.postData.contents).trim();
    if (contents.charAt(0) === "{") {
      return JSON.parse(contents);
    }
    var match = contents.match(/(?:^|&)payload=([^&]*)/);
    if (match && match[1]) {
      return JSON.parse(decodeURIComponent(match[1].replace(/\+/g, " ")));
    }
  }
  throw new Error("Sin cuerpo en la petición. Revisa que la web envíe el campo payload.");
}

function errText_(error) {
  return String(error && error.message ? error.message : error);
}

/* =========================================================================
 *  ROUTER DE ACCIONES
 * ========================================================================= */

var PUBLIC_ACTIONS = { authenticate: true, list_staff_names: true };

function executeAction_(payload) {
  var action = payload.action || "";

  if (action === "authenticate") {
    return handleAuthenticate_(payload);
  }

  // Todas las demás acciones requieren token válido.
  if (!PUBLIC_ACTIONS[action]) {
    var session = validateToken_(payload.token);
    if (!session.ok) {
      return { ok: false, error: "Sesión inválida o expirada" };
    }
    payload._supervisorFromToken = session.supervisor;
  }

  switch (action) {
    case "list_packers": return handleListPackers_();
    case "upsert_packer": return handleUpsertPacker_(payload);
    case "delete_packer": return handleDeletePacker_(payload);
    case "register_simple_inspection": return handleRegisterSimple_(payload);
    case "register_detailed_inspection": return handleRegisterDetailed_(payload);
    case "send_alert": return handleSendAlert_(payload);
    case "open_shift": return handleOpenShift_(payload);
    case "close_shift": return handleCloseShift_(payload);
    case "send_report": return handleSendReport_(payload);
    case "list_report_emails": return handleListReportEmails_();
    case "save_report_emails": return handleSaveReportEmails_(payload);
    case "verify_emails_password": return handleVerifyEmailsPassword_(payload);
    case "list_staff_names": return handleListStaffNames_(payload);
    case "save_staff_names": return handleSaveStaffNames_(payload);
    default: return { ok: false, error: "Acción no reconocida: " + action };
  }
}

/* =========================================================================
 *  AUTENTICACIÓN + TOKENS
 * ========================================================================= */

function handleAuthenticate_(payload) {
  var password = String(payload.password || "");
  var supervisor = String(payload.supervisor || "").trim();
  var calidad = String(payload.calidad || "").trim();

  if (!calidad) {
    return { ok: false, error: "Selecciona el responsable de Calidad" };
  }
  if (!supervisor) {
    return { ok: false, error: "Selecciona el Supervisor" };
  }
  if (password !== CONFIG.APP_PASSWORD) {
    return { ok: false, error: "Contraseña incorrecta" };
  }

  var token = createSession_(supervisor);
  return { ok: true, token: token, supervisor: supervisor, calidad: calidad };
}

function createSession_(supervisor) {
  var sheet = getOrCreateSheet_(CONFIG.SHEET_SESSIONS, HEADERS.sessions);
  var now = new Date();
  var expires = new Date(now.getTime() + CONFIG.SESSION_HOURS * 60 * 60 * 1000);
  var token = "session_" + now.getTime() + "_" + Math.random().toString(36).slice(2, 8);
  sheet.appendRow([token, supervisor, now, expires]);
  return token;
}

function validateToken_(token) {
  var clean = String(token || "").trim();
  if (!clean) {
    return { ok: false };
  }
  var sheet = getOrCreateSheet_(CONFIG.SHEET_SESSIONS, HEADERS.sessions);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { ok: false };
  }
  var values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  var now = new Date().getTime();
  var i;
  for (i = 0; i < values.length; i += 1) {
    if (String(values[i][0]).trim() === clean) {
      var expires = values[i][3];
      var expiresMs = expires instanceof Date ? expires.getTime() : new Date(expires).getTime();
      if (isNaN(expiresMs) || expiresMs > now) {
        return { ok: true, supervisor: String(values[i][1] || "") };
      }
      return { ok: false };
    }
  }
  return { ok: false };
}

/* =========================================================================
 *  EMPACADORES (catálogo compartido)
 * ========================================================================= */

function readPackersFromSheet_() {
  var sheet = getOrCreateSheet_(CONFIG.SHEET_PACKERS, HEADERS.packers);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }
  var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var packers = [];
  var i;
  for (i = 0; i < values.length; i += 1) {
    var code = String(values[i][0] || "").trim().toUpperCase();
    var name = String(values[i][1] || "").trim();
    if (!code) {
      continue;
    }
    var raw = values[i][2];
    var active = !(raw === false || raw === "FALSE" || raw === "false" || raw === 0 || raw === "0");
    packers.push({ code: code, name: name || code, active: active });
  }
  packers.sort(function (a, b) {
    return a.code.localeCompare(b.code);
  });
  return packers;
}

function handleListPackers_() {
  return { ok: true, action: "list_packers", packers: readPackersFromSheet_() };
}

function handleUpsertPacker_(payload) {
  var packer = payload.packer || {};
  var code = String(packer.code || payload.packerCode || "").trim().toUpperCase();
  var name = String(packer.name || payload.packerName || "").trim();
  var active = packer.active !== false && packer.active !== "FALSE" && packer.active !== "false";

  if (!code || !name) {
    return { ok: false, error: "Código y nombre del empacador son obligatorios" };
  }

  var sheet = getOrCreateSheet_(CONFIG.SHEET_PACKERS, HEADERS.packers);
  var lastRow = sheet.getLastRow();
  var foundRow = -1;

  if (lastRow >= 2) {
    var codes = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var i;
    for (i = 0; i < codes.length; i += 1) {
      if (String(codes[i][0] || "").trim().toUpperCase() === code) {
        foundRow = i + 2;
        break;
      }
    }
  }

  if (foundRow > 0) {
    sheet.getRange(foundRow, 1, 1, 3).setValues([[code, name, active]]);
  } else {
    sheet.appendRow([code, name, active]);
  }

  return {
    ok: true,
    action: "upsert_packer",
    packer: { code: code, name: name, active: active },
    packers: readPackersFromSheet_()
  };
}

function handleDeletePacker_(payload) {
  var code = String(payload.packerCode || (payload.packer && payload.packer.code) || "").trim().toUpperCase();
  if (!code) {
    return { ok: false, error: "Falta packerCode" };
  }

  var sheet = getOrCreateSheet_(CONFIG.SHEET_PACKERS, HEADERS.packers);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { ok: true, action: "delete_packer", deleted: false, packers: [] };
  }

  var codes = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var i;
  for (i = 0; i < codes.length; i += 1) {
    if (String(codes[i][0] || "").trim().toUpperCase() === code) {
      sheet.deleteRow(i + 2);
      return {
        ok: true,
        action: "delete_packer",
        deleted: true,
        packerCode: code,
        packers: readPackersFromSheet_()
      };
    }
  }

  return {
    ok: true,
    action: "delete_packer",
    deleted: false,
    packerCode: code,
    packers: readPackersFromSheet_()
  };
}

/* =========================================================================
 *  INSPECCIONES SIMPLES
 * ========================================================================= */

function handleRegisterSimple_(payload) {
  var sheet = getOrCreateSheet_(CONFIG.SHEET_SIMPLE, HEADERS.simple);
  var operationalDay = payload.operationalDay || getOperationalDayKey_(new Date());

  sheet.appendRow([
    formatTimestamp_(payload.timestamp),
    operationalDay,
    payload.shiftStartedAt || "",
    payload.supervisor || payload._supervisorFromToken || "",
    payload.packerCode || "",
    payload.packerName || "",
    payload.defectLabel || payload.defectId || "",
    payload.detail || payload.summary || "",
    payload.recordId || ""
  ]);

  bumpSummary_(operationalDay, payload.packerCode, payload.packerName, payload.countsAsError);

  return { ok: true, action: "register_simple_inspection", operationalDay: operationalDay };
}

/* =========================================================================
 *  INSPECCIONES DETALLADAS
 *  Una fila por caja. Cada defecto tiene su propia columna con la cantidad.
 * ========================================================================= */

function handleRegisterDetailed_(payload) {
  var sheet = ensureDetailedSheet_();
  var operationalDay = payload.operationalDay || getOperationalDayKey_(new Date());
  var qtyByDefect = aggregateDetailedQtys_(payload.rows || []);
  var malPesado = qtyByDefect.malPesadoText || "";
  var supervisor = payload.supervisor || payload._supervisorFromToken || "";
  var calidad = String(payload.calidad || "").trim();
  var shiftName = payload.shiftName || "";

  var coreRow = [
    payload.auditId || "",
    formatTimestamp_(payload.timestamp),
    payload.packerCode || "",
    payload.packerName || "",
    payload.count != null ? payload.count : "",
    payload.assigned != null ? payload.assigned : 0,
    payload.buenas != null ? payload.buenas : "",
    qtyByDefect["Golpe / Tallones"] || qtyByDefect["Golpe"] || 0,
    qtyByDefect["Mal Acomodo"] || 0,
    qtyByDefect["Pudrición"] || 0,
    qtyByDefect["Mal Envuelto"] || 0,
    qtyByDefect["Colores Mixtos"] || 0,
    qtyByDefect["Calibre Revuelto"] || 0,
    malPesado
  ];

  // Hoja detallada: defectos + Calidad + Supervisor.
  sheet.appendRow(coreRow.concat([calidad, supervisor]));

  // Hoja bruta: mismos defectos + Turno + Calidad + Supervisor.
  appendDetailedRawRow_(coreRow, shiftName, calidad, supervisor);

  bumpSummary_(operationalDay, payload.packerCode, payload.packerName, payload.countsAsError);

  return { ok: true, action: "register_detailed_inspection", operationalDay: operationalDay, rows: 1 };
}

/**
 * Convierte el arreglo de filas por defecto en un mapa de cantidades por columna.
 * Mal Pesado no consume Count: se guarda como texto "Peso ↑" / "Peso ↓".
 */
function aggregateDetailedQtys_(rows) {
  var map = {
    "Pudrición": 0,
    "Golpe / Tallones": 0,
    "Calibre Revuelto": 0,
    "Colores Mixtos": 0,
    "Mal Acomodo": 0,
    "Mal Envuelto": 0,
    malPesadoText: ""
  };

  var i;
  for (i = 0; i < rows.length; i += 1) {
    var r = rows[i] || {};
    var name = String(r.defecto || "").trim();
    if (!name || name === "Sin defectos" || name === "Sin fruta desviada") {
      continue;
    }
    if (name === "Golpe" || name === "Tallones" || name === "Golpe / Tallones") {
      name = "Golpe / Tallones";
    }
    if (name === "Mal Pesado") {
      map.malPesadoText = r.malPesado || r.variante || "Sí";
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(map, name)) {
      map[name] += Number(r.cantidad) || 0;
    }
  }
  return map;
}

/**
 * Asegura la hoja con el formato limpio.
 * Si existe el formato viejo (columnas Defecto / Día operativo...),
 * lo renombra a historial y crea una hoja nueva.
 */
function ensureDetailedSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEET_DETAILED);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_DETAILED);
    writeDetailedHeader_(sheet);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    writeDetailedHeader_(sheet);
    return sheet;
  }

  if (!isOldDetailedFormat_(sheet)) {
    // Si el encabezado no coincide exactamente, reescribe solo la fila 1
    // cuando está vacío de datos útiles o cuando falta alguna columna de defecto.
    ensureDetailedHeaderRow_(sheet);
    return sheet;
  }

  // Formato viejo: preservar historial y empezar limpio.
  var archiveName = "Inspecciones Detalladas (historial)";
  var existing = ss.getSheetByName(archiveName);
  var suffix = 2;
  while (existing) {
    archiveName = "Inspecciones Detalladas (historial " + suffix + ")";
    existing = ss.getSheetByName(archiveName);
    suffix += 1;
  }
  sheet.setName(archiveName);

  var fresh = ss.insertSheet(CONFIG.SHEET_DETAILED);
  writeDetailedHeader_(fresh);
  return fresh;
}

function isOldDetailedFormat_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var i;
  for (i = 0; i < headers.length; i += 1) {
    var h = String(headers[i] || "").trim();
    if (h === "Defecto" || h === "Día operativo" || h === "Variante" || h === "Record ID") {
      return true;
    }
  }
  return false;
}

function ensureDetailedHeaderRow_(sheet) {
  var expected = HEADERS.detailed;
  var current = sheet.getRange(1, 1, 1, expected.length).getDisplayValues()[0];
  var needsRewrite = false;
  var i;
  for (i = 0; i < expected.length; i += 1) {
    if (String(current[i] || "").trim() !== expected[i]) {
      needsRewrite = true;
      break;
    }
  }
  if (needsRewrite && sheet.getLastRow() <= 1) {
    sheet.clear();
    writeDetailedHeader_(sheet);
  } else if (needsRewrite) {
    sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
    sheet.getRange(1, 1, 1, expected.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
}

function writeDetailedHeader_(sheet) {
  sheet.appendRow(HEADERS.detailed);
  sheet.getRange(1, 1, 1, HEADERS.detailed.length).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

function ensureDetailedRawSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.SHEET_DETAILED_RAW);
  var headers = HEADERS.detailedRaw;
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_DETAILED_RAW);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return sheet;
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendDetailedRawRow_(dataRow, shiftName, calidad, supervisor) {
  var sheet = ensureDetailedRawSheet_();
  var row = (dataRow || []).slice();
  row.push(shiftName || "");
  row.push(calidad || "");
  row.push(supervisor || "");
  sheet.appendRow(row);
}

/**
 * Ejecutar UNA VEZ desde el editor para llenar "Inspecciones Bruto"
 * con el historial ya existente en "Inspecciones Detalladas".
 */
function migrarInspeccionesBruto() {
  var src = ensureDetailedSheet_();
  var dest = ensureDetailedRawSheet_();
  var lastRow = src.getLastRow();
  if (lastRow < 2) {
    return "No hay filas para migrar.";
  }

  // Limpia datos previos de bruto (conserva encabezado).
  if (dest.getLastRow() > 1) {
    dest.deleteRows(2, dest.getLastRow() - 1);
  }

  var width = Math.max(HEADERS.detailed.length, 14);
  var values = src.getRange(2, 1, lastRow, width).getValues();
  var out = [];
  var currentShift = "";
  var currentSupervisor = "";
  var currentCalidad = "";
  var i;
  var coreWidth = 14; // hasta Mal Pesado

  for (i = 0; i < values.length; i += 1) {
    var row = values[i];
    var first = String(row[0] || "");
    if (first.indexOf("CAMBIO DE TURNO") !== -1) {
      currentSupervisor = String(row[1] || "").replace(/^Supervisor:\s*/i, "").trim();
      currentShift = String(row[5] || "").replace(/^Turno:\s*/i, "").trim();
      continue;
    }
    if (first.indexOf("CIERRE DE TURNO") !== -1) {
      continue;
    }
    if (!String(row[2] || "").trim()) {
      continue;
    }

    var rawRow = [];
    var c;
    for (c = 0; c < coreWidth; c += 1) {
      rawRow.push(row[c] != null ? row[c] : "");
    }
    if (rawRow[1] instanceof Date) {
      rawRow[1] = formatTimestamp_(rawRow[1].toISOString());
    }
    var rowCalidad = String(row[14] || "").trim() || currentCalidad;
    var rowSupervisor = String(row[15] || "").trim() || currentSupervisor;
    rawRow.push(currentShift);
    rawRow.push(rowCalidad);
    rawRow.push(rowSupervisor);
    out.push(rawRow);
  }

  if (out.length) {
    dest.getRange(2, 1, out.length, HEADERS.detailedRaw.length).setValues(out);
  }
  return "Migradas " + out.length + " filas a " + CONFIG.SHEET_DETAILED_RAW + ".";
}

/* =========================================================================
 *  RESUMEN EMPACADORES (contador de errores por día operativo)
 * ========================================================================= */

function bumpSummary_(operationalDay, packerCode, packerName, countsAsError) {
  if (!countsAsError || !packerCode) {
    return;
  }
  var sheet = getOrCreateSheet_(CONFIG.SHEET_SUMMARY, HEADERS.summary);
  var code = String(packerCode).trim().toUpperCase();
  var lastRow = sheet.getLastRow();
  var foundRow = -1;

  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    var i;
    for (i = 0; i < values.length; i += 1) {
      if (String(values[i][0]).trim() === String(operationalDay).trim() &&
          String(values[i][1]).trim().toUpperCase() === code) {
        foundRow = i + 2;
        break;
      }
    }
  }

  var now = formatTimestamp_(new Date().toISOString());
  if (foundRow > 0) {
    var current = Number(sheet.getRange(foundRow, 4).getValue()) || 0;
    sheet.getRange(foundRow, 4).setValue(current + 1);
    sheet.getRange(foundRow, 5).setValue(now);
  } else {
    sheet.appendRow([operationalDay, code, packerName || "", 1, now]);
  }
}

/* =========================================================================
 *  ALERTA DE 3 ERRORES
 * ========================================================================= */

function handleSendAlert_(payload) {
  var sheet = getOrCreateSheet_(CONFIG.SHEET_ALERTS, HEADERS.alerts);
  var errors = payload.errors || [];
  var emails = resolveReportEmails_(payload.emails);
  var supervisor = payload.supervisor || payload._supervisorFromToken || "";

  sheet.appendRow([
    formatTimestamp_(payload.timestamp),
    payload.operationalDay || "",
    supervisor,
    payload.packerCode || "",
    payload.packerName || "",
    payload.mode || "",
    errors[0] || "",
    errors[1] || "",
    errors[2] || "",
    emails.join(", "),
    payload.alertId || ""
  ]);

  var subject = "SOAZ ALERTA · 3 errores · Empacador " + (payload.packerCode || "");
  var body =
    "Alerta automática del Módulo de Inspección de Calidad SOAZ\n\n" +
    "Supervisor: " + (supervisor || "—") + "\n" +
    "Día operativo: " + (payload.operationalDay || "—") + "\n" +
    "Modo: " + (payload.mode || "—") + "\n" +
    "Empacador: " + (payload.packerCode || "—") + " (" + (payload.packerName || "—") + ")\n\n" +
    "Registros con error:\n" +
    "1. " + (errors[0] || "—") + "\n" +
    "2. " + (errors[1] || "—") + "\n" +
    "3. " + (errors[2] || "—") + "\n\n" +
    "Alert ID: " + (payload.alertId || "—") + "\n";

  var emailResult = { sent: false, detail: "" };
  try {
    MailApp.sendEmail({ to: emails.join(","), subject: subject, body: body });
    emailResult.sent = true;
    emailResult.detail = "Email enviado";
  } catch (mailError) {
    emailResult.detail = errText_(mailError);
  }

  return { ok: true, action: "send_alert", email: emailResult };
}

/* =========================================================================
 *  APERTURA / CIERRE DE TURNO (marcadores)
 * ========================================================================= */

function shiftSheetFor_(mode) {
  return mode === "detailed"
    ? ensureDetailedSheet_()
    : getOrCreateSheet_(CONFIG.SHEET_SIMPLE, HEADERS.simple);
}

function handleOpenShift_(payload) {
  var mode = payload.mode === "detailed" ? "detailed" : "simple";
  var sheet = shiftSheetFor_(mode);
  var width = mode === "detailed" ? HEADERS.detailed.length : HEADERS.simple.length;
  var operationalDay = payload.operationalDay || getOperationalDayKey_(new Date());

  // Fila vacía de separación.
  sheet.appendRow(new Array(width).fill(""));

  // Fila marcador resaltada.
  var markerRow = new Array(width).fill("");
  markerRow[0] = "—— CAMBIO DE TURNO ——";
  markerRow[1] = "Supervisor: " + (payload.supervisor || payload._supervisorFromToken || "");
  markerRow[2] = formatTimestamp_(payload.timestamp);
  markerRow[3] = "Empacadores: " + (payload.activePackerCount || 0);
  if (width > 4) {
    markerRow[4] = "Día operativo: " + operationalDay;
  }
  if (width > 5) {
    markerRow[5] = "Turno: " + (payload.shiftName || "");
  }
  if (width > 6) {
    markerRow[6] = "Calidad: " + (payload.calidad || "");
  }

  sheet.appendRow(markerRow);
  var markerRowIndex = sheet.getLastRow();
  var range = sheet.getRange(markerRowIndex, 1, 1, width);
  range.setFontWeight("bold");
  range.setBackground("#fff3cd");

  return { ok: true, action: "open_shift", mode: mode, operationalDay: operationalDay, row: markerRowIndex };
}

function handleCloseShift_(payload) {
  var mode = payload.mode === "detailed" ? "detailed" : "simple";
  var sheet = shiftSheetFor_(mode);
  var width = mode === "detailed" ? HEADERS.detailed.length : HEADERS.simple.length;
  var reportInfo = { sent: false, skipped: true, reason: "Sin envío de reporte." };

  // Antes de marcar el cierre: envía el reporte acumulado del turno.
  if (mode === "detailed") {
    try {
      reportInfo = sendFinalShiftReport_(payload);
    } catch (reportError) {
      reportInfo = {
        sent: false,
        skipped: true,
        reason: "No se pudo enviar el reporte de cierre: " + errText_(reportError)
      };
    }
  }

  var markerRow = new Array(width).fill("");
  markerRow[0] = "—— CIERRE DE TURNO ——";
  markerRow[1] = "Supervisor: " + (payload.supervisor || payload._supervisorFromToken || "");
  markerRow[2] = formatTimestamp_(payload.timestamp);
  if (width > 3) {
    markerRow[3] = "Día operativo: " + (payload.operationalDay || getOperationalDayKey_(new Date()));
  }

  sheet.appendRow(markerRow);
  var idx = sheet.getLastRow();
  var range = sheet.getRange(idx, 1, 1, width);
  range.setFontWeight("bold");
  range.setBackground("#e2e8f0");

  return { ok: true, action: "close_shift", mode: mode, report: reportInfo };
}

function sendFinalShiftReport_(payload) {
  var active = findActiveDetailedShift_();
  var emails = resolveReportEmails_(payload.emails);
  var report = buildPackerReport_({
    shiftStartedAt: payload.shiftStartedAt || active.shiftStartedAtIso || "",
    shiftName: payload.shiftName || active.shiftName || "",
    supervisor: payload.supervisor || payload._supervisorFromToken || active.supervisor || "",
    operationalDay: payload.operationalDay || active.operationalDay || getOperationalDayKey_(new Date()),
    hoursBack: 0,
    sinceShiftStart: true,
    sinceRow: active.active ? (active.startRow || 0) : 0
  });

  if (!report.rows.length || report.totalAudits < 1) {
    return {
      sent: false,
      skipped: true,
      reason: "Turno cerrado sin información para reportar.",
      packers: 0,
      boxes: 0
    };
  }

  // Marca en el correo que es el cierre de turno.
  report.windowLabel = "Cierre de turno · acumulado" +
    (payload.shiftStartedAt || active.shiftStartedAtIso
      ? " (desde " + formatTimestamp_(payload.shiftStartedAt || active.shiftStartedAtIso) + ")"
      : "");

  var mail = sendReportEmail_(report, emails);
  return {
    sent: Boolean(mail && mail.sent),
    skipped: false,
    packers: report.rows.length,
    boxes: report.totalBoxes,
    email: mail,
    reason: mail && mail.sent ? "Reporte de cierre enviado." : (mail && mail.detail) || "No se envió el correo."
  };
}

/* =========================================================================
 *  REPORTE CADA 2 HORAS / MANUAL
 *  CAJAS = cajas con desviación
 *  DESV  = papayas con error + Mal Pesado (1 por caja)
 *  %DESV = DESV / Count total * 100
 * ========================================================================= */

var REPORT_DEFECT_COLS = [
  "Mal Acomodo",
  "Pudrición",
  "Mal Envuelto",
  "Golpe / Tallones",
  "Colores Mixtos",
  "Calibre Revuelto",
  "Mal Pesado"
];

function handleSendReport_(payload) {
  var emails = resolveReportEmails_(payload.emails);
  // Acumulado del turno abierto (historial desde CAMBIO DE TURNO).
  var active = findActiveDetailedShift_();
  var report = buildPackerReport_({
    shiftStartedAt: payload.shiftStartedAt || active.shiftStartedAtIso || "",
    shiftName: payload.shiftName || active.shiftName || "",
    supervisor: payload.supervisor || payload._supervisorFromToken || active.supervisor || "",
    operationalDay: payload.operationalDay || active.operationalDay || getOperationalDayKey_(new Date()),
    hoursBack: 0,
    sinceShiftStart: true,
    sinceRow: active.active ? (active.startRow || 0) : 0
  });

  if (!report.rows.length || report.totalAudits < 1) {
    return {
      ok: true,
      action: "send_report",
      skipped: true,
      reason: "No hay información de inspecciones para reportar.",
      packers: 0,
      boxes: 0
    };
  }

  var mail = sendReportEmail_(report, emails);
  return {
    ok: true,
    action: "send_report",
    skipped: false,
    packers: report.rows.length,
    boxes: report.totalBoxes,
    email: mail
  };
}

/**
 * Trigger automático cada 2 horas.
 * Ejecutar UNA VEZ desde el editor: instalarTriggerReporte()
 * No envía si no hay turno activo o no hay datos.
 */
function sendScheduledReport() {
  var active = findActiveDetailedShift_();
  if (!active.active) {
    return { ok: true, skipped: true, reason: "No hay turno activo." };
  }

  var report = buildPackerReport_({
    shiftStartedAt: active.shiftStartedAtIso || "",
    shiftName: active.shiftName || "",
    supervisor: active.supervisor || "",
    operationalDay: active.operationalDay || getOperationalDayKey_(new Date()),
    hoursBack: 0,
    sinceShiftStart: Boolean(active.shiftStartedAtIso),
    sinceRow: active.startRow || 0
  });

  if (!report.rows.length || report.totalAudits < 1) {
    return { ok: true, skipped: true, reason: "Turno activo sin información para reportar." };
  }

  var emails = getStoredReportEmails_();
  return {
    ok: true,
    skipped: false,
    email: sendReportEmail_(report, emails),
    packers: report.rows.length,
    boxes: report.totalBoxes
  };
}

function handleListReportEmails_() {
  return { ok: true, action: "list_report_emails", emails: getStoredReportEmails_() };
}

function handleVerifyEmailsPassword_(payload) {
  if (String(payload.password || "") !== String(CONFIG.EMAILS_EDIT_PASSWORD || "")) {
    return { ok: false, error: "Contraseña incorrecta." };
  }
  return { ok: true, action: "verify_emails_password" };
}

function handleSaveReportEmails_(payload) {
  if (String(payload.password || "") !== String(CONFIG.EMAILS_EDIT_PASSWORD || "")) {
    return { ok: false, error: "Contraseña incorrecta. No se pudieron guardar los correos." };
  }
  var emails = normalizeEmailList_(payload.emails || []);
  if (!emails.length) {
    emails = CONFIG.REPORT_EMAILS.slice();
  }
  PropertiesService.getScriptProperties().setProperty("REPORT_EMAILS", JSON.stringify(emails));
  return { ok: true, action: "save_report_emails", emails: emails };
}

function handleListStaffNames_(payload) {
  var type = String(payload.type || "").trim().toLowerCase();
  if (type !== "calidad" && type !== "supervisor") {
    return { ok: false, error: "Tipo inválido. Usa calidad o supervisor." };
  }
  return { ok: true, action: "list_staff_names", type: type, names: getStoredStaffNames_(type) };
}

function handleSaveStaffNames_(payload) {
  if (String(payload.password || "") !== String(CONFIG.EMAILS_EDIT_PASSWORD || "")) {
    return { ok: false, error: "Contraseña incorrecta. No se pudieron guardar los nombres." };
  }
  var type = String(payload.type || "").trim().toLowerCase();
  if (type !== "calidad" && type !== "supervisor") {
    return { ok: false, error: "Tipo inválido. Usa calidad o supervisor." };
  }
  var names = normalizeStaffNames_(payload.names || []);
  if (!names.length) {
    names = getDefaultStaffNames_(type);
  }
  PropertiesService.getScriptProperties().setProperty(
    type === "calidad" ? "CALIDAD_NAMES" : "SUPERVISOR_NAMES",
    JSON.stringify(names)
  );
  return { ok: true, action: "save_staff_names", type: type, names: names };
}

function getDefaultStaffNames_(type) {
  return type === "calidad"
    ? CONFIG.CALIDAD_NAMES.slice()
    : CONFIG.SUPERVISOR_NAMES.slice();
}

function getStoredStaffNames_(type) {
  var key = type === "calidad" ? "CALIDAD_NAMES" : "SUPERVISOR_NAMES";
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(key);
    if (raw) {
      var parsed = JSON.parse(raw);
      var list = normalizeStaffNames_(parsed);
      if (list.length) { return list; }
    }
  } catch (ignoreProp) {
  }
  return getDefaultStaffNames_(type);
}

function normalizeStaffNames_(list) {
  var out = [];
  var seen = {};
  var i;
  for (i = 0; i < (list || []).length; i += 1) {
    var name = String(list[i] || "").trim();
    if (!name) { continue; }
    var key = name.toUpperCase();
    if (seen[key]) { continue; }
    seen[key] = true;
    out.push(name);
  }
  return out;
}

function resolveReportEmails_(incoming) {
  var fromPayload = normalizeEmailList_(incoming || []);
  if (fromPayload.length) { return fromPayload; }
  return getStoredReportEmails_();
}

function getStoredReportEmails_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty("REPORT_EMAILS");
    if (raw) {
      var parsed = JSON.parse(raw);
      var list = normalizeEmailList_(parsed);
      if (list.length) { return list; }
    }
  } catch (ignoreProp) {
  }
  return CONFIG.REPORT_EMAILS.slice();
}

function normalizeEmailList_(list) {
  var out = [];
  var seen = {};
  var i;
  for (i = 0; i < (list || []).length; i += 1) {
    var email = String(list[i] || "").trim().toLowerCase();
    if (!email || seen[email]) { continue; }
    if (email.indexOf("@") === -1) { continue; }
    seen[email] = true;
    out.push(email);
  }
  return out;
}

/**
 * Detecta si hay un turno detallado abierto:
 * último marcador relevante = CAMBIO DE TURNO (sin CIERRE posterior).
 */
function findActiveDetailedShift_() {
  var sheet = ensureDetailedSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { active: false };
  }
  var width = HEADERS.detailed.length;
  var values = sheet.getRange(2, 1, lastRow, Math.min(width, 6)).getValues();
  var lastOpenRow = -1;
  var lastCloseRow = -1;
  var openMeta = { supervisor: "", shiftName: "", operationalDay: "", timestamp: "" };
  var i;
  for (i = 0; i < values.length; i += 1) {
    var first = String(values[i][0] || "");
    if (first.indexOf("CAMBIO DE TURNO") !== -1) {
      lastOpenRow = i + 2;
      openMeta.supervisor = String(values[i][1] || "").replace(/^Supervisor:\s*/i, "");
      openMeta.timestamp = values[i][2];
      openMeta.operationalDay = String(values[i][4] || "").replace(/^Día operativo:\s*/i, "");
      openMeta.shiftName = String(values[i][5] || "").replace(/^Turno:\s*/i, "");
    }
    if (first.indexOf("CIERRE DE TURNO") !== -1) {
      lastCloseRow = i + 2;
    }
  }

  if (lastOpenRow < 0 || lastCloseRow > lastOpenRow) {
    return { active: false };
  }

  var shiftStartedAtIso = "";
  if (openMeta.timestamp instanceof Date) {
    shiftStartedAtIso = openMeta.timestamp.toISOString();
  } else if (openMeta.timestamp) {
    var ms = parseSheetTimestampMs_(openMeta.timestamp);
    if (ms) { shiftStartedAtIso = new Date(ms).toISOString(); }
  }

  return {
    active: true,
    startRow: lastOpenRow,
    supervisor: openMeta.supervisor,
    shiftName: openMeta.shiftName,
    operationalDay: openMeta.operationalDay || getOperationalDayKey_(new Date()),
    shiftStartedAtIso: shiftStartedAtIso
  };
}

function instalarTriggerReporte() {
  var triggers = ScriptApp.getProjectTriggers();
  var i;
  for (i = 0; i < triggers.length; i += 1) {
    if (triggers[i].getHandlerFunction() === "sendScheduledReport") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("sendScheduledReport")
    .timeBased()
    .everyHours(2)
    .create();
  return "Trigger instalado: sendScheduledReport cada 2 horas.";
}

function buildPackerReport_(options) {
  var sheet = ensureDetailedSheet_();
  var lastRow = sheet.getLastRow();
  var headers = HEADERS.detailed;
  var map = {};
  var totalBoxes = 0;
  var totalAudits = 0;
  var cutoffMs = 0;
  var shiftStartMs = 0;
  var sinceRow = Number(options.sinceRow) || 0;

  if (options.hoursBack > 0) {
    cutoffMs = new Date().getTime() - options.hoursBack * 60 * 60 * 1000;
  }
  if (options.sinceShiftStart && options.shiftStartedAt) {
    try {
      shiftStartMs = new Date(options.shiftStartedAt).getTime();
    } catch (ignoreShift) {
      shiftStartMs = 0;
    }
  }

  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow, headers.length).getValues();
    var r;
    for (r = 0; r < values.length; r += 1) {
      var sheetRow = r + 2;
      if (sinceRow && sheetRow <= sinceRow) {
        continue;
      }
      var row = values[r];
      var first = String(row[0] || "");
      if (first.indexOf("CAMBIO DE TURNO") !== -1 || first.indexOf("CIERRE DE TURNO") !== -1) {
        continue;
      }
      if (!String(row[2] || "").trim()) {
        continue;
      }

      var tsMs = parseSheetTimestampMs_(row[1]);
      if (cutoffMs && tsMs && tsMs < cutoffMs) {
        continue;
      }
      if (shiftStartMs && tsMs && tsMs < shiftStartMs) {
        continue;
      }

      var code = String(row[2] || "").trim().toUpperCase();
      var name = String(row[3] || "").trim();
      var count = Number(row[4]) || 0;
      var assigned = Number(row[5]) || 0;
      var tallones = Number(row[7]) || 0;
      var malAcomodo = Number(row[8]) || 0;
      var pudricion = Number(row[9]) || 0;
      var malEnvuelto = Number(row[10]) || 0;
      var colores = Number(row[11]) || 0;
      var calibre = Number(row[12]) || 0;
      var malPesadoText = String(row[13] || "").trim();
      var malPesado = malPesadoText ? 1 : 0;
      var hasDeviation = assigned > 0 || malPesado > 0;

      if (!map[code]) {
        map[code] = {
          code: code,
          name: name || code,
          boxes: 0,
          boxesWithDev: 0,
          desv: 0,
          countTotal: 0,
          "Mal Acomodo": 0,
          "Pudrición": 0,
          "Mal Envuelto": 0,
          "Golpe / Tallones": 0,
          "Colores Mixtos": 0,
          "Calibre Revuelto": 0,
          "Mal Pesado": 0
        };
      }

      var item = map[code];
      if (name) { item.name = name; }
      item.boxes += 1;
      totalAudits += 1;
      item.countTotal += count;
      // DESV = papayas con defecto + Mal Pesado (vale 1 por caja).
      item.desv += assigned + malPesado;
      item["Golpe / Tallones"] += tallones;
      item["Mal Acomodo"] += malAcomodo;
      item["Pudrición"] += pudricion;
      item["Mal Envuelto"] += malEnvuelto;
      item["Colores Mixtos"] += colores;
      item["Calibre Revuelto"] += calibre;
      item["Mal Pesado"] += malPesado;
      if (hasDeviation) {
        item.boxesWithDev += 1;
        totalBoxes += 1;
      }
    }
  }

  var rows = [];
  var defectTotalsMap = {
    "Mal Acomodo": 0,
    "Pudrición": 0,
    "Mal Envuelto": 0,
    "Golpe / Tallones": 0,
    "Colores Mixtos": 0,
    "Calibre Revuelto": 0,
    "Mal Pesado": 0
  };

  Object.keys(map).forEach(function (code) {
    var item = map[code];
    var pct = item.countTotal > 0 ? Math.round((item.desv / item.countTotal) * 100) : 0;
    var countAvg = item.boxes > 0 ? Math.round(item.countTotal / item.boxes) : 0;
    rows.push({
      code: item.code,
      name: item.name,
      cajas: item.boxesWithDev,
      count: countAvg,
      countT: item.countTotal,
      desv: item.desv,
      pctDesv: pct,
      defects: {
        "Mal Acomodo": item["Mal Acomodo"],
        "Pudrición": item["Pudrición"],
        "Mal Envuelto": item["Mal Envuelto"],
        "Golpe / Tallones": item["Golpe / Tallones"],
        "Colores Mixtos": item["Colores Mixtos"],
        "Calibre Revuelto": item["Calibre Revuelto"],
        "Mal Pesado": item["Mal Pesado"]
      }
    });
    defectTotalsMap["Mal Acomodo"] += item["Mal Acomodo"];
    defectTotalsMap["Pudrición"] += item["Pudrición"];
    defectTotalsMap["Mal Envuelto"] += item["Mal Envuelto"];
    defectTotalsMap["Golpe / Tallones"] += item["Golpe / Tallones"];
    defectTotalsMap["Colores Mixtos"] += item["Colores Mixtos"];
    defectTotalsMap["Calibre Revuelto"] += item["Calibre Revuelto"];
    defectTotalsMap["Mal Pesado"] += item["Mal Pesado"];
  });

  var defectTotals = [];
  Object.keys(defectTotalsMap).forEach(function (name) {
    defectTotals.push({ name: name, cantidad: defectTotalsMap[name] });
  });
  defectTotals.sort(function (a, b) {
    var diff = (Number(b.cantidad) || 0) - (Number(a.cantidad) || 0);
    if (diff !== 0) { return diff; }
    return String(a.name).localeCompare(String(b.name));
  });

  return {
    generatedAt: formatTimestamp_(new Date().toISOString()),
    operationalDay: options.operationalDay || "",
    shiftName: options.shiftName || "",
    supervisor: options.supervisor || "",
    windowLabel: "Acumulado desde inicio de turno" +
      (options.shiftStartedAt ? " (" + formatTimestamp_(options.shiftStartedAt) + ")" : ""),
    totalBoxes: totalBoxes,
    totalAudits: totalAudits,
    rows: rows,
    defectTotals: defectTotals
  };
}

function parseSheetTimestampMs_(value) {
  if (!value) { return 0; }
  if (value instanceof Date) { return value.getTime(); }
  var raw = String(value).trim();
  // dd/MM/yyyy HH:mm:ss
  var m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    return new Date(
      Number(m[3]),
      Number(m[2]) - 1,
      Number(m[1]),
      Number(m[4] || 0),
      Number(m[5] || 0),
      Number(m[6] || 0)
    ).getTime();
  }
  var parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function sendReportEmail_(report, emails) {
  var to = (emails && emails.length ? emails : CONFIG.REPORT_EMAILS).join(",");
  var subject =
    "SOAZ Reporte QC · " +
    (report.shiftName || "Turno") + " · " +
    (report.operationalDay || "") + " · " +
    report.generatedAt;

  var html = buildReportHtml_(report);
  var result = { sent: false, detail: "" };
  try {
    MailApp.sendEmail({
      to: to,
      subject: subject,
      htmlBody: html,
      body: "Reporte SOAZ de inspección de calidad. Abrí este correo en un cliente que soporte HTML."
    });
    result.sent = true;
    result.detail = "Email enviado a " + to;
  } catch (mailError) {
    result.detail = errText_(mailError);
  }

  // También deja una copia en hoja Reportes
  try {
    logReportRow_(report, to, result);
  } catch (ignoreLog) {
  }

  return result;
}

function logReportRow_(report, emails, mailResult) {
  var sheet = getOrCreateSheet_("Reportes", [
    "Timestamp", "Día operativo", "Turno", "Supervisor", "Ventana", "Empacadores", "Cajas c/desv", "Emails", "Resultado"
  ]);
  sheet.appendRow([
    report.generatedAt,
    report.operationalDay,
    report.shiftName,
    report.supervisor,
    report.windowLabel,
    report.rows.length,
    report.totalBoxes,
    emails,
    mailResult.sent ? "OK" : mailResult.detail
  ]);
}

function buildReportHtml_(report) {
  var rows = report.rows || [];
  var byCajas = sortReportRows_(rows, "cajas");
  var byDesv = sortReportRows_(rows, "desv");
  var defectTotals = report.defectTotals || [];

  var cajasRows = buildSimpleMetricRows_(byCajas, "cajas");
  var defectTypeRows = "";
  var summaryRows = "";
  var defectRows = "";
  var i;

  for (i = 0; i < defectTotals.length; i += 1) {
    var d = defectTotals[i];
    defectTypeRows +=
      "<tr>" +
      "<td>" + esc_(d.name) + "</td>" +
      "<td style='text-align:right;'>" + (Number(d.cantidad) || 0) + "</td>" +
      "</tr>";
  }

  for (i = 0; i < byDesv.length; i += 1) {
    var r = byDesv[i];
    summaryRows +=
      "<tr>" +
      "<td>" + esc_(r.code) + "</td>" +
      "<td>" + esc_(r.name) + "</td>" +
      "<td style='text-align:right;'>" + (r.countT != null ? r.countT : "—") + "</td>" +
      "<td style='text-align:right;'>" + r.desv + "</td>" +
      "<td style='text-align:right;'>" + r.pctDesv + "%</td>" +
      "</tr>";

    defectRows +=
      "<tr>" +
      "<td>" + esc_(r.code) + "</td>" +
      "<td>" + esc_(r.name) + "</td>" +
      "<td style='text-align:right;'>" + r.cajas + "</td>" +
      "<td style='text-align:right;'>" + (r.countT != null ? r.countT : "—") + "</td>" +
      "<td style='text-align:right;'>" + (r.desv || 0) + "</td>" +
      "<td style='text-align:right;'>" + fmtDef_(r.defects["Mal Acomodo"]) + "</td>" +
      "<td style='text-align:right;'>" + fmtDef_(r.defects["Pudrición"]) + "</td>" +
      "<td style='text-align:right;'>" + fmtDef_(r.defects["Mal Envuelto"]) + "</td>" +
      "<td style='text-align:right;'>" + fmtDef_(r.defects["Golpe / Tallones"]) + "</td>" +
      "<td style='text-align:right;'>" + fmtDef_(r.defects["Colores Mixtos"]) + "</td>" +
      "<td style='text-align:right;'>" + fmtDef_(r.defects["Calibre Revuelto"]) + "</td>" +
      "<td style='text-align:right;'>" + fmtDef_(r.defects["Mal Pesado"]) + "</td>" +
      "</tr>";
  }

  if (!rows.length) {
    cajasRows = "<tr><td colspan='3'>Sin registros en el turno.</td></tr>";
    defectTypeRows = "<tr><td colspan='2'>Sin registros en el turno.</td></tr>";
    summaryRows = "<tr><td colspan='5'>Sin registros en el turno.</td></tr>";
    defectRows = "<tr><td colspan='12'>Sin registros en el turno.</td></tr>";
  }

  return (
    "<div style='font-family:Arial,sans-serif;color:#111;'>" +
    "<h2 style='margin:0 0 8px;'>SOAZ · Reporte de Inspección</h2>" +
    "<p style='margin:0 0 4px;color:#666;font-size:12px;'>Formato reporte: report-v14 · Acumulado del turno</p>" +
    "<p style='margin:0 0 16px;color:#444;'>" +
    "Generado: <b>" + esc_(report.generatedAt) + "</b><br>" +
    "Día operativo: <b>" + esc_(report.operationalDay || "—") + "</b><br>" +
    "Turno: <b>" + esc_(report.shiftName || "—") + "</b><br>" +
    "Supervisor: <b>" + esc_(report.supervisor || "—") + "</b><br>" +
    "Ventana: <b>" + esc_(report.windowLabel) + "</b>" +
    "</p>" +

    "<h3 style='margin:18px 0 8px;'>Cajas con desviación (mayor a menor)</h3>" +
    "<table cellpadding='6' cellspacing='0' border='1' style='border-collapse:collapse;font-size:13px;'>" +
    "<tr style='background:#f3f4f6;'>" +
    "<th>CODIGO</th><th>NOMBRE</th><th>CAJAS</th>" +
    "</tr>" +
    cajasRows +
    "</table>" +

    "<h3 style='margin:22px 0 8px;'>Resumen por empacador</h3>" +
    "<table cellpadding='6' cellspacing='0' border='1' style='border-collapse:collapse;font-size:13px;'>" +
    "<tr style='background:#f3f4f6;'>" +
    "<th>CODIGO</th><th>NOMBRE</th><th>COUNT T.</th><th>DESV</th><th>%DESV</th>" +
    "</tr>" +
    summaryRows +
    "</table>" +

    "<h3 style='margin:22px 0 8px;'>Cantidad de desviaciones por tipo (mayor a menor)</h3>" +
    "<table cellpadding='6' cellspacing='0' border='1' style='border-collapse:collapse;font-size:13px;'>" +
    "<tr style='background:#f3f4f6;'>" +
    "<th>NOMBRE</th><th>CANTIDAD</th>" +
    "</tr>" +
    defectTypeRows +
    "</table>" +

    "<h3 style='margin:22px 0 8px;'>Detalle por tipo de defecto</h3>" +
    "<table cellpadding='6' cellspacing='0' border='1' style='border-collapse:collapse;font-size:13px;'>" +
    "<tr style='background:#f3f4f6;'>" +
    "<th>CODIGO</th><th>NOMBRE</th><th>CAJAS</th><th>COUNT T.</th><th>DESV</th>" +
    "<th>Mal Acomodo</th><th>Pudrición</th><th>Mal Envuelto</th><th>Golpe / Tallones</th>" +
    "<th>Colores Mixtos</th><th>Calibre Revuelto</th><th>Mal Pesado</th>" +
    "</tr>" +
    defectRows +
    "</table>" +

    "<h3 style='margin:22px 0 8px;'>Leyenda</h3>" +
    "<table cellpadding='6' cellspacing='0' border='1' style='border-collapse:collapse;font-size:13px;'>" +
    "<tr style='background:#f3f4f6;'><th>Abreviatura</th><th>Significado</th></tr>" +
    "<tr><td><b>CAJAS</b></td><td>Número total de cajas que presentan desviaciones / errores</td></tr>" +
    "<tr><td><b>COUNT T.</b></td><td>Cantidad de papayas totales que inspeccionó el empacador</td></tr>" +
    "<tr><td><b>DESV</b></td><td>Cantidad de papayas con error + Mal Pesado (vale 1 por caja)</td></tr>" +
    "<tr><td><b>%DESV</b></td><td>Porcentaje de desviación (DESV / COUNT T.)</td></tr>" +
    "<tr><td><b>CANTIDAD</b></td><td>Total de ocurrencias de cada tipo de desviación en el turno</td></tr>" +
    "</table>" +
    "</div>"
  );
}

function sortReportRows_(rows, key) {
  return (rows || []).slice().sort(function (a, b) {
    var diff = (Number(b[key]) || 0) - (Number(a[key]) || 0);
    if (diff !== 0) { return diff; }
    return String(a.code || "").localeCompare(String(b.code || ""));
  });
}

function buildSimpleMetricRows_(rows, key) {
  var html = "";
  var i;
  for (i = 0; i < rows.length; i += 1) {
    var r = rows[i];
    html +=
      "<tr>" +
      "<td>" + esc_(r.code) + "</td>" +
      "<td>" + esc_(r.name) + "</td>" +
      "<td style='text-align:right;'>" + (Number(r[key]) || 0) + "</td>" +
      "</tr>";
  }
  return html;
}

function fmtDef_(n) {
  return Number(n) > 0 ? String(n) : "-";
}

function esc_(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* =========================================================================
 *  UTILIDADES DE HOJA / FECHA
 * ========================================================================= */

function getSpreadsheet_() {
  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID.indexOf("PEGAR") !== -1) {
    throw new Error("Falta SPREADSHEET_ID en Codigo.gs. Pega el ID de tu hoja.");
  }
  try {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  } catch (openError) {
    throw new Error(
      "No se pudo abrir la hoja con ID " + CONFIG.SPREADSHEET_ID +
      ". Revisa el ID y los permisos. Detalle: " + errText_(openError)
    );
  }
}

function getOrCreateSheet_(name, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (headers && sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function formatTimestamp_(iso) {
  var tz = Session.getScriptTimeZone();
  if (!iso) {
    return Utilities.formatDate(new Date(), tz, "dd/MM/yyyy HH:mm:ss");
  }
  try {
    return Utilities.formatDate(new Date(iso), tz, "dd/MM/yyyy HH:mm:ss");
  } catch (error) {
    return String(iso);
  }
}

function getOperationalDayKey_(date) {
  var reference = new Date(date.getTime());
  if (reference.getHours() < 16) {
    reference.setDate(reference.getDate() - 1);
  }
  return Utilities.formatDate(reference, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

/* =========================================================================
 *  PRUEBAS MANUALES (ejecuta desde el editor)
 * ========================================================================= */

function testAuthenticate() {
  Logger.log(JSON.stringify(handleAuthenticate_({ supervisor: "Prueba", password: "Chula2025" })));
}

function testDetailed() {
  var auth = handleAuthenticate_({ supervisor: "Prueba", password: "Chula2025" });
  var result = executeAction_({
    action: "register_detailed_inspection",
    token: auth.token,
    auditId: "audit_" + Date.now(),
    recordId: "rec_" + Date.now(),
    timestamp: new Date().toISOString(),
    operationalDay: getOperationalDayKey_(new Date()),
    supervisor: "Prueba",
    packerCode: "E001",
    packerName: "Ana Ruiz",
    count: 8,
    assigned: 5,
    buenas: 3,
    countsAsError: true,
    summary: "Pudrición 3 · Mal Envuelto 2 · Mal Pesado (Peso ↓)",
    rows: [
      { defecto: "Pudrición", variante: "", cantidad: 3, malPesado: "" },
      { defecto: "Mal Envuelto", variante: "", cantidad: 2, malPesado: "" },
      { defecto: "Mal Pesado", variante: "Peso ↓", cantidad: 0, malPesado: "Peso ↓" }
    ]
  });
  Logger.log(JSON.stringify(result));
}
