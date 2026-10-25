const path = require("node:path");

/**
 * electron-builder's own rcedit path downloads winCodeSign, which requires
 * symlink privileges on Windows. We keep `signAndEditExecutable: false` for
 * signing, but still embed the app icon + Windows version metadata here.
 */
module.exports = async (context) => {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const exePath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`
  );
  const iconPath = path.join(__dirname, "..", "resources", "icon.ico");
  const version = context.packager.appInfo.version;
  const { rcedit } = await import("rcedit");

  await rcedit(exePath, {
    icon: iconPath,
    "file-version": version,
    "product-version": version,
    "version-string": {
      CompanyName: "File Pilot",
      FileDescription: "File Pilot",
      ProductName: "File Pilot",
      LegalCopyright: "File Pilot"
    }
  });
  console.log(`[after-pack] embedded icon and version metadata: ${exePath}`);
};
