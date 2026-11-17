import { resolve, sep } from 'path';
import { statSync } from 'fs';

// Media uploaded to local storage is stored as a public URL on our own domain
// (FRONTEND_URL/uploads/<yyyy>/<mm>/<dd>/<file>, see LocalStorage). When the
// site sits behind a CDN such as Cloudflare, fetching that URL back is
// unreliable for streamed uploads: Cloudflare drops Content-Length from HEAD
// replies and answers Range requests on cached files with the whole file, so
// mediaSize and mediaChunk fail for every video. Those files are on this
// server's disk, so read them from UPLOAD_DIRECTORY instead.
//
// Returns the local file path, or null when the media is not one of our own
// uploads (or the file is missing), in which case callers fetch the URL as
// before.
export function localUploadPath(path: string): string | null {
  const uploadDirectory = process.env.UPLOAD_DIRECTORY;
  const frontendUrl = process.env.FRONTEND_URL;
  if (
    process.env.STORAGE_PROVIDER !== 'local' ||
    !uploadDirectory ||
    !frontendUrl ||
    path?.indexOf('http') !== 0
  ) {
    return null;
  }

  let media: URL;
  let frontend: URL;
  try {
    media = new URL(path);
    frontend = new URL(frontendUrl);
  } catch {
    return null;
  }

  const prefix = frontend.pathname.replace(/\/+$/, '') + '/uploads/';
  if (media.origin !== frontend.origin || !media.pathname.startsWith(prefix)) {
    return null;
  }

  let relative: string;
  try {
    relative = decodeURIComponent(media.pathname.slice(prefix.length));
  } catch {
    return null;
  }

  // Confine reads to UPLOAD_DIRECTORY: resolve() collapses any `..` segments,
  // so a crafted path can never point outside it.
  const base = resolve(uploadDirectory);
  const filePath = resolve(base, relative);
  if (!filePath.startsWith(base + sep)) {
    return null;
  }

  try {
    return statSync(filePath).isFile() ? filePath : null;
  } catch {
    return null;
  }
}
