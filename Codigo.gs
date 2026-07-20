/**
 * SOAZ - Inspección de Calidad
 * Backend Google Apps Script para Google Sheets + alertas por email.
 *
 * INSTRUCCIONES:
 * 1. Borra TODO el contenido actual de Código.gs (el service worker no va aquí).
 * 2. Pega este archivo completo.
 * 3. Si el script NO está vinculado a la hoja, pega el ID de tu Sheet abajo.
 * 4. Guarda > Implementar > Nueva implementación > Aplicación web
 *    - Ejecutar como: Yo
 *    - Quién tiene acceso: Cualquier persona
 * 5. Copia la nueva URL /exec y pégala en index.html (apiBaseUrl) si cambió.
 */

var CONFIG = {
  // OBLIGATORIO para la app web: ID de TU hoja nueva
  // URL: https://docs.google.com/spreadsheets/d/ESTE_ID/edit
  SPREADSHEET_ID: "1UXPcDJ29IUgArsHMn2HonzYho3Da3eXxYssYd3FVh9c",
  SHEET_INSPECTIONS: "Inspecciones",
  SHEET_ALERTS: "Alertas",
  SHEET_PACKERS: "Empacadores",
  DAY_BLOCK_WIDTH: 8,
  DEFAULT_ALERT_EMAILS: ["calidad@soaz.com", "supervision@soaz.com"]
};

function doGet(e) {
  try {
    var result;
    if (e && e.parameter && e.parameter.payload) {
      var getPayload = JSON.parse(e.parameter.payload);
      if (getPayload.action !== "list_packers") {
        logIncoming_("doGet", e.parameter.payload);
      }
      result = executeAction_(getPayload);
    } else {
      result = {
        ok: true,
        service: "SOAZ Inspección de Calidad",
        message: "API activa. Listo para inspecciones, alertas y empacadores."
      };
    }
    return respondWithMaybeJsonp_(e, result);
  } catch (error) {
    logIncoming_("doGet-error", String(error && error.message ? error.message : error));
    return respondWithMaybeJsonp_(e, {
      ok: false,
      error: String(error && error.message ? error.message : error)
    });
  }
}

function doPost(e) {
  try {
    var payload = parseIncomingPayload_(e);
    if (payload.action !== "list_packers") {
      logIncoming_("doPost", JSON.stringify(payload));
    }
    return respondWithMaybeJsonp_(e, executeAction_(payload));
  } catch (error) {
    logIncoming_("doPost-error", String(error && error.message ? error.message : error));
    return respondWithMaybeJsonp_(e, {
      ok: false,
      error: String(error && error.message ? error.message : error)
    });
  }
}

function respondWithMaybeJsonp_(e, obj) {
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

function executeAction_(payload) {
  var action = payload.action || "register_inspection";

  if (action === "send_alert") {
    return handleSendAlert(payload);
  }
  if (action === "register_inspection") {
    return handleRegisterInspection(payload);
  }
  if (action === "list_packers") {
    return handleListPackers();
  }
  if (action === "upsert_packer") {
    return handleUpsertPacker(payload);
  }
  if (action === "delete_packer") {
    return handleDeletePacker(payload);
  }
  if (action === "open_shift") {
    return handleOpenShift(payload);
  }

  return { ok: false, error: "Acción no reconocida: " + action };
}

function processPayload_(payload) {
  return respondWithMaybeJsonp_({}, executeAction_(payload));
}

/**
 * Soporta:
 * 1) Formulario HTML: campo "payload" (recomendado desde la web)
 * 2) JSON puro en postData (fetch)
 * 3) Query string ?payload=...
 */
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

function logIncoming_(source, raw) {
  try {
    var ss = getSpreadsheet();
    var sheet = getOrCreateSheet_(ss, "Log");
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Timestamp", "Origen", "Datos"]);
      sheet.getRange(1, 1, 1, 3).setFontWeight("bold");
    }
    sheet.appendRow([
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss"),
      source,
      String(raw).substring(0, 45000)
    ]);
  } catch (ignoreLog) {
  }
}

