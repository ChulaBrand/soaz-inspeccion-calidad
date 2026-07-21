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

  // OBLIGATORIO: ID de TU hoja. URL: https://docs.google.com/spreadsheets/d/ESTE_ID/edit
  SPREADSHEET_ID: "1U31X4I7eGsxDd7OLRjpw75jlQH6wXfABv4mN0HcA5mc",

  // Correos que reciben la alerta de 3 errores.
  ALERT_EMAILS: ["calidad@soaz.com", "supervision@soaz.com"],

  // Vigencia del token de sesión (horas).
  SESSION_HOURS: 12,

  // Nombres de hojas.
  SHEET_SIMPLE: "Inspecciones Simples",
  SHEET_DETAILED: "Inspecciones Detalladas",
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
  detailed: [
    "Audit ID", "Timestamp", "Día operativo", "Inicio de turno", "Supervisor",
    "Código empacador", "Nombre empacador", "Count", "Papayas con defecto",
    "Papayas buenas", "Defecto", "Variante", "Cantidad", "Mal pesado",
    "Resumen", "Record ID"
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
        message: "API activa. Lista para autenticación, inspecciones y empacadores."
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

var PUBLIC_ACTIONS = { authenticate: true };

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
    default: return { ok: false, error: "Acción no reconocida: " + action };
  }
}

/* =========================================================================
 *  AUTENTICACIÓN + TOKENS
 * ========================================================================= */

function handleAuthenticate_(payload) {
  var password = String(payload.password || "");
  var supervisor = String(payload.supervisor || "").trim();

  if (!supervisor) {
    return { ok: false, error: "Nombre del supervisor obligatorio" };
  }
  if (password !== CONFIG.APP_PASSWORD) {
    return { ok: false, error: "Contraseña incorrecta" };
  }

  var token = createSession_(supervisor);
  return { ok: true, token: token, supervisor: supervisor };
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
 *  INSPECCIONES DETALLADAS (una fila por defecto/grupo)
 * ========================================================================= */

function handleRegisterDetailed_(payload) {
  var sheet = getOrCreateSheet_(CONFIG.SHEET_DETAILED, HEADERS.detailed);
  var operationalDay = payload.operationalDay || getOperationalDayKey_(new Date());
  var supervisor = payload.supervisor || payload._supervisorFromToken || "";
  var rows = payload.rows && payload.rows.length ? payload.rows : [{
    defecto: "Sin fruta desviada", variante: "", cantidad: 0, malPesado: ""
  }];

  var ts = formatTimestamp_(payload.timestamp);
  var output = [];
  var i;
  for (i = 0; i < rows.length; i += 1) {
    var r = rows[i];
    output.push([
      payload.auditId || "",
      ts,
      operationalDay,
      payload.shiftStartedAt || "",
      supervisor,
      payload.packerCode || "",
      payload.packerName || "",
      payload.count != null ? payload.count : "",
      payload.assigned != null ? payload.assigned : "",
      payload.buenas != null ? payload.buenas : "",
      r.defecto || "",
      r.variante || "",
      (r.cantidad != null ? r.cantidad : ""),
      r.malPesado || "",
      payload.summary || "",
      payload.recordId || ""
    ]);
  }

  var startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, output.length, HEADERS.detailed.length).setValues(output);

  bumpSummary_(operationalDay, payload.packerCode, payload.packerName, payload.countsAsError);

  return { ok: true, action: "register_detailed_inspection", operationalDay: operationalDay, rows: output.length };
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
  var emails = payload.emails && payload.emails.length ? payload.emails : CONFIG.ALERT_EMAILS;
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
    ? getOrCreateSheet_(CONFIG.SHEET_DETAILED, HEADERS.detailed)
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
  if (width > 1) markerRow[1] = "Supervisor: " + (payload.supervisor || payload._supervisorFromToken || "");
  if (width > 2) markerRow[2] = "Día operativo: " + operationalDay;
  if (width > 3) markerRow[3] = "Modo: " + mode;
  if (width > 4) markerRow[4] = "Empacadores: " + (payload.activePackerCount || 0);
  if (width > 5) markerRow[5] = formatTimestamp_(payload.timestamp);

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

  var markerRow = new Array(width).fill("");
  markerRow[0] = "—— CIERRE DE TURNO ——";
  if (width > 1) markerRow[1] = "Supervisor: " + (payload.supervisor || payload._supervisorFromToken || "");
  if (width > 2) markerRow[2] = "Día operativo: " + (payload.operationalDay || getOperationalDayKey_(new Date()));
  if (width > 5) markerRow[5] = formatTimestamp_(payload.timestamp);

  sheet.appendRow(markerRow);
  var idx = sheet.getLastRow();
  var range = sheet.getRange(idx, 1, 1, width);
  range.setFontWeight("bold");
  range.setBackground("#e2e8f0");

  return { ok: true, action: "close_shift", mode: mode };
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
    assigned: 3,
    buenas: 5,
    countsAsError: true,
    summary: "Fruta desviada: 3",
    rows: [{ defecto: "Fruta desviada", variante: "", cantidad: 3, malPesado: "" }]
  });
  Logger.log(JSON.stringify(result));
}
