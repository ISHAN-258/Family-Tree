# Parivar Vriksh — Family Tree

Static site. No backend, no build step. Family fills a Google Form → their
entry appears on this page automatically.

## Setup (do this before sharing the link)

### 1. Fill the 5 seed members
Open `js/app.js`, top section `SEED_MEMBERS`. Add each person's `name` and
optional `img` (photo URL). Leave `name` blank and only the role label
(Great-Grandfather, Grandfather, …) will show. Adjust `SEED_RELS` if your
chain isn't a straight line.

### 2. Create the Google Form
Fields, in this order:
1. **Name** (short answer, required)
2. **Photo Link** (short answer — a public image URL, e.g. a Google Photos
   or Drive "anyone with link" share URL, or any direct image link)
3. **Relation Type** (dropdown): `Child of`, `Parent of`, `Spouse of`, `Sibling of`
4. **Related To** (short answer — the *exact* name of an existing person in
   the tree, e.g. one of your 5 seed members, or anyone already added)

### 3. Connect the Form to a Sheet
In the Form, go to **Responses → link to Sheets** to create a response
Sheet.

### 4. Publish the Sheet as CSV
In the Sheet: **File → Share → Publish to web** → select the response
tab → format **CSV** → Publish. Copy the link it gives you.

### 5. Paste both links into `js/app.js`
```js
var SHEET_CSV_URL = "PASTE_PUBLISHED_CSV_LINK_HERE";
var FORM_URL       = "PASTE_YOUR_GOOGLE_FORM_LINK_HERE";
```

### 6. Deploy
Push this folder to a GitHub repo → **Settings → Pages** → deploy from
`main` branch, root. Share the resulting URL (or the Form link directly)
on WhatsApp.

## How matching works
Every submission's **Related To** name is matched, exact and case-insensitive,
against names already in the tree (seed members + earlier approved
submissions). No match → the entry shows up in the **Pending** section on
the page instead of vanishing, so you can fix a typo in the Sheet and hit
Refresh.

## Notes
- Data lives in your Google Sheet — nothing is stored on the page itself.
- Refresh button re-fetches the CSV; the page also fetches once on load.
- Works fully responsive down to mobile (this is how most family will open
  it, from the WhatsApp link).
- No real names are hardcoded in this build — `SEED_MEMBERS` ships blank.