function ensurePackersSheet_() {
  var ss = getSpreadsheet();
  var sheet = getOrCreateSheet_(ss, CONFIG.SHEET_PACKERS);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Código", "Nombre", "Activo"]);
    sheet.getRange(1, 1, 1, 3).setFontWeight("bold");
  }
  return sheet;
}

function readPackersFromSheet_() {
  var sheet = ensurePackersSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }

  var values = sheet.getRange(2, 1, lastRow, 3).getValues();
  var packers = [];
  var i;
  for (i = 0; i < values.length; i += 1) {
    var code = String(values[i][0] || "").trim().toUpperCase();
    var name = String(values[i][1] || "").trim();
    if (!code) {
      continue;
    }
    var activeRaw = values[i][2];
    var active = !(activeRaw === false || activeRaw === "FALSE" || activeRaw === "false" || activeRaw === 0 || activeRaw === "0");
    packers.push({
      code: code,
      name: name || code,
      active: active
    });
  }

  packers.sort(function (a, b) {
    return a.code.localeCompare(b.code);
  });
  return packers;
}

function handleListPackers() {
  return {
    ok: true,
    action: "list_packers",
    packers: readPackersFromSheet_()
  };
}

function handleUpsertPacker(payload) {
  var packer = payload.packer || {};
  var code = String(packer.code || payload.packerCode || "").trim().toUpperCase();
  var name = String(packer.name || payload.packerName || "").trim();
  var active = packer.active !== false && packer.active !== "FALSE" && packer.active !== "false";

  if (!code || !name) {
    return { ok: false, error: "Código y nombre del empacador son obligatorios" };
  }

  var sheet = ensurePackersSheet_();
  var lastRow = sheet.getLastRow();
  var foundRow = -1;

  if (lastRow >= 2) {
    var codes = sheet.getRange(2, 1, lastRow, 1).getValues();
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

function handleDeletePacker(payload) {
  var code = String(payload.packerCode || (payload.packer && payload.packer.code) || "").trim().toUpperCase();
  if (!code) {
    return { ok: false, error: "Falta packerCode" };
  }

  var sheet = ensurePackersSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { ok: true, action: "delete_packer", deleted: false, packers: [] };
  }

  var codes = sheet.getRange(2, 1, lastRow, 1).getValues();
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

function handleRegisterInspection(payload) {
  var ss = getSpreadsheet();
  var sheet = getOrCreateSheet_(ss, CONFIG.SHEET_INSPECTIONS);
  var operationalDay = payload.operationalDay || getOperationalDayKey_(new Date());
  var block = ensureDayBlock_(sheet, operationalDay);

  var detailText = buildDetailsText_(payload.details || {});
  var rowValues = [
    formatTimestamp_(payload.timestamp),
    payload.supervisor || "",
    payload.defectLabel || payload.defectId || "",
    detailText,
    payload.summary || "",
    payload.packerCode || "",
    payload.packerName || "",
    payload.recordId || ""
  ];

  var nextRow = findNextEmptyRowInBlock_(sheet, block.startCol, block.headerRow + 1, CONFIG.DAY_BLOCK_WIDTH);
  sheet.getRange(nextRow, block.startCol, 1, CONFIG.DAY_BLOCK_WIDTH).setValues([rowValues]);

  return {
    ok: true,
    action: "register_inspection",
    operationalDay: operationalDay,
    row: nextRow,
    startCol: block.startCol
  };
}

/**
 * Marca visualmente el inicio de un nuevo turno:
 * 1 fila en blanco + 1 fila "CAMBIO DE TURNO" resaltada.
 */
function handleOpenShift(payload) {
  var ss = getSpreadsheet();
  var sheet = getOrCreateSheet_(ss, CONFIG.SHEET_INSPECTIONS);
  var operationalDay = payload.operationalDay || getOperationalDayKey_(new Date());
  var block = ensureDayBlock_(sheet, operationalDay);
  var nextRow = findNextEmptyRowInBlock_(sheet, block.startCol, block.headerRow + 1, CONFIG.DAY_BLOCK_WIDTH);

  // Si ya hay datos debajo del encabezado, deja una fila vacía de separación
  if (nextRow > block.headerRow + 1) {
    sheet.getRange(nextRow, block.startCol, 1, CONFIG.DAY_BLOCK_WIDTH).clearContent();
    nextRow += 1;
  }

  var markerRow = [
    formatTimestamp_(payload.timestamp),
    payload.supervisor || "",
    "—— CAMBIO DE TURNO ——",
    "Nuevo turno iniciado",
    "Empacadores en turno: " + (payload.activePackerCount || (payload.activePackerCodes || []).length || 0),
    "",
    "",
    payload.shiftStartedAt || ""
  ];

  var range = sheet.getRange(nextRow, block.startCol, 1, CONFIG.DAY_BLOCK_WIDTH);
  range.setValues([markerRow]);
  range.setFontWeight("bold");
  range.setBackground("#fff3cd");

  return {
    ok: true,
    action: "open_shift",
    operationalDay: operationalDay,
    row: nextRow,
    startCol: block.startCol
  };
}

function handleSendAlert(payload) {
  var ss = getSpreadsheet();
  var sheet = getOrCreateSheet_(ss, CONFIG.SHEET_ALERTS);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Timestamp",
      "Día operativo",
      "Supervisor",
      "Código empacador",
      "Nombre empacador",
      "Error 1",
      "Error 2",
      "Error 3",
      "Emails",
      "Alert ID"
    ]);
    sheet.getRange(1, 1, 1, 10).setFontWeight("bold");
  }

  var errors = payload.errors || [];
  var emails = payload.emails && payload.emails.length ? payload.emails : CONFIG.DEFAULT_ALERT_EMAILS;

  sheet.appendRow([
    formatTimestamp_(payload.timestamp),
    payload.operationalDay || "",
    payload.supervisor || "",
    payload.packerCode || "",
    payload.packerName || "",
    errors[0] || "",
    errors[1] || "",
    errors[2] || "",
    emails.join(", "),
    payload.alertId || ""
  ]);

  var subject = "SOAZ ALERTA · 3 errores · Empacador " + (payload.packerCode || "");
  var body =
    "Alerta automática del Módulo de Inspección de Calidad SOAZ\n\n" +
    "Supervisor: " + (payload.supervisor || "—") + "\n" +
    "Día operativo: " + (payload.operationalDay || "—") + "\n" +
    "Empacador: " + (payload.packerCode || "—") + " (" + (payload.packerName || "—") + ")\n\n" +
    "Errores acumulados:\n" +
    "1. " + (errors[0] || "—") + "\n" +
    "2. " + (errors[1] || "—") + "\n" +
    "3. " + (errors[2] || "—") + "\n\n" +
    "Alert ID: " + (payload.alertId || "—") + "\n";

  var emailResult = { sent: false, detail: "" };
  try {
    MailApp.sendEmail({
      to: emails.join(","),
      subject: subject,
      body: body
    });
    emailResult.sent = true;
    emailResult.detail = "Email enviado";
  } catch (mailError) {
    emailResult.sent = false;
    emailResult.detail = String(mailError && mailError.message ? mailError.message : mailError);
  }

  return {
    ok: true,
    action: "send_alert",
    email: emailResult
  };
}

