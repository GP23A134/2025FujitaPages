function ViewMap(update_callback){
  this.update_callback = update_callback;
}

/**
 * テキストを Node / Edge に変換する
 * フォーマット：
 * 主語	述語	目的語	[主語色]	[目的語色]	[エッジ色]
 */
ViewMap.prototype.setData = function(text){

  const lines = text.split("\n");

  const DEFAULT_NODE_COLOR = "#97C2FC";
  const DEFAULT_EDGE_COLOR = "#2B7CE9";

  const nodesSet = [];
  const nodes = [];
  const edges = [];

  lines.forEach(line => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) return;

    const [s, p, o, sColorRaw, oColorRaw, eColorRaw] = parts;

    const sColor = sColorRaw || DEFAULT_NODE_COLOR;
    const oColor = oColorRaw || DEFAULT_NODE_COLOR;
    const eColor = eColorRaw || DEFAULT_EDGE_COLOR;

    const s_id = addNode(s, sColor);
    const o_id = addNode(o, oColor);

    edges.push({
      from: s_id,
      to: o_id,
      label: p,
      arrows: "to",
      color: { color: eColor },
      font: { align: "middle" }
    });
  });

  this.data = {
    nodes: new vis.DataSet(nodes),
    edges: new vis.DataSet(edges)
  };

  function addNode(label, color){
    const idx = nodesSet.indexOf(label);
    if (idx < 0){
      nodesSet.push(label);
      const id = nodesSet.length;
      nodes.push({
        id: id,
        label: label,
        color: { background: color, border: color }
      });
      return id;
    }
    return idx + 1;
  }
};

/**
 * Node / Edge をマップ表示
 */
ViewMap.prototype.showMap = function(div_id, update_callback, network_callback){

  const container = document.getElementById(div_id);
  const nodes = this.data.nodes;
  const edges = this.data.edges;
  const self = this;

  const options = {
    manipulation: {
      enabled: true,
      addNode(nodeData, callback){
        nodeData.id = self.makeNodeId();
        callback(nodeData);
      },
      addEdge(edgeData, callback){
        edgeData.label = "new";
        callback(edgeData);
      }
    },
    edges: { arrows: "to" },
    physics: false
  };

  // network は ViewMap が保持
  this.network = new vis.Network(container, this.data, options);
  const network = this.network;

  if (typeof network_callback === "function"){
    network_callback(network);
  }

  const editBox   = document.getElementById("editBox");
  const presetBox = document.getElementById("colorPreset");

  const COLOR_PRESETS = [
    "#97C2FC",
    "#A5D6A7",
    "#FFCC80",
    "#EF9A9A",
    "#CE93D8",
    "#B0BEC5"
  ];

  // =========================
  // ダブルクリック処理
  // =========================
  network.on("doubleClick", function(params){

    // Ctrl + ダブルクリック → 色変更
    if (params.event?.srcEvent?.ctrlKey){

      // ノード
      const nodeId = network.getNodeAt(params.pointer.DOM);
      if (nodeId !== undefined){
        const pos = network.canvasToDOM(
          network.getPositions([nodeId])[nodeId]
        );
        showColorPreset(pos, color => {
          nodes.update({
            id: nodeId,
            color: { background: color, border: color }
          });
        });
        return;
      }

      // エッジ
      const edgeId = network.getEdgeAt(params.pointer.DOM);
      if (edgeId !== undefined){
        const e = edges.get(edgeId);
        const from = network.getPositions([e.from])[e.from];
        const to   = network.getPositions([e.to])[e.to];
        const pos = network.canvasToDOM({
          x: (from.x + to.x) / 2,
          y: (from.y + to.y) / 2
        });
        showColorPreset(pos, color => {
          edges.update({
            id: edgeId,
            color: { color: color }
          });
        });
        return;
      }
    }

    // ノードラベル編集
    const nodeId = network.getNodeAt(params.pointer.DOM);
    if (nodeId !== undefined){
      const node = nodes.get(nodeId);
      const pos = network.canvasToDOM(
        network.getPositions([nodeId])[nodeId]
      );
      showEditBox(pos, node.label, txt => {
        nodes.update({ id: nodeId, label: txt });
      });
      return;
    }

    // エッジラベル編集
    const edgeId = network.getEdgeAt(params.pointer.DOM);
    if (edgeId !== undefined){
      const e = edges.get(edgeId);
      const from = network.getPositions([e.from])[e.from];
      const to   = network.getPositions([e.to])[e.to];
      const pos = network.canvasToDOM({
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2
      });
      showEditBox(pos, e.label, txt => {
        edges.update({ id: edgeId, label: txt });
      });
    }
  });

  // =========================
  // DataSet 更新 → テキスト反映
  // =========================
  nodes.on("*", updateTextBox);
  edges.on("*", updateTextBox);

  function updateTextBox(){
    if (!update_callback) return;

    let text = "";

    edges.get().forEach(e => {
      const s = self.getNode(e.from);
      const o = self.getNode(e.to);

      const sColor = s.color?.background || "";
      const oColor = o.color?.background || "";
      const eColor = e.color?.color || "";

      text +=
        s.label + "\t" +
        e.label + "\t" +
        o.label;

      if (sColor || oColor || eColor){
        text += "\t" + sColor + "\t" + oColor + "\t" + eColor;
      }
      text += "\n";
    });

    update_callback(text);
  }

  // =========================
  // UI 補助関数
  // =========================
  function showEditBox(pos, text, callback){
    editBox.value = text;
    editBox.style.display = "block";

    editBox.style.left = pos.x - 70 + "px";
    editBox.style.top  = pos.y - 12 + "px";

    editBox.focus();
    editBox.onblur = finish;
    editBox.onkeydown = e => { if (e.key === "Enter") finish(); };

    function finish(){
      editBox.style.display = "none";
      callback(editBox.value);
    }
  }

  function showColorPreset(pos, callback){
    presetBox.innerHTML = "";
    COLOR_PRESETS.forEach(c => {
      const d = document.createElement("div");
      d.style.cssText =
        `width:20px;height:20px;display:inline-block;
         margin:2px;cursor:pointer;background:${c}`;
      d.onclick = () => {
        presetBox.style.display = "none";
        callback(c);
      };
      presetBox.appendChild(d);
    });

    presetBox.style.left = pos.x + "px";
    presetBox.style.top  = pos.y + "px";
    presetBox.style.display = "block";
  }
};

