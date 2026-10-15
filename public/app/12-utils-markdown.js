async function copyPreview() {
  const text = previewContent.value.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  previewStatus.textContent = "预览内容已复制。";
}

async function copyCapturePairing() {
  if (!copyCapturePairingButton || !capturePairingStatus) return;
  copyCapturePairingButton.disabled = true;
  capturePairingStatus.textContent = "正在生成配对信息…";
  try {
    const { token } = await api("/api/capture-token");
    if (!token) throw new Error("没有收到配对令牌");
    await navigator.clipboard.writeText(JSON.stringify({
      endpoint: `${location.origin}/api/items/upsert-capture`,
      token
    }));
    capturePairingStatus.textContent = "已复制。请在 Teams 用户脚本菜单中粘贴，令牌不会显示在这里。";
  } catch (error) {
    capturePairingStatus.textContent = error.message || "无法复制配对信息。";
  } finally {
    copyCapturePairingButton.disabled = false;
  }
}

function handleDragOver(event) {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
}

function handleDragLeave() {
  dropZone.classList.remove("is-dragging");
}

async function handleDrop(event) {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  const file = event.dataTransfer.files?.[0];
  if (!file) return;

  importContent.value = await file.text();
  if (!confirmTitle.value) {
    confirmTitle.value = file.name.replace(/\.[^.]+$/, "");
  }
  await previewImport();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

// Fetches a download endpoint and saves the response under the server's file name.
async function downloadFile(path, fallbackName) {
  const response = await fetch(path);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `下载失败：${response.status}`);
  }
  const blob = await response.blob();
  const filename = filenameFromDisposition(response.headers.get("Content-Disposition")) || fallbackName;
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return filename;
}

async function exportMarkdown(path, fallbackName) {
  try {
    const filename = await downloadFile(path, fallbackName);
    notify("已导出 Markdown", filename);
  } catch (error) {
    notify("没能导出", error.message, "error");
  }
}

async function streamApi(path, body, handlers) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: handlers.signal
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "流式请求失败");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\n\n+/);
    buffer = parts.pop() || "";
    for (const part of parts) {
      const event = parseSseEvent(part);
      if (!event) continue;
      handlers[event.event]?.(event.data);
    }
  }

  if (buffer.trim()) {
    const event = parseSseEvent(buffer);
    if (event) handlers[event.event]?.(event.data);
  }
}

function parseSseEvent(block) {
  const lines = block.split("\n");
  const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data) return null;
  return { event, data: JSON.parse(data) };
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function formatDate(value) {
  if (!value) return "unknown";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value === false ? "" : value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMarkdown(markdown) {
  const normalizedMarkdown = String(markdown || "").replace(/(https?:\/\/[^\s<>()\[\]]+)([（【])/g, "$1 $2");
  if (window.marked && window.DOMPurify) {
    window.marked.setOptions({
      breaks: false,
      gfm: true
    });
    const rawHtml = window.marked.parse(normalizedMarkdown);
    return addSafeLinkAttributes(window.DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ["target", "rel"]
    }));
  }
  return renderMarkdownFallback(normalizedMarkdown);
}

function renderMarkdownFallback(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];
  let table = [];
  let code = [];
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(`<ul>${list.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  const flushTable = () => {
    if (!table.length) return;
    blocks.push(renderMarkdownTable(table));
    table = [];
  };
  const flushCode = () => {
    blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    code = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushAll();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      code.push(line);
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph();
      flushTable();
      list.push(line.replace(/^\s*[-*]\s+/, ""));
      continue;
    }

    if (/^\s*\|.+\|\s*$/.test(line)) {
      flushParagraph();
      flushList();
      table.push(line);
      continue;
    }

    flushList();
    flushTable();
    paragraph.push(line.trim());
  }

  if (inCode) flushCode();
  flushAll();
  return blocks.join("");
}

function addSafeLinkAttributes(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href") || "";
    if (!sanitizeMarkdownHref(href)) {
      link.replaceWith(document.createTextNode(link.textContent || ""));
      return;
    }
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noreferrer");
  });
  return template.innerHTML;
}

function renderInlineMarkdown(value) {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safeHref = sanitizeMarkdownHref(href);
    return safeHref ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer">${label}</a>` : label;
  });
  return text;
}

function renderMarkdownTable(rows) {
  const parsed = rows
    .map((row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
  if (parsed.length < 2 || !parsed[1].every((cell) => /^:?-{3,}:?$/.test(cell))) {
    return `<p>${rows.map((row) => renderInlineMarkdown(row)).join("<br>")}</p>`;
  }
  const headers = parsed[0];
  const bodyRows = parsed.slice(2);
  return [
    "<table>",
    `<thead><tr>${headers.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("")}</tr></thead>`,
    `<tbody>${bodyRows.map((row) => `<tr>${headers.map((_, index) => `<td>${renderInlineMarkdown(row[index] || "")}</td>`).join("")}</tr>`).join("")}</tbody>`,
    "</table>"
  ].join("");
}

function sanitizeMarkdownHref(href) {
  const value = String(href || "").trim();
  if (/^(https?:|mailto:)/i.test(value) || value.startsWith("/")) return value;
  return "";
}