function getSpreadsheet() {
  // En Aplicación Web, getActiveSpreadsheet() casi siempre es null.
  // Hay que abrir la hoja por ID.
  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID.indexOf("PEGAR") !== -1) {
    throw new Error("Falta SPREADSHEET_ID en Codigo.gs. Pega el ID de tu hoja nueva.");
  }

  try {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  } catch (openError) {
    throw new Error(
      "No se pudo abrir la hoja con ID " + CONFIG.SPREADSHEET_ID +
      ". Revisa que el ID sea de TU hoja nueva y que el script tenga permiso. Detalle: " +
      String(openError && openError.message ? openError.message : openError)
    );
  }
}

function getOrCreateSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

/**
 * Busca o crea un bloque de columnas para el día operativo.
 * Bloques: col 1-8, 9-16, 17-24, ...
 * Fila 1: Día Operativo | YYYY-MM-DD
 * Fila 2: encabezados
 * Fila 3+: registros apilados hacia abajo
 */
function ensureDayBlock_(sheet, operationalDay) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var totalBlocks = Math.ceil(lastCol / CONFIG.DAY_BLOCK_WIDTH);
  if (totalBlocks < 1) {
    totalBlocks = 1;
  }

  var b;
  for (b = 0; b < totalBlocks; b++) {
    var startCol = b * CONFIG.DAY_BLOCK_WIDTH + 1;
    var dayCell = sheet.getRange(1, startCol + 1).getDisplayValue();
    var labelCell = sheet.getRange(1, startCol).getDisplayValue();

    if (String(dayCell).trim() === String(operationalDay).trim()) {
      return { startCol: startCol, headerRow: 2 };
    }

    if (!labelCell && !dayCell) {
      writeDayBlockHeader_(sheet, startCol, operationalDay);
      return { startCol: startCol, headerRow: 2 };
    }
  }

  var newStart = totalBlocks * CONFIG.DAY_BLOCK_WIDTH + 1;
  writeDayBlockHeader_(sheet, newStart, operationalDay);
  return { startCol: newStart, headerRow: 2 };
}

