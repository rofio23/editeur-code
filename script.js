(function () {
  "use strict";

  var STORE_KEY = "atelier:projet";
  var THEME_KEY = "atelier:theme";
  var BASE = "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs";

  var DEFAULTS = {
    "index.html":
      '<!DOCTYPE html>\n<html lang="fr">\n<head>\n  <meta charset="UTF-8">\n  <title>Ma page</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>Bonjour 👋</h1>\n  <p>Modifiez le code à gauche : l’aperçu se met à jour tout seul.</p>\n  <button id="btn">Cliquez-moi</button>\n  <script src="script.js"></script>\n</body>\n</html>\n',
    "style.css":
      "body {\n  font-family: system-ui, sans-serif;\n  display: grid;\n  place-content: center;\n  min-height: 100vh;\n  margin: 0;\n  text-align: center;\n  background: linear-gradient(135deg, #1e1b4b, #4c1d95);\n  color: white;\n}\n\nbutton {\n  padding: 10px 20px;\n  border: 0;\n  border-radius: 8px;\n  font-size: 1rem;\n  cursor: pointer;\n}\n",
    "script.js":
      'var compteur = 0;\nvar bouton = document.getElementById("btn");\n\nbouton.addEventListener("click", function () {\n  compteur++;\n  bouton.textContent = "Clics : " + compteur;\n});\n'
  };

  var LANGS = { html: "html", css: "css", js: "javascript", ts: "typescript", json: "json", md: "markdown" };
  var LABELS = { html: "HTML", css: "CSS", javascript: "JavaScript", typescript: "TypeScript", json: "JSON", markdown: "Markdown", plaintext: "Texte" };

  var files = {};      // nom -> contenu
  var models = {};     // nom -> modèle Monaco
  var openTabs = [];
  var active = null;
  var editor = null;
  var runTimer = null;
  var saveTimer = null;

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- Stockage ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) { var data = JSON.parse(raw); if (data && data.files) { files = data.files; return; } }
    } catch (e) {}
    files = JSON.parse(JSON.stringify(DEFAULTS));
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ files: files })); } catch (e) {}
    $("st-save").textContent = "Enregistré";
  }
  function scheduleSave() {
    $("st-save").textContent = "Modification…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
  }

  /* ---------- Thème ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    $("btn-theme").textContent = t === "dark" ? "☾" : "☀";
    if (window.monaco) monaco.editor.setTheme(t === "dark" ? "atelier-nuit" : "atelier-jour");
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  }
  function currentTheme() { return document.documentElement.getAttribute("data-theme"); }

  /* ---------- Fichiers et onglets ---------- */
  function langOf(name) {
    var ext = name.split(".").pop().toLowerCase();
    return LANGS[ext] || "plaintext";
  }
  function getModel(name) {
    if (!models[name]) {
      models[name] = monaco.editor.createModel(files[name], langOf(name));
      models[name].onDidChangeContent(function () {
        files[name] = models[name].getValue();
        scheduleSave();
        clearTimeout(runTimer);
        runTimer = setTimeout(run, 600);
      });
    }
    return models[name];
  }
  function openFile(name) {
    if (!files.hasOwnProperty(name)) return;
    if (openTabs.indexOf(name) < 0) openTabs.push(name);
    active = name;
    editor.setModel(getModel(name));
    editor.focus();
    renderUI();
  }
  function closeTab(name) {
    var i = openTabs.indexOf(name);
    if (i < 0) return;
    openTabs.splice(i, 1);
    if (active === name) {
      active = openTabs[Math.max(0, i - 1)] || null;
      if (active) editor.setModel(getModel(active));
      else editor.setModel(monaco.editor.createModel("", "plaintext"));
    }
    renderUI();
  }
  function newFile() {
    var name = prompt("Nom du fichier (ex. page.html) :");
    if (!name) return;
    name = name.trim();
    if (!/^[\w.\-]+$/.test(name)) { alert("Utilisez uniquement lettres, chiffres, point, tiret et underscore."); return; }
    if (files.hasOwnProperty(name)) { alert("Ce fichier existe déjà."); return; }
    files[name] = "";
    save();
    openFile(name);
  }
  function deleteFile(name) {
    if (!confirm("Supprimer « " + name + " » ?")) return;
    closeTab(name);
    if (models[name]) { models[name].dispose(); delete models[name]; }
    delete files[name];
    save();
    renderUI();
    run();
  }

  function renderUI() {
    var list = $("file-list");
    list.innerHTML = "";
    Object.keys(files).sort().forEach(function (name) {
      var li = document.createElement("li");
      li.className = "file" + (name === active ? " active" : "");
      li.tabIndex = 0;
      li.innerHTML = "<span></span><button class='del' aria-label='Supprimer'>×</button>";
      li.firstChild.textContent = name;
      li.addEventListener("click", function () { openFile(name); });
      li.addEventListener("keydown", function (e) { if (e.key === "Enter") openFile(name); });
      li.querySelector(".del").addEventListener("click", function (e) { e.stopPropagation(); deleteFile(name); });
      list.appendChild(li);
    });

    var tabs = $("tabs");
    tabs.innerHTML = "";
    openTabs.forEach(function (name) {
      var t = document.createElement("button");
      t.className = "tab" + (name === active ? " active" : "");
      t.setAttribute("role", "tab");
      t.innerHTML = "<span></span><span class='x' aria-label='Fermer'>×</span>";
      t.firstChild.textContent = name;
      t.addEventListener("click", function () { openFile(name); });
      t.querySelector(".x").addEventListener("click", function (e) { e.stopPropagation(); closeTab(name); });
      tabs.appendChild(t);
    });
    $("st-lang").textContent = active ? LABELS[langOf(active)] : "—";
  }

  /* ---------- Aperçu ---------- */
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function buildPage() {
    var htmlName = files["index.html"] !== undefined ? "index.html" :
      Object.keys(files).filter(function (n) { return /\.html?$/.test(n); })[0];
    if (!htmlName) return "<p style='font-family:sans-serif;padding:20px'>Ajoutez un fichier index.html pour voir un aperçu.</p>";
    var html = files[htmlName];
    Object.keys(files).forEach(function (name) {
      var n = escapeRe(name);
      if (/\.css$/.test(name)) {
        html = html.replace(new RegExp("<link[^>]+href=[\"']" + n + "[\"'][^>]*>", "i"), function () { return "<style>\n" + files[name] + "\n</style>"; });
      } else if (/\.js$/.test(name)) {
        html = html.replace(new RegExp("<script[^>]+src=[\"']" + n + "[\"'][^>]*>\\s*</script>", "i"), function () { return "<script>\n" + files[name].replace(/<\/script/gi, "<\\/script") + "\n<\/script>"; });
      }
    });
    return html;
  }
  function run() { $("preview").srcdoc = buildPage(); }

  function download() {
    Object.keys(files).forEach(function (name) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([files[name]], { type: "text/plain" }));
      a.download = name;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
  }

  /* ---------- Monaco ---------- */
  window.MonacoEnvironment = {
    getWorkerUrl: function () {
      var code = "self.MonacoEnvironment={baseUrl:'" + BASE + "/'};importScripts('" + BASE + "/base/worker/workerMain.js');";
      return "data:text/javascript;charset=utf-8," + encodeURIComponent(code);
    }
  };

  function defineThemes() {
    monaco.editor.defineTheme("atelier-nuit", {
      base: "vs-dark", inherit: true,
      rules: [
        { token: "comment", foreground: "6e6a9a", fontStyle: "italic" },
        { token: "keyword", foreground: "b79cff" },
        { token: "string", foreground: "5eead4" },
        { token: "number", foreground: "ff9ec9" },
        { token: "tag", foreground: "ff7eb6" },
        { token: "attribute.name", foreground: "b79cff" },
        { token: "attribute.value", foreground: "5eead4" }
      ],
      colors: {
        "editor.background": "#0c0a1f00",
        "editor.foreground": "#e9e7ff",
        "editorLineNumber.foreground": "#585485",
        "editorLineNumber.activeForeground": "#b79cff",
        "editor.lineHighlightBackground": "#8b6cff14",
        "editor.selectionBackground": "#8b6cff55",
        "editorCursor.foreground": "#2fd3c4",
        "editorIndentGuide.background1": "#8b6cff22",
        "editorWidget.background": "#14112e",
        "editorSuggestWidget.background": "#14112e"
      }
    });
    monaco.editor.defineTheme("atelier-jour", {
      base: "vs", inherit: true, rules: [],
      colors: { "editor.background": "#ffffff00", "editor.lineHighlightBackground": "#6a4df00f", "editorCursor.foreground": "#6a4df0" }
    });
  }

  function init() {
    defineThemes();
    editor = monaco.editor.create($("editor"), {
      model: null,
      theme: currentTheme() === "dark" ? "atelier-nuit" : "atelier-jour",
      fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
      fontSize: 14, fontLigatures: true, lineHeight: 22,
      minimap: { enabled: true }, automaticLayout: true,
      smoothScrolling: true, cursorSmoothCaretAnimation: "on",
      padding: { top: 14 }, scrollBeyondLastLine: false, bracketPairColorization: { enabled: true }
    });
    editor.onDidChangeCursorPosition(function (e) {
      $("st-pos").textContent = "Ln " + e.position.lineNumber + ", Col " + e.position.column;
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function () { save(); run(); });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run);

    var first = files["index.html"] !== undefined ? "index.html" : Object.keys(files)[0];
    if (first) openFile(first); else renderUI();
    run();
  }

  /* ---------- Démarrage ---------- */
  var savedTheme = null;
  try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) {}
  applyTheme(savedTheme === "light" ? "light" : "dark");

  load();

  $("btn-run").addEventListener("click", run);
  $("btn-new").addEventListener("click", newFile);
  $("btn-download").addEventListener("click", download);
  $("btn-theme").addEventListener("click", function () { applyTheme(currentTheme() === "dark" ? "light" : "dark"); });
  $("btn-preview").addEventListener("click", function () {
    var wb = document.querySelector(".workbench");
    var hidden = wb.classList.toggle("no-preview");
    this.setAttribute("aria-pressed", String(!hidden));
  });

  require.config({ paths: { vs: BASE } });
  require(["vs/editor/editor.main"], init);
})();

