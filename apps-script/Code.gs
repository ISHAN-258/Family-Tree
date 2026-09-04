/**
 * Parivar Vriksh — Apps Script backend
 * ------------------------------------
 * Paste this whole file into script.google.com (Extensions > Apps Script,
 * opened FROM inside your Google Sheet so it's bound to it).
 *
 * SHEET column order (row 1 headers — created automatically if the sheet
 * is empty when this first runs):
 * Timestamp | Name | RelationshipType | RelatedTo | DOB | Marriage | ImageLink | Bio
 *
 * Deploy: Deploy > New deployment > type "Web app"
 *   Execute as: Me
 *   Who has access: Anyone
 * Copy the /exec URL it gives you — that's APPS_SCRIPT_URL in app.js.
 */

var SHEET_NAME = "Sheet1"; // change if your tab is named differently
var HEADERS = ["Timestamp", "Name", "RelationshipType", "RelatedTo", "DOB", "Marriage", "ImageLink", "Bio"];
var PHOTO_FOLDER_NAME = "Parivar Vriksh Photos"; // uploaded photos are saved here in Drive

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    // Force DOB (E) and Marriage (F) to plain text so Sheets doesn't
    // auto-convert form dates into Date cells (which shifts by timezone
    // and reads back differently than what was typed).
    sh.getRange("E:F").setNumberFormat("@");
  }
  return sh;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function cellToText_(v) {
  if (Object.prototype.toString.call(v) === "[object Date]") {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return v;
}

// GET — returns all rows as an array of objects, for the site to render.
function doGet(e) {
  var sh = getSheet_();
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return jsonOut_({ ok: true, rows: [] });
  var headers = values[0];
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = cellToText_(values[r][c]);
    if (obj.Name) rows.push(obj);
  }
  return jsonOut_({ ok: true, rows: rows });
}

function getPhotoFolder_() {
  var it = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
}

// Decodes the browser-sent base64 photo, saves it in Drive, makes it
// link-viewable, and returns a URL that works directly in an <img src>.
function saveImage_(base64, mime, nameHint) {
  if (!base64) return "";
  try {
    var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime || "image/jpeg", (nameHint || "photo") + ".jpg");
    var file = getPhotoFolder_().createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w500";
  } catch (err) {
    return ""; // upload failed — submission still goes through, just without a photo
  }
}

// POST — appends one submission from the site's inline form.
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (!data.name || !data.relationshipType || !data.relatedTo) {
      return jsonOut_({ ok: false, error: "Name, Relationship Type, and Related To are required." });
    }
    var imgUrl = saveImage_(data.imgBase64, data.imgMime, data.name);
    var sh = getSheet_();
    sh.appendRow([
      new Date(),
      String(data.name).trim(),
      String(data.relationshipType).trim(),
      String(data.relatedTo).trim(),
      data.dob ? String(data.dob).trim() : "",
      data.marriage ? String(data.marriage).trim() : "",
      imgUrl,
      data.bio ? String(data.bio).trim() : ""
    ]);
    return jsonOut_({ ok: true });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}