function writeDayBlockHeader_(sheet, startCol, operationalDay) {
  sheet.getRange(1, startCol).setValue("Día Operativo");
  sheet.getRange(1, startCol + 1).setValue(operationalDay);
  sheet.getRange(1, startCol, 1, 2).setFontWeight("bold");

  var headers = [
    "Hora",
    "Supervisor",
    "Defecto",
    "Detalle",
    "Resumen",
    "Código Empacador",
    "Nombre Empacador",
    "Record ID"
  ];
  sheet.getRange(2, startCol, 1, CONFIG.DAY_BLOCK_WIDTH).setValues([headers]);
  sheet.getRange(2, startCol, 1, CONFIG.DAY_BLOCK_WIDTH).setFontWeight("bold");
}

function findNextEmptyRowInBlock_(sheet, startCol, startRow, width) {
  var maxRows = Math.max(sheet.getMaxRows(), startRow + 50);
  var values = sheet.getRange(startRow, startCol, maxRows - startRow + 1, width).getValues();
  var i;
  for (i = 0; i < values.length; i++) {
    var empty = true;
    var c;
    for (c = 0; c < values[i].length; c++) {
      if (values[i][c] !== "" && values[i][c] !== null) {
        empty = false;
        break;
      }
    }
    if (empty) {
      return startRow + i;
    }
  }
  return startRow + values.length;
}

function buildDetailsText_(details) {
  var parts = [];
  if (details.peso) {
    parts.push("Peso: " + details.peso);
  }
  if (details.calibrePredominante) {
    parts.push("Calibre pred: " + details.calibrePredominante);
  }
  if (details.calibreMezclado) {
    parts.push("Calibre mezclado: " + details.calibreMezclado);
  }
  if (details.colorPredominante) {
    parts.push("Color pred: " + details.colorPredominante);
  }
  if (details.colorMezclado) {
    parts.push("Color mezclado: " + details.colorMezclado);
  }
  return parts.join(" | ");
}

function formatTimestamp_(iso) {
  if (!iso) {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");
  }
  try {
    return Utilities.formatDate(new Date(iso), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss");
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

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Prueba manual desde el editor:
 * Selecciona testRegisterInspection y pulsa Ejecutar.
 */
function testRegisterInspection() {
  var sample = {
    action: "register_inspection",
    recordId: "test_" + new Date().getTime(),
    timestamp: new Date().toISOString(),
    operationalDay: getOperationalDayKey_(new Date()),
    supervisor: "Prueba Supervisor",
    defectId: "mal_pesado",
    defectLabel: "Mal Pesado",
    details: { peso: "Peso ↑" },
    summary: "Mal Pesado · Peso ↑",
    packerCode: "E001",
    packerName: "Ana Ruiz"
  };
  var result = handleRegisterInspection(sample);
  Logger.log(JSON.stringify(result));
}