/**
 * Utility
 */

/**
 * prefix更新
 */
ViewMap.prototype.updatePrefix = function(prefix){
  this.prefix = prefix;
}

/**
 * Node/Edge とbase IRI/PREFIXを元に，Tripleに変換する
 * @param {*} baseIri
 * @param {*} propertyIri
 * @param {*} turtlePrefix
 */
ViewMap.prototype.output = function (baseIri, propertyIri, turtlePrefix, predicateMap, options){
      const allNodes = this.data.nodes.get();
      const allEdges = this.data.edges.get();
      const base = String(baseIri).trim();
      const propertyBase = String(propertyIri).trim();
      const prefixes = this.getPrefixes(turtlePrefix);
      const prefixNames = prefixes.map(prefix => prefix.name);
      const basePrefix = prefixes.find(prefix => prefix.iri === base);
      const propertyPrefix = prefixes.find(prefix => prefix.iri === propertyBase);
      const labelPredicate = iriTerm("http://www.w3.org/2000/01/rdf-schema#label");
      const rdfTypePredicate = iriTerm("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
      const rdfPropertyClass = iriTerm("http://www.w3.org/1999/02/22-rdf-syntax-ns#Property");
      const propertyMap = predicateMap || {};
      const outputOptions = Object.assign({
        autoIri: true,
        outputLabel: true,
        outputPropertyType: true
      }, options || {});

      const nodes = outputOptions.outputLabel ? allNodes.map (node => {
        return `${nodeTerm(node)} ${labelPredicate} "${escapeLiteral(labelText(node.label))}"@ja.`;
      }) : [];

      // edgeは同名labelを統合，idはlabelのURLエンコード
      var edgeList = [];
      allEdges.forEach(edge => {
        if (edgeList.indexOf(edge.label) < 0){
          edgeList.push(edge.label);
        }
      });
      const edges = outputOptions.outputLabel ? edgeList.map (edge => {
        const id = edgeId(edge);
        return `${edgeTerm(edge, id)} ${labelPredicate} "${escapeLiteral(labelText(edge))}"@ja.`;
      }) : [];

      const propertyTypes = outputOptions.outputPropertyType ? edgeList.map (edge => {
        const id = edgeId(edge);
        return `${edgeTerm(edge, id)} ${rdfTypePredicate} ${rdfPropertyClass}.`;
      }) : [];

      // 関連出力
      const relations = allEdges.map (edge => {
        const p_id = edgeId(edge.label);
        const s = this.getNode(edge.from);
        const o = this.getNode(edge.to);
        return `${nodeTerm(s)} ${edgeTerm(edge.label, p_id)} ${nodeTerm(o)}.`;
      });

      const prefixText = (turtlePrefix || "").trim();
      const body = nodes.concat(propertyTypes).concat(edges).concat(relations).join("\n");
      return prefixText === "" ? body : prefixText + "\n\n" + body;

      function nodeTerm(node){
        if (!outputOptions.autoIri) return textIriTerm(node.label, base, basePrefix);
        if (isPrefixedName(node.label)) return node.label;
        if (basePrefix) return `${basePrefix.name}:${node.id}`;
        return `<${base}${node.id}>`;
      }

      function edgeTerm(label, encodedId){
        if (!outputOptions.autoIri) return textIriTerm(label, propertyBase, propertyPrefix);
        if (isPrefixedName(label)) return label;
        if (propertyPrefix) return `${propertyPrefix.name}:${encodedId}`;
        return `<${propertyBase}${encodedId}>`;
      }

      function edgeId(label){
        return propertyMap[label] || encodeURIComponent(label);
      }

      function iriTerm(iri){
        const prefix = prefixes.find(prefix => iri.indexOf(prefix.iri) === 0);
        if (!prefix) return `<${iri}>`;
        return `${prefix.name}:${iri.substring(prefix.iri.length)}`;
      }

      function textIriTerm(value, iriBase, prefix){
        const text = String(value).trim();
        if (prefix) return `${prefix.name}:${text}`;
        return `<${iriBase}${encodeURIComponent(text)}>`;
      }

      function isPrefixedName(value){
        const match = String(value).match(/^([A-Za-z][\w-]*):.+$/);
        return !!match && prefixNames.indexOf(match[1]) >= 0;
      }

      function labelText(value){
        const text = String(value);
        return isPrefixedName(text) ? text.replace(/^[A-Za-z][\w-]*:/, "") : text;
      }

      function escapeLiteral(value){
        return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      }
}

ViewMap.prototype.suggestPredicateMap = async function (turtlePrefix, currentMap){
  const prefixes = this.getPrefixes(turtlePrefix);
  const prefixNames = prefixes.map(prefix => prefix.name);
  const map = Object.assign({}, currentMap || {});
  const usedIds = Object.keys(map).map(label => map[label]);

  const labels = [];
  this.data.edges.get().forEach(edge => {
    if (labels.indexOf(edge.label) < 0){
      labels.push(edge.label);
    }
  });

  for (const label of labels){
    if (map[label]) continue;
    if (this.isKnownPrefixedName(label, prefixNames)) continue;
    if (!this.hasJapanese(label)) continue;

    const translated = await this.translateJapanese(label);
    const propertyName = this.toPropertyName(translated);
    map[label] = propertyName !== ""
      ? this.uniqueId(propertyName, usedIds)
      : encodeURIComponent(label);
    usedIds.push(map[label]);
  }

  return map;
}

ViewMap.prototype.isKnownPrefixedName = function (value, prefixNames){
  const match = String(value).match(/^([A-Za-z][\w-]*):.+$/);
  return !!match && prefixNames.indexOf(match[1]) >= 0;
}

ViewMap.prototype.hasJapanese = function (text){
  return /[ぁ-んァ-ヶ一-龠々]/.test(String(text));
}

ViewMap.prototype.translateJapanese = async function (text){
  try {
    const url =
      "https://translate.googleapis.com/translate_a/single" +
      "?client=gtx&sl=ja&tl=en&dt=t&q=" +
      encodeURIComponent(text);
    const response = await fetch(url);
    if (!response.ok) return "";

    const json = await response.json();
    return json[0].map(part => part[0]).join("");
  } catch (e) {
    return "";
  }
}

ViewMap.prototype.toPropertyName = function (text){
  const words = String(text)
    .replace(/['’]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(word => word !== "");

  if (words.length === 0) return "";

  const first = words[0].charAt(0).toLowerCase() + words[0].slice(1);
  const rest = words.slice(1).map(word => {
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
  let propertyName = [first].concat(rest).join("");

  if (!/^[A-Za-z_]/.test(propertyName)){
    propertyName = "property" + propertyName.charAt(0).toUpperCase() + propertyName.slice(1);
  }

  return propertyName;
}

ViewMap.prototype.uniqueId = function (id, usedIds){
  if (usedIds.indexOf(id) < 0) return id;

  let i = 2;
  while (usedIds.indexOf(id + i) >= 0) {
    i++;
  }
  return id + i;
}

ViewMap.prototype.getPrefixNames = function (turtlePrefix){
  return this.getPrefixes(turtlePrefix).map(prefix => prefix.name);
}

ViewMap.prototype.getPrefixes = function (turtlePrefix){
  const prefixes = [];
  (turtlePrefix || "").split("\n").forEach(line => {
    const match = line.trim().match(/^@?prefix\s+([A-Za-z][\w-]*):\s*<([^>]+)>\s*\.?$/i);
    if (match && !prefixes.some(prefix => prefix.name === match[1])){
      prefixes.push({ name: match[1], iri: match[2] });
    }
  });
  return prefixes;
}

ViewMap.prototype.getNode = function (id){
  for (let i in this.data.nodes.get()) {
    const node = this.data.nodes.get()[i];
    if (node.id === id){
      return node;
    }
  }
}

/**
 * ノードIDを付与する
 * @param {string} label 
 * @returns 
 */
ViewMap.prototype.makeNodeId = function (label){
  var i = 0;
  this.data.nodes.get().forEach(n => {
    if (i < n.id){
      i = n.id;
    }
  });
  return (i+1);
}

/**
 * エッジIDを付与する
 * @param {string} label 
 */
ViewMap.prototype.makeEdgeId = function (label){
  // 現状利用しない（既存のIDをそのまま流用）

}


// ViewMap.prototype.getNode = function(id){
//   return this.data.nodes.get(id);
// };

// ViewMap.prototype.makeNodeId = function(){
//   let max = 0;
//   this.data.nodes.get().forEach(n => {
//     if (n.id > max) max = n.id;
//   });
//   return max + 1;
// };
