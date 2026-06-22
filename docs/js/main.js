window.onload = function () {

  const viewMap = new ViewMap();
  setupTextareaTabInput(document.getElementById("input"));
  let network = null;   // ViewMap と共有する network

  // =========================
  // グラフ表示
  // =========================
  document.getElementById("viewBtn").onclick = function () {

    viewMap.setData(
      document.getElementById("input").value.trim()
    );

    viewMap.showMap(
      "mynetwork",

      // map.js 側でノード／エッジが更新されたとき
      function (text) {
        document.getElementById("input").value = text;
      },

      // ★ ViewMap から network を受け取る（完全同期）
      function (net) {
        network = net;

        // 初期レイアウトのみ実行
        network.setOptions({
          physics: {
            enabled: true,
            stabilization: { iterations: 1000 }
          }
        });

        network.once("stabilizationIterationsDone", function () {
          network.setOptions({
            physics: { enabled: false }
          });
        });
      }
    );
  };

  // =========================
  // 自動レイアウト ON / OFF
  // =========================
  const physicsBtn = document.getElementById("physicsBtn");

  if (physicsBtn) {
    physicsBtn.textContent = "自動レイアウト：OFF";
    physicsBtn.dataset.on = "false";

    physicsBtn.addEventListener("click", function () {
      if (!network) return;

      const isOn = this.dataset.on === "true";

      network.setOptions({
        physics: { enabled: !isOn }
      });

      this.dataset.on = (!isOn).toString();
      this.textContent = !isOn
        ? "自動レイアウト：ON"
        : "自動レイアウト：OFF";
    });
  }

  // =========================
  // Triple 生成
  // =========================
  document.getElementById("saveBtn").onclick = async () => {
    const baseIri = document.getElementById("pfx_inp").value;
    const propertyIri = document.getElementById("prop_iri_inp").value;
    const turtlePrefix = document.getElementById("prefix_inp").value;
    const options = readOutputOptions();
    const saveBtn = document.getElementById("saveBtn");

    saveBtn.disabled = true;
    showLoading();
    try {
      ensureMapData(viewMap);
      const predicateMap = options.autoIri
        ? await viewMap.suggestPredicateMap(
            turtlePrefix,
            readPredicateMap()
          )
        : readPredicateMap();
      renderPredicateMap(predicateMap);
      document.getElementById("output").value = viewMap.output(
        baseIri,
        propertyIri,
        turtlePrefix,
        readPredicateMap(),
        options
      );
      document.getElementById("updateBtn").disabled = false;
    } finally {
      hideLoading();
      saveBtn.disabled = false;
    }
  };

  // =========================
  // Endpoint 反映
  // =========================
  document.getElementById("updateBtn").onclick = () => {

    const output = document.getElementById("output").value;
    const sparqlPrefix = toSparqlPrefix(
      document.getElementById("prefix_inp").value
    );
    const tripleBody = removeTurtlePrefix(output);

    let query =
      sparqlPrefix +
      "insert data {";

    const graph = document.getElementById("grf_inp").value.trim();

    if (graph !== "") {
      query += "GRAPH <" + graph + "> {";
      query += tripleBody;
      query += "}";
    } else {
      query += tripleBody;
    }

    query += "}";

    const pos = new PostData(
      document.getElementById("ep_upd_inp").value
    );

    showLoading();
    pos.post(
      query,
      function (message) {
        hideLoading();
        document.getElementById("updateBtn").disabled = true;
        alert(message);
      },
      function (message) {
        hideLoading();
        document.getElementById("updateBtn").disabled = true;
        alert(message);
      }
    );
  };

  document.getElementById("updateBtn").disabled = true;

  // =========================
  // 初期設定
  // =========================
  document.getElementById("pfx_inp").value = config.prefix;
  document.getElementById("prop_iri_inp").value = config.propertyIri || "";
  document.getElementById("prefix_inp").value = config.turtlePrefix || "";
  document.getElementById("grf_inp").value = config.graph;
  document.getElementById("ep_upd_inp").value = config.endpoint.update;

  loadTsvFromUrl(document.getElementById("viewBtn"));
};

function setupTextareaTabInput(textarea) {
  if (!textarea) return;

  textarea.addEventListener("keydown", function (e) {
    if (e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey) return;

    e.preventDefault();

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.setRangeText("\t", start, end, "end");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function loadTsvFromUrl(viewBtn) {
  const params = new URLSearchParams(location.search);
  const tsvUrl = params.get("tsv");
  if (!tsvUrl) return;

  try {
    showLoading();
    const response = await fetch(tsvUrl);
    if (!response.ok) {
      throw new Error(response.status + " " + response.statusText);
    }
    document.getElementById("input").value = await response.text();

    if (params.get("view") === "1" || params.get("view") === "true") {
      viewBtn.click();
    }
  } catch (e) {
    alert("TSVファイルを読み込めませんでした: " + tsvUrl + "\n" + e.message);
  } finally {
    hideLoading();
  }
}

function ensureMapData(viewMap) {
  if (viewMap.data) return;

  viewMap.setData(
    document.getElementById("input").value.trim()
  );
}

function toSparqlPrefix(text) {
  return text
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "")
    .map(line => {
      const match = line.match(/^@prefix\s+([A-Za-z][\w-]*:)\s*(<[^>]+>)\s*\.?\s*$/i);
      if (!match) return line + "\n";
      return "PREFIX " + match[1] + " " + match[2] + "\n";
    })
    .join("");
}

function removeTurtlePrefix(text) {
  return text
    .split("\n")
    .filter(line => !line.trim().match(/^@?prefix\s+/i))
    .join("\n");
}

function readPredicateMap() {
  const map = {};
  document.querySelectorAll("#predicateMapTable tbody tr").forEach(row => {
    const label = row.dataset.label;
    const input = row.querySelector("input");
    if (label && input && input.value.trim() !== "") {
      map[label] = input.value.trim();
    }
  });
  return map;
}

function readOutputOptions() {
  return {
    autoIri: document.getElementById("auto_iri_chk").checked,
    outputLabel: document.getElementById("label_out_chk").checked,
    outputPropertyType: document.getElementById("property_type_chk").checked
  };
}

function renderPredicateMap(map) {
  const area = document.getElementById("predicateMapArea");
  const tbody = document.querySelector("#predicateMapTable tbody");
  tbody.innerHTML = "";

  Object.keys(map).forEach(label => {
    const row = document.createElement("tr");
    row.dataset.label = label;

    const labelCell = document.createElement("td");
    labelCell.textContent = label;

    const propertyCell = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    input.value = map[label];
    propertyCell.appendChild(input);

    row.appendChild(labelCell);
    row.appendChild(propertyCell);
    tbody.appendChild(row);
  });

  area.style.display = Object.keys(map).length > 0 ? "flex" : "none";
}

// =========================
// ローディング表示
// =========================
function showLoading() {
  document.getElementById("loadingOverlay").classList.remove("hidden");
  document.body.classList.add("no-scroll");
}

function hideLoading() {
  document.getElementById("loadingOverlay").classList.add("hidden");
  document.body.classList.remove("no-scroll");
}
