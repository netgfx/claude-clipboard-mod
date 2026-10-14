// Clipboard readers, one per platform. Each one writes what it finds into the
// capture folder and prints one JSON line:
//   { items: [{ kind, path?, detail? }], reason?: string, url?: string }
// kind is 'image' | 'file' | 'folder'. `url` means the clipboard held a web
// address; register.js downloads it with curl. No $ calls here: these are
// plain strings, so the hooks module stays the only place that touches $.

// Windows PowerShell 5.1 (ships with every Windows). Run with -STA: the
// clipboard API needs a single-threaded apartment. $dir and $base are
// prepended by register.js as single-quoted literals.
export const WINDOWS_READER = `
$ErrorActionPreference = 'Stop'
# Otherwise "Preparing modules for first use" arrives as CLIXML on stdout
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function Done($items, $reason, $url) {
  $o = [ordered]@{ items = @($items); reason = $reason; url = $url }
  ConvertTo-Json -InputObject $o -Compress -Depth 4
  exit 0
}
function MakeItem($kind, $path, $detail) { [ordered]@{ kind = $kind; path = $path; detail = $detail } }
function PathItem($p) {
  $it = Get-Item -LiteralPath $p -Force
  if ($it.PSIsContainer) { MakeItem 'folder' $it.FullName '' } else { MakeItem 'file' $it.FullName ('' + $it.Length) }
}
function Size($p) {
  try { $i = [Drawing.Image]::FromFile($p); $s = '' + $i.Width + 'x' + $i.Height; $i.Dispose(); $s } catch { '' }
}
function ExtOf($mime) {
  switch ($mime.ToLower()) {
    'image/png' { '.png' } 'image/jpeg' { '.jpg' } 'image/gif' { '.gif' } 'image/webp' { '.webp' }
    'image/bmp' { '.bmp' } 'image/svg+xml' { '.svg' } 'application/pdf' { '.pdf' }
    'video/mp4' { '.mp4' } 'video/webm' { '.webm' } 'audio/mpeg' { '.mp3' } 'audio/wav' { '.wav' }
    default { '.bin' }
  }
}
try {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $ignore = Join-Path $dir '.gitignore'
  if (-not (Test-Path -LiteralPath $ignore)) { [IO.File]::WriteAllText($ignore, '*' + [Environment]::NewLine) }

  $data = [Windows.Forms.Clipboard]::GetDataObject()
  if ($null -eq $data) { Done @() 'The clipboard is empty.' $null }

  # Files copied in Explorer (or a browser download list)
  if ($data.GetDataPresent([Windows.Forms.DataFormats]::FileDrop)) {
    $list = @()
    foreach ($f in $data.GetData([Windows.Forms.DataFormats]::FileDrop)) { $list += PathItem $f }
    Done $list $null $null
  }

  $png = Join-Path $dir ($base + '.png')
  # Browsers put a lossless PNG stream next to the bitmap: keeps transparency
  if ($data.GetDataPresent('PNG')) {
    $s = $data.GetData('PNG')
    if ($s -is [IO.Stream]) {
      $fs = [IO.File]::Create($png)
      try { $s.Position = 0; $s.CopyTo($fs) } finally { $fs.Dispose() }
      Done @(MakeItem 'image' $png (Size $png)) $null $null
    }
  }
  # Screenshots (Win+Shift+S, PrtScn) and other apps put a plain bitmap
  if ([Windows.Forms.Clipboard]::ContainsImage()) {
    $img = [Windows.Forms.Clipboard]::GetImage()
    $img.Save($png, [Drawing.Imaging.ImageFormat]::Png)
    $size = '' + $img.Width + 'x' + $img.Height
    $img.Dispose()
    Done @(MakeItem 'image' $png $size) $null $null
  }

  if ([Windows.Forms.Clipboard]::ContainsText()) {
    $t = [Windows.Forms.Clipboard]::GetText().Trim().Trim('"')
    if ($t.Length -gt 0 -and $t.Length -lt 2048 -and $t -notmatch '[\\r\\n]' -and (Test-Path -LiteralPath $t)) {
      Done @(PathItem $t) $null $null
    }
    if ($t -match '^data:([\\w.+-]+/[\\w.+-]+);base64,(.+)$') {
      $mime = $Matches[1]
      $p = Join-Path $dir ($base + (ExtOf $mime))
      [IO.File]::WriteAllBytes($p, [Convert]::FromBase64String($Matches[2]))
      if ($mime -like 'image/*') { Done @(MakeItem 'image' $p (Size $p)) $null $null }
      Done @(MakeItem 'file' $p '') $null $null
    }
    if ($t -match '^https?://\\S+$') { Done @() $null $t }
    Done @() 'The clipboard holds text, not an image, file or media. Paste text with Ctrl+V.' $null
  }
  Done @() 'Nothing on the clipboard can be attached (no image, file or media).' $null
} catch {
  Done @() ('Could not read the clipboard: ' + $_.Exception.Message) $null
}
`

