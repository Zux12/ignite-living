// Build privately from reviewed deployed source. Never commit the output directory.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const [source, output] = process.argv.slice(2);
if (!source || !output || path.resolve(source) === path.resolve(output))
  throw Error(
    "Usage: node scripts/build-admin-api.cjs PRIVATE_SOURCE PRIVATE_OUTPUT",
  );
const repo = path.join(__dirname, "..");
const hashes = {
  "ManageStay.gs":
    "1bed79e7e5fc54c89ef241edac959738875afca6b77e2be53de8ceb42f26ea75",
  "PaymentReview.gs":
    "f530d0a9e4d2ffcc5ec49fb0cecc28a0fc0041c99b697829f7bac761a4762b7c",
};
for (const [name, expected] of Object.entries(hashes)) {
  if (
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(source, name)))
      .digest("hex") !== expected
  )
    throw Error(name + " changed; review before applying this patch.");
}
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
for (const name of fs.readdirSync(source))
  if (/\.gs$|^appsscript\.json$/.test(name))
    fs.copyFileSync(path.join(source, name), path.join(output, name));
function patch(name, before, after) {
  const file = path.join(output, name),
    text = fs.readFileSync(file, "utf8");
  if (text.split(before).length !== 2)
    throw Error("Patch target differs: " + name);
  fs.writeFileSync(file, text.replace(before, after), { mode: 0o600 });
}
patch(
  "ManageStay.gs",
  "  if (!String(input.action||'').startsWith('stay.')) return bookingDoPost_(e);",
  "  if (String(input.action||'').startsWith('admin.')) return adminDoPost_(input);\n  if (!String(input.action||'').startsWith('stay.')) return bookingDoPost_(e);",
);
patch(
  "PaymentReview.gs",
  " const email=Session.getActiveUser().getEmail().trim().toLowerCase();",
  " const adminEmail=typeof aaOwnerEmail_==='function'?aaOwnerEmail_():'';\n const email=adminEmail||Session.getActiveUser().getEmail().trim().toLowerCase();",
);
fs.copyFileSync(
  path.join(repo, "backend/AdminApi.gs"),
  path.join(output, "AdminApi.gs"),
);
const forgePackage = require("node-forge/package.json");
if (forgePackage.version !== "1.4.3")
  throw Error("Review changes before upgrading the verifier dependency.");
const forge = fs.readFileSync(
  path.join(repo, "node_modules/node-forge/dist/forge.min.js"),
  "utf8",
);
const license = fs.readFileSync(
  path.join(repo, "node_modules/node-forge/LICENSE"),
  "utf8",
);
// Only public-key signature verification is used. No browser crypto/randomness APIs.
const vendor =
  "// node-forge 1.4.3, generated from the package-lock pinned npm package.\n/*\n" +
  license +
  "\n*/\nvar aaForgeLibrary_;\nfunction aaForgeLib_(){if(!aaForgeLibrary_){aaForgeLibrary_=(function(){var window={};\n" +
  forge +
  "\nreturn window.forge;})();}return aaForgeLibrary_;}\n";
fs.writeFileSync(path.join(output, "VendorForge.gs"), vendor, { mode: 0o600 });
console.log(
  "Prepared AdminApi.gs, VendorForge.gs and two narrow routing/auth patches. Original source unchanged.",
);