// macOS: JavaScript for Automation with the AppKit bridge. Arguments arrive
// in run(argv), so nothing user-controlled is spliced into the source.
export const MAC_READER = `
ObjC.import('AppKit');
function run(argv) {
  var dir = argv[0], base = argv[1];
  var fm = $.NSFileManager.defaultManager;
  var pb = $.NSPasteboard.generalPasteboard;
  function done(items, reason, url) { return JSON.stringify({ items: items, reason: reason || null, url: url || null }); }
  function pathItem(p) {
    var isDir = Ref();
    fm.fileExistsAtPathIsDirectory(p, isDir);
    return { kind: isDir[0] ? 'folder' : 'file', path: p };
  }
  fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(dir, true, $(), $());
  var ignore = dir + '/.gitignore';
  if (!fm.fileExistsAtPath(ignore)) $('*\\n').writeToFileAtomicallyEncodingError(ignore, true, $.NSUTF8StringEncoding, $());

  var opts = $.NSDictionary.dictionaryWithObjectForKey($.NSNumber.numberWithBool(true), $.NSPasteboardURLReadingFileURLsOnlyKey);
  var urls = pb.readObjectsForClassesOptions($.NSArray.arrayWithObject($.NSURL), opts);
  if (urls && !urls.isNil() && urls.count > 0) {
    var items = [];
    for (var i = 0; i < urls.count; i++) items.push(pathItem(ObjC.unwrap(urls.objectAtIndex(i).path)));
    return done(items);
  }

  var png = dir + '/' + base + '.png';
  var data = pb.dataForType($.NSPasteboardTypePNG);
  if (data.isNil()) {
    var tiff = pb.dataForType($.NSPasteboardTypeTIFF);
    if (!tiff.isNil()) {
      var rep0 = $.NSBitmapImageRep.imageRepWithData(tiff);
      if (!rep0.isNil()) data = rep0.representationUsingTypeProperties(4, $.NSDictionary.dictionary); // 4 = PNG; non-nil properties
    }
  }
  if (!data.isNil()) {
    data.writeToFileAtomically(png, true);
    var rep = $.NSBitmapImageRep.imageRepWithData(data);
    return done([{ kind: 'image', path: png, detail: rep.isNil() ? '' : rep.pixelsWide + 'x' + rep.pixelsHigh }]);
  }

  var s = pb.stringForType($.NSPasteboardTypeString);
  if (!s.isNil()) {
    var t = ObjC.unwrap(s).trim().replace(/^"|"$/g, '');
    if (t.length > 0 && t.length < 2048 && !/[\\r\\n]/.test(t) && fm.fileExistsAtPath(t)) return done([pathItem(t)]);
    var m = /^data:([\\w.+-]+\\/[\\w.+-]+);base64,(.+)$/.exec(t);
    if (m) {
      var exts = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'application/pdf': '.pdf' };
      var p = dir + '/' + base + (exts[m[1].toLowerCase()] || '.bin');
      $.NSData.alloc.initWithBase64EncodedStringOptions(m[2], 0).writeToFileAtomically(p, true);
      return done([{ kind: /^image\\//i.test(m[1]) ? 'image' : 'file', path: p }]);
    }
    if (/^https?:\\/\\/\\S+$/.test(t)) return done([], null, t);
    return done([], 'The clipboard holds text, not an image, file or media. Paste text with Cmd+V.');
  }
  return done([], 'Nothing on the clipboard can be attached (no image, file or media).');
}
`

// POSIX entry point: $1 dir, $2 base, $3 the macOS reader. macOS runs the
// JXA reader; Linux uses wl-paste (Wayland) or xclip (X11) for images.
export const POSIX_READER = `
dir="$1"; base="$2"
mkdir -p "$dir" || { printf '{"items":[],"reason":"Could not create the capture folder."}\\n'; exit 0; }
[ -f "$dir/.gitignore" ] || printf '*\\n' > "$dir/.gitignore"
if [ "$(uname -s)" = Darwin ]; then exec osascript -l JavaScript -e "$3" "$dir" "$base"; fi
out="$dir/$base.png"
if [ -n "$WAYLAND_DISPLAY" ] && command -v wl-paste >/dev/null 2>&1; then
  if wl-paste --list-types | grep -qx 'image/png'; then
    wl-paste --type image/png > "$out" && printf '{"items":[{"kind":"image"}]}\\n' && exit 0
  fi
elif command -v xclip >/dev/null 2>&1; then
  if xclip -selection clipboard -t TARGETS -o | grep -qx 'image/png'; then
    xclip -selection clipboard -t image/png -o > "$out" && printf '{"items":[{"kind":"image"}]}\\n' && exit 0
  fi
else
  printf '{"items":[],"reason":"Install wl-clipboard or xclip to paste images on Linux."}\\n'; exit 0
fi
printf '{"items":[],"reason":"No image on the clipboard."}\\n'
`
