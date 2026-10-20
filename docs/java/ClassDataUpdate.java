import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/** inputのJSONを使ってクラス一覧とクラス間関係を更新します。 */
public final class ClassDataUpdate {
    private static final Path INPUT_DIRECTORY = Paths.get("data/input");
    private static final Path HISTORY_DIRECTORY = INPUT_DIRECTORY.resolve("history");
    private static final Path INPUT_FILE = INPUT_DIRECTORY.resolve("class-update.json");
    private static final Path CLASS_DATA = Paths.get("data/integrated/class-data.json");
    private static final Path TARGET_CLASS_DATA = Paths.get("data/integrated/target-class-data.json");
    private static final Path MIDDLE_TSV_LIST = Paths.get("data/output/middle-class-list.tsv");
    private static final Path TOP_TSV_LIST = Paths.get("data/output/top-class-list.tsv");
    private static final String URI_PREFIX = "https://kozaki-lab.jp/REFV-KG/class/";
    private static final DateTimeFormatter HISTORY_TIMESTAMP_FORMATTER =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss-SSS");
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private ClassDataUpdate() {}

    public static void main(String[] args) throws IOException {
        // 全件JSONなら入力内容を使い、差分JSONなら現在データへ適用する。クラスのラベルは既存一覧から引き継ぐ。
        // この順序で検証を先に行うため、入力に問題がある場合はJSONを更新せず、
        // 入力JSONもhistoryへ移動しない。
        Map<String, String> existingTargetLabels = readTargetClassLabels();
        InputData input = readInput(existingTargetLabels);
        Map<String, String> classes = new LinkedHashMap<>();
        Map<String, String> temporaryIds = new LinkedHashMap<>();
        addInputClasses(classes, temporaryIds, input.classes(), existingTargetLabels);
        List<String[]> relations = readRelations(classes, temporaryIds, input.relations());
        renumberHierarchyIds(classes, relations);
        validateRelationStructure(relations);
        normalizeDirectTargetRelations(classes, relations);
        validateHierarchyAssignments(classes, relations);
        validateUnclassifiedHasNoMiddleChildren(classes, relations);
        validateAcyclic(relations);

        Path snapshot = writeBeforeUpdateSnapshot(existingTargetLabels);
        System.out.println("変更前データを履歴に保存しました: " + snapshot);

        // クラス一覧、関係一覧、クラス一覧を同じ入力内容から出力する。
        writeClassData(classes, relations);
        writeList(TARGET_CLASS_DATA, classes, "c_");
        writeListTsv(MIDDLE_TSV_LIST, classes, "m_");
        writeListTsv(TOP_TSV_LIST, classes, "t_");
        ClassDataVersion.writeCurrentHash();

        // 出力がすべて成功した後で、入力を履歴フォルダへ移動する。
        Path archivedInput = moveInputFile();
        System.out.printf("クラス一覧と親子関係を再生成しました。クラス: %d件、関係: %d件%n",
                classes.size(), relations.size());
        System.out.println("中間クラスTSVを出力しました: " + MIDDLE_TSV_LIST);
        System.out.println("上位クラスTSVを出力しました: " + TOP_TSV_LIST);
        System.out.println("入力JSONを履歴に保存しました: " + archivedInput);
    }

    private static Path moveInputFile() throws IOException {
        // 実行日時をファイル名に含め、履歴フォルダ直下に保存する。
        // ミリ秒まで含めることで、短時間に連続実行した場合も衝突しにくくする。
        String timestamp = LocalDateTime.now().format(HISTORY_TIMESTAMP_FORMATTER);
        Files.createDirectories(HISTORY_DIRECTORY);
        Path movedInput = uniqueHistoryPath("class-update-" + timestamp);
        moveWithRetry(INPUT_FILE, movedInput);
        return movedInput;
    }

    private static void moveWithRetry(Path source, Path target) throws IOException {
        IOException lastException = null;
        for (int attempt = 1; attempt <= 5; attempt++) {
            try {
                Files.move(source, target);
                return;
            } catch (IOException exception) {
                lastException = exception;
                if (attempt < 5) {
                    try {
                        Thread.sleep(200L * attempt);
                    } catch (InterruptedException interruptedException) {
                        Thread.currentThread().interrupt();
                        throw new IOException("入力JSONの移動が中断されました。", interruptedException);
                    }
                }
            }
        }
        if (lastException != null) throw lastException;
        throw new IOException("入力JSONの移動に失敗しました。");
    }

    private static InputData readInput(Map<String, String> existingTargetLabels) throws IOException {
        if (!Files.isRegularFile(INPUT_FILE)) {
            throw new IOException("入力JSONが見つかりません: " + INPUT_FILE);
        }
        try (Reader reader = Files.newBufferedReader(INPUT_FILE, StandardCharsets.UTF_8)) {
            JsonElement parsed = JsonParser.parseReader(reader);
            if (!parsed.isJsonObject()) throw new IOException("入力JSONのルートはオブジェクトにしてください。");
            JsonObject root = parsed.getAsJsonObject();
            if (!root.has("classes") && !root.has("relations")) {
                validatePatchVersion(root);
                return applyPatch(root, existingTargetLabels);
            }
            JsonArray classArray = requireArray(root, "classes");
            JsonArray relationArray = requireArray(root, "relations");
            List<String[]> classes = new ArrayList<>();
            List<String[]> relations = new ArrayList<>();
            for (JsonElement element : classArray) {
                if (!element.isJsonObject()) throw new IOException("classesの要素はオブジェクトにしてください。");
                JsonObject item = element.getAsJsonObject();
                String type = requiredString(item, "type");
                String id = requiredString(item, "id");
                String label = "";
                if (item.has("label") && !item.get("label").isJsonNull()
                        && item.get("label").isJsonPrimitive()
                        && item.getAsJsonPrimitive("label").isString()) {
                    label = item.get("label").getAsString();
                } else if (!"c_".equals(prefix(type))) {
                    throw new IOException("入力JSONの 'label' は上位・中間クラスに必要です。");
                }
                classes.add(new String[] { type, id, label });
            }
            for (JsonElement element : relationArray) {
                if (!element.isJsonObject()) throw new IOException("relationsの要素はオブジェクトにしてください。");
                JsonObject item = element.getAsJsonObject();
                relations.add(new String[] { requiredString(item, "child"), requiredString(item, "parent") });
            }
            return new InputData(classes, relations);
        } catch (com.google.gson.JsonParseException exception) {
            throw new IOException("入力JSONを読み込めません。JSONの構文を確認してください。", exception);
        }
    }

    /** 古いデータを元にした差分の適用を止め、IDのずれによる誤分類を防ぎます。 */
    private static void validatePatchVersion(JsonObject patch) throws IOException {
        if (!patch.has("baseDataHash") || !patch.get("baseDataHash").isJsonPrimitive()
                || !patch.getAsJsonPrimitive("baseDataHash").isString()) {
            throw new IOException("差分JSONにbaseDataHashがありません。"
                    + " data/input/current-class-data-version.txtをAIへ渡し、差分を作り直してください。");
        }
        String expected = patch.get("baseDataHash").getAsString().trim();
        String actual = ClassDataVersion.currentHash();
        if (!expected.equalsIgnoreCase(actual)) {
            throw new IOException("差分JSONのbaseDataHashが現在のクラスデータと一致しません。"
                    + " data/input/current-class-data-version.txtをAIへ渡し、差分を作り直してください。"
                    + " (expected=" + expected + ", current=" + actual + ")");
        }
    }

    /** 差分JSONを現在の統合データへ適用し、従来の全件入力と同じ内部形式にします。 */
    private static InputData applyPatch(JsonObject patch, Map<String, String> existingTargetLabels)
            throws IOException {
        List<String[]> classes = new ArrayList<>();
        List<String[]> relations = new ArrayList<>();
        readCurrentClassData(classes, relations, existingTargetLabels);

        JsonArray addedClasses = requireArray(patch, "addClasses");
        JsonArray renamedClasses = requireArray(patch, "renameClasses");
        JsonArray removedRelations = requireArray(patch, "removeRelations");
        JsonArray addedRelations = requireArray(patch, "addRelations");
        JsonArray movedChildren = requireArray(patch, "moveChildren");
        JsonArray removedClasses = requireArray(patch, "removeClasses");

        Set<String> upperLabels = new HashSet<>();
        Set<String> addedOrRenamedMiddleLabels = new HashSet<>();
        for (String[] row : classes) {
            if ("top".equals(row[0])) upperLabels.add(row[2].trim());
        }

        for (JsonElement element : addedClasses) {
            if (!element.isJsonObject()) throw new IOException("addClassesの要素はオブジェクトにしてください。");
            JsonObject item = element.getAsJsonObject();
            String type = requiredString(item, "type");
            String id = requiredString(item, "id");
            String label = requiredString(item, "label").trim();
            String classPrefix = prefix(type);
            if (!"m_".equals(classPrefix) && !"t_".equals(classPrefix)) {
                throw new IOException("差分で追加できるのは上位・中間クラスです: " + type);
            }
            if ("m_".equals(classPrefix) && upperLabels.contains(label)) {
                throw new IOException("同名の上位クラスがあるため、中間クラスを追加できません: " + label);
            }
            if ("m_".equals(classPrefix) && "未分類".equals(label)) {
                throw new IOException("未分類という中間クラスは追加できません。");
            }
            if ("m_".equals(classPrefix)) addedOrRenamedMiddleLabels.add(label);
            classes.add(new String[] { type, id, label });
        }

        for (JsonElement element : renamedClasses) {
            if (!element.isJsonObject()) throw new IOException("renameClassesの要素はオブジェクトにしてください。");
            JsonObject item = element.getAsJsonObject();
            String id = normalizeId(requiredString(item, "id"));
            String label = requiredString(item, "label").trim();
            String[] existing = classes.stream()
                    .filter(row -> normalizeId(row[1]).equals(id))
                    .findFirst().orElse(null);
            if (existing == null || "class".equals(existing[0])) {
                throw new IOException("名称変更の対象は既存の上位・中間クラスにしてください: " + id);
            }
            if ("middle".equals(existing[0]) && "未分類".equals(label)) {
                throw new IOException("未分類という中間クラス名は使用できません。");
            }
            String oldLabel = existing[2].trim();
            if ("middle".equals(existing[0]) && upperLabels.contains(label)
                    && !oldLabel.equals(label)) {
                throw new IOException("同名の上位クラスがあるため、中間クラスをその名称に変更できません: " + label);
            }
            existing[2] = label;
            if ("middle".equals(existing[0]) && !oldLabel.equals(label)) {
                addedOrRenamedMiddleLabels.add(label);
            }
        }

        // 同じ差分内で追加・改名された上位クラスとの重複も確認する。
        upperLabels.clear();
        for (String[] row : classes) {
            if ("top".equals(row[0])) upperLabels.add(row[2].trim());
        }
        for (String label : addedOrRenamedMiddleLabels) {
            if (upperLabels.contains(label)) {
                throw new IOException("同名の上位クラスがあるため、中間クラスを追加・改名できません: " + label);
            }
        }

        for (JsonElement element : removedRelations) {
            if (!element.isJsonObject()) throw new IOException("removeRelationsの要素はオブジェクトにしてください。");
            JsonObject item = element.getAsJsonObject();
            String child = normalizeId(requiredString(item, "child"));
            String parent = normalizeId(requiredString(item, "parent"));
            int relationIndex = -1;
            for (int index = 0; index < relations.size(); index++) {
                if (normalizeId(relations.get(index)[0]).equals(child)
                        && normalizeId(relations.get(index)[1]).equals(parent)) {
                    relationIndex = index;
                    break;
                }
            }
            if (relationIndex < 0) {
                throw new IOException("削除対象の親子関係が現在のデータにありません: " + child + " -> " + parent);
            }
            relations.remove(relationIndex);
        }

        for (JsonElement element : addedRelations) {
            if (!element.isJsonObject()) throw new IOException("addRelationsの要素はオブジェクトにしてください。");
            JsonObject item = element.getAsJsonObject();
            relations.add(new String[] {
                requiredString(item, "child"), requiredString(item, "parent")
            });
        }

        for (JsonElement element : movedChildren) {
            if (!element.isJsonObject()) throw new IOException("moveChildrenの要素はオブジェクトにしてください。");
            JsonObject item = element.getAsJsonObject();
            String from = normalizeId(requiredString(item, "from"));
            String to = normalizeId(requiredString(item, "to"));
            String[] sourceClass = classes.stream()
                    .filter(row -> normalizeId(row[1]).equals(from))
                    .findFirst().orElse(null);
            String[] destinationClass = classes.stream()
                    .filter(row -> normalizeId(row[1]).equals(to))
                    .findFirst().orElse(null);
            if (sourceClass == null || !"middle".equals(sourceClass[0])
                    || destinationClass == null
                    || !("top".equals(destinationClass[0]) || "middle".equals(destinationClass[0]))) {
                throw new IOException("moveChildrenは既存の中間クラスから上位・中間クラスへの移動に限ります。");
            }
            int movedCount = 0;
            for (String[] relation : relations) {
                if (normalizeId(relation[1]).equals(from)) {
                    relation[1] = to;
                    movedCount++;
                }
            }
            if (movedCount == 0) {
                throw new IOException("移動元の中間クラスに子クラスがありません: " + shortId(from));
            }
        }

        for (JsonElement element : removedClasses) {
            if (!element.isJsonObject()) throw new IOException("removeClassesの要素はオブジェクトにしてください。");
            JsonObject item = element.getAsJsonObject();
            String id = normalizeId(requiredString(item, "id"));
            int classIndex = -1;
            for (int index = 0; index < classes.size(); index++) {
                if (normalizeId(classes.get(index)[1]).equals(id)) {
                    classIndex = index;
                    break;
                }
            }
            if (classIndex < 0 || "class".equals(classes.get(classIndex)[0])) {
                throw new IOException("削除対象は既存の上位・中間クラスにしてください: " + shortId(id));
            }
            boolean stillReferenced = relations.stream().anyMatch(relation ->
                    normalizeId(relation[0]).equals(id) || normalizeId(relation[1]).equals(id));
            if (stillReferenced) {
                throw new IOException("親子関係が残っているクラスは削除できません: " + shortId(id));
            }
            classes.remove(classIndex);
        }

        return new InputData(classes, relations);
    }

    /** 差分適用前の全データを、復元可能な全件JSONとして履歴に保存します。 */
    private static Path writeBeforeUpdateSnapshot(Map<String, String> targetLabels) throws IOException {
        List<String[]> classes = new ArrayList<>();
        List<String[]> relations = new ArrayList<>();
        readCurrentClassData(classes, relations, targetLabels);

        JsonObject root = new JsonObject();
        JsonArray classArray = new JsonArray();
        for (String[] row : classes) {
            JsonObject item = new JsonObject();
            item.addProperty("type", row[0]);
            item.addProperty("id", row[1]);
            item.addProperty("label", row[2]);
            classArray.add(item);
        }
        JsonArray relationArray = new JsonArray();
        for (String[] row : relations) {
            JsonObject item = new JsonObject();
            item.addProperty("child", row[0]);
            item.addProperty("parent", row[1]);
            relationArray.add(item);
        }
        root.add("classes", classArray);
        root.add("relations", relationArray);

        Files.createDirectories(HISTORY_DIRECTORY);
        String timestamp = LocalDateTime.now().format(HISTORY_TIMESTAMP_FORMATTER);
        Path snapshot = uniqueHistoryPath("class-data-before-update-" + timestamp);
        writeJson(snapshot, root);
        return snapshot;
    }

    private static Path uniqueHistoryPath(String baseName) {
        Path candidate = HISTORY_DIRECTORY.resolve(baseName + ".json");
        int suffix = 1;
        while (Files.exists(candidate)) {
            candidate = HISTORY_DIRECTORY.resolve(baseName + "-" + suffix++ + ".json");
        }
        return candidate;
    }

    private static void readCurrentClassData(List<String[]> classes, List<String[]> relations,
            Map<String, String> targetLabels) throws IOException {
        if (!Files.isRegularFile(CLASS_DATA)) {
            throw new IOException("現在のクラスデータが見つかりません: " + CLASS_DATA);
        }
        try (Reader reader = Files.newBufferedReader(CLASS_DATA, StandardCharsets.UTF_8)) {
            JsonElement parsed = JsonParser.parseReader(reader);
            if (!parsed.isJsonObject()) throw new IOException("現在のクラスデータのルートはオブジェクトにしてください。");
            JsonObject root = parsed.getAsJsonObject();
            for (JsonElement element : requireArray(root, "classes")) {
                if (!element.isJsonObject()) throw new IOException("現在のクラスデータの要素はオブジェクトにしてください。");
                JsonObject item = element.getAsJsonObject();
                String id = normalizeId(requiredString(item, "id"));
                String label = requiredString(item, "label");
                String kind = classKind(id);
                String type = "t_".equals(kind) ? "top" : "m_".equals(kind) ? "middle" : "";
                if (type.isEmpty()) throw new IOException("現在のクラスデータに不明なクラスIDがあります: " + id);
                classes.add(new String[] { type, id, label });
            }
            for (Map.Entry<String, String> entry : targetLabels.entrySet()) {
                classes.add(new String[] { "class", entry.getKey(), entry.getValue() });
            }
            for (JsonElement element : requireArray(root, "relations")) {
                if (!element.isJsonObject()) throw new IOException("現在の親子関係の要素はオブジェクトにしてください。");
                JsonObject item = element.getAsJsonObject();
                relations.add(new String[] {
                    requiredString(item, "child"), requiredString(item, "parent")
                });
            }
        } catch (com.google.gson.JsonParseException exception) {
            throw new IOException("現在のクラスデータを読み込めません。JSONの構文を確認してください。", exception);
        }
    }

    private static JsonArray requireArray(JsonObject root, String name) throws IOException {
        if (!root.has(name) || !root.get(name).isJsonArray()) {
            throw new IOException("入力JSONに配列 '" + name + "' が必要です。");
        }
        return root.getAsJsonArray(name);
    }

    private static String requiredString(JsonObject object, String name) throws IOException {
        if (!object.has(name) || object.get(name).isJsonNull()
                || !object.get(name).isJsonPrimitive()
                || !object.getAsJsonPrimitive(name).isString()) {
            throw new IOException("入力JSONの '" + name + "' は文字列で指定してください。");
        }
        return object.get(name).getAsString();
    }

    /** クラスのラベルは入力JSONで省略できるため、現在の一覧から引き継ぎます。 */
    private static Map<String, String> readTargetClassLabels() throws IOException {
        Map<String, String> labels = new LinkedHashMap<>();
        if (!Files.isRegularFile(TARGET_CLASS_DATA)) {
            throw new IOException("クラス一覧が見つかりません: " + TARGET_CLASS_DATA);
        }
        try (Reader reader = Files.newBufferedReader(TARGET_CLASS_DATA, StandardCharsets.UTF_8)) {
            JsonElement parsed = JsonParser.parseReader(reader);
            if (!parsed.isJsonObject()) throw new IOException("クラス一覧のルートはオブジェクトにしてください。");
            JsonArray targetClasses = requireArray(parsed.getAsJsonObject(), "classes");
            for (JsonElement element : targetClasses) {
                if (!element.isJsonObject()) throw new IOException("クラス一覧の要素はオブジェクトにしてください。");
                JsonObject item = element.getAsJsonObject();
                String id = normalizeId(requiredString(item, "id"));
                String label = requiredString(item, "label").trim();
                labels.put(id, label);
            }
            return labels;
        } catch (com.google.gson.JsonParseException exception) {
            throw new IOException("クラス一覧を読み込めません。JSONの構文を確認してください。", exception);
        }
    }

    private static void addInputClasses(Map<String, String> classes, Map<String, String> temporaryIds,
            List<String[]> rows, Map<String, String> existingTargetLabels) throws IOException {
        Map<String, Integer> next = nextNumbersFromClasses(rows);
        Set<String> inputIds = new HashSet<>();
        Set<String> inputLabels = new HashSet<>();
        Set<String> temporaryInputIds = new HashSet<>();
        for (String[] columns : rows) {
            if (columns.length != 3) throw new IOException("classesの要素にtype、id、labelが必要です。");
            String type = columns[0].trim().toLowerCase();
            String id = columns[1].trim();
            String label = columns[2].trim();
            String prefix = prefix(type);
            if (prefix == null) {
                throw new IOException("classesの種類またはラベルが不正です: " + String.join(" / ", columns));
            }
            if (id.isEmpty() || id.startsWith("new-")) {
                // 新規クラスは既存の最大番号の次を採番し、入力JSONのnew- IDから
                // 正式URIへ関係を解決できるよう対応表に登録する。
                String requestedTemporaryId = id;
                if (!id.isEmpty() && !id.matches("new-" + prefix + "\\d+")) {
                    throw new IOException("新規クラスIDと種類が一致しません: " + id);
                }
                if (!id.isEmpty() && !temporaryInputIds.add(id)) {
                    throw new IOException("classesに一時IDの重複があります: " + id);
                }
                int number = next.compute(prefix, (key, value) -> value + 1) - 1;
                id = URI_PREFIX + prefix + number;
                if (!requestedTemporaryId.isEmpty()) temporaryIds.put(requestedTemporaryId, id);
                temporaryIds.put("new-" + prefix + number, id);
            } else {
                id = normalizeId(id);
            }
            if (label.isEmpty() && "c_".equals(prefix)) {
                label = existingTargetLabels.getOrDefault(id, "");
            }
            if (label.isEmpty()) {
                throw new IOException("ラベルが空、または既存データからクラスのラベルを取得できません: " + id);
            }
            // 未分類は画面表示時に生成する仮想グループであり、過去の入力には
            // classとして書き出された仮想IDが残っている場合がある。
            if (isVirtualUnclassified(id, label)) continue;
            if (!inputIds.add(id)) throw new IOException("classesにIDの重複があります: " + id);
            if (!inputLabels.add(type + "\t" + label)) {
                throw new IOException("classesに同じ種類・ラベルの重複があります: " + label);
            }
            if (classes.containsKey(id)) throw new IOException("classesにIDの重複があります: " + id);
            classes.put(id, label);
        }
    }

    private static List<String[]> readRelations(Map<String, String> classes, Map<String, String> temporaryIds,
            List<String[]> inputRelations) throws IOException {
        List<String[]> result = new ArrayList<>();
        Set<String> relationKeys = new HashSet<>();
        for (String[] columns : inputRelations) {
            if (columns.length != 2) throw new IOException("relationsの要素にchildとparentが必要です。");
            String line = columns[0] + " -> " + columns[1];
            if (isVirtualUnclassified(columns[0], "未分類")
                    || isVirtualUnclassified(columns[1], "未分類")) continue;
            String child = resolveId(columns[0], temporaryIds);
            String parent = resolveId(columns[1], temporaryIds);
            if (!classes.containsKey(child) || !classes.containsKey(parent)) {
                throw new IOException("一覧にないクラスIDです: " + line);
            }
            if (!relationKeys.add(child + "\t" + parent)) {
                throw new IOException("relationsに親子関係の重複があります: " + line);
            }
            result.add(new String[] { child, parent });
        }
        return result;
    }

    /** クラスから上位クラスへの直接関係は、そのまま保持します。 */
    private static void normalizeDirectTargetRelations(Map<String, String> classes, List<String[]> relations) {
        // クラスは所属先を1つに限定し、複数指定された場合は
        // JSON内で先に現れた親を残す。
        Set<String> assignedTargets = new HashSet<>();
        relations.removeIf(relation -> {
            String child = relation[0];
            if (!child.startsWith(URI_PREFIX + "c_")) return false;
            return !assignedTargets.add(child);
        });
    }

    /** 上位・中間クラスのIDを連番に揃え、親子関係の参照も同時に更新します。 */
    private static void renumberHierarchyIds(Map<String, String> classes, List<String[]> relations) {
        Map<String, String> replacements = new LinkedHashMap<>();
        for (String prefix : List.of("t_", "m_")) {
            List<String> ids = classes.keySet().stream()
                    .filter(id -> id.startsWith(URI_PREFIX + prefix))
                    .sorted((left, right) -> Integer.compare(
                            numericSuffix(left, prefix), numericSuffix(right, prefix)))
                    .toList();
            int next = 1;
            for (String id : ids) {
                if ("t_".equals(prefix) && numericSuffix(id, prefix) == 0) {
                    replacements.put(id, id);
                } else {
                    replacements.put(id, URI_PREFIX + prefix + next++);
                }
            }
        }

        Map<String, String> renumberedClasses = new LinkedHashMap<>();
        classes.forEach((id, label) -> renumberedClasses.put(replacements.getOrDefault(id, id), label));
        classes.clear();
        classes.putAll(renumberedClasses);

        for (String[] relation : relations) {
            relation[0] = replacements.getOrDefault(relation[0], relation[0]);
            relation[1] = replacements.getOrDefault(relation[1], relation[1]);
        }
    }

    private static int numericSuffix(String id, String prefix) {
        return Integer.parseInt(id.substring((URI_PREFIX + prefix).length()));
    }

    /**
     * クラスが中間または上位クラスへ、中間クラスが中間または上位クラスへ
     * 所属していることを検証します。
     * 所属先がないクラスを出力するとWeb画面上で階層から消えるため、更新を中止します。
     */
    private static void validateHierarchyAssignments(Map<String, String> classes, List<String[]> relations)
            throws IOException {
        Map<String, List<String>> parents = new LinkedHashMap<>();
        for (String[] relation : relations) {
            parents.computeIfAbsent(relation[0], ignored -> new ArrayList<>()).add(relation[1]);
        }

        List<String> missingMiddle = new ArrayList<>();
        List<String> missingTop = new ArrayList<>();
        for (String id : classes.keySet()) {
            String kind = classKind(id);
            List<String> directParents = parents.getOrDefault(id, List.of());
            if ("c_".equals(kind)
                    && directParents.stream().noneMatch(parent -> {
                        String parentKind = classKind(parent);
                        return "m_".equals(parentKind) || "t_".equals(parentKind);
                    })) {
                missingMiddle.add(id);
            } else if ("m_".equals(kind)
                    && directParents.stream().noneMatch(parent -> {
                        String parentKind = classKind(parent);
                        return "m_".equals(parentKind) || "t_".equals(parentKind);
                    })) {
                missingTop.add(id);
            }
        }
        if (!missingMiddle.isEmpty() || !missingTop.isEmpty()) {
            StringBuilder message = new StringBuilder("クラス階層の所属漏れがあります。");
            appendMissing(message, "中間または上位クラス未所属のクラス", missingMiddle);
            appendMissing(message, "上位クラス未所属の中間クラス", missingTop);
            throw new IOException(message.toString());
        }
    }

    private static void validateUnclassifiedHasNoMiddleChildren(Map<String, String> classes,
            List<String[]> relations) throws IOException {
        for (String[] relation : relations) {
            String child = relation[0];
            String parent = relation[1];
            if ("m_".equals(classKind(child)) && "t_".equals(classKind(parent))
                    && "未分類".equals(classes.get(parent))) {
                throw new IOException("未分類の上位クラスには中間クラスを配置できません: " + shortId(child));
            }
        }
    }

    private static void validateRelationStructure(List<String[]> relations) throws IOException {
        Map<String, Integer> parentCounts = new LinkedHashMap<>();
        for (String[] relation : relations) {
            String childKind = classKind(relation[0]);
            String parentKind = classKind(relation[1]);
            if (!("c_".equals(childKind) || "m_".equals(childKind))
                    || !("m_".equals(parentKind) || "t_".equals(parentKind))) {
                throw new IOException("親子関係のクラス種別が不正です: "
                        + shortId(relation[0]) + " -> " + shortId(relation[1]));
            }
            int count = parentCounts.merge(relation[0], 1,
                    (current, added) -> current.intValue() + added.intValue());
            if (count > 1) {
                throw new IOException("クラス・中間クラスの親は1つにしてください: "
                        + shortId(relation[0]));
            }
        }
    }

    private static String classKind(String id) {
        String shortId = shortId(id);
        if (shortId.startsWith("c_")) return "c_";
        if (shortId.startsWith("m_")) return "m_";
        if (shortId.startsWith("t_")) return "t_";
        return "";
    }

    private static void appendMissing(StringBuilder message, String title, List<String> ids) {
        if (ids.isEmpty()) return;
        message.append(" ").append(title).append(" ")
                .append(ids.stream().limit(20).map(ClassDataUpdate::shortId).toList());
        if (ids.size() > 20) message.append(" (ほか ").append(ids.size() - 20).append("件)");
        message.append("。");
    }

    private static void validateAcyclic(List<String[]> relations) throws IOException {
        // 親から子への隣接Mapを作り、深さ優先探索で循環を検出する。
        // 循環があるとツリー表示や子孫件数の再帰計算が終了しないため、出力前に拒否する。
        Map<String, List<String>> children = new LinkedHashMap<>();
        for (String[] relation : relations) {
            children.computeIfAbsent(relation[1], ignored -> new ArrayList<>()).add(relation[0]);
        }
        Set<String> visiting = new HashSet<>();
        Set<String> visited = new HashSet<>();
        for (String node : children.keySet()) detectCycle(node, children, visiting, visited);
    }

    private static void detectCycle(String node, Map<String, List<String>> children,
            Set<String> visiting, Set<String> visited) throws IOException {
        // visitingは現在の探索経路、visitedは探索完了済みのノードを表す。
        // 現在の経路へ戻った場合だけ循環と判断し、別経路からの再訪は許可する。
        if (visited.contains(node)) return;
        if (!visiting.add(node)) throw new IOException("クラス階層に循環があります: " + node);
        for (String child : children.getOrDefault(node, List.of())) {
            detectCycle(child, children, visiting, visited);
        }
        visiting.remove(node);
        visited.add(node);
    }

    private static void writeClassData(Map<String, String> classes, List<String[]> relations) throws IOException {
        // 中間・上位クラスの定義と、クラスから上位階層への関係をまとめる。
        // Gsonで生成するため、ラベルにタブや特殊文字が含まれてもJSONとして安全に出力できる。
        JsonObject root = new JsonObject();
        JsonArray classArray = new JsonArray();
        classes.entrySet().stream().filter(entry -> !entry.getKey().startsWith(URI_PREFIX + "c_")).forEach(entry -> {
            JsonObject item = new JsonObject();
            item.addProperty("id", entry.getKey());
            item.addProperty("label", entry.getValue());
            classArray.add(item);
        });
        JsonArray relationArray = new JsonArray();
        for (String[] relation : relations) {
            JsonObject item = new JsonObject();
            item.addProperty("child", relation[0]);
            item.addProperty("parent", relation[1]);
            item.addProperty("relation", "subClassOf");
            relationArray.add(item);
        }
        root.add("classes", classArray);
        root.add("relations", relationArray);
        writeJson(CLASS_DATA, root);
    }

    private static void writeList(Path output, Map<String, String> classes, String prefix) throws IOException {
        // class-data.jsonと同じクラスMapから、上位または中間クラスだけを抽出した一覧JSONを作る。
        // URIの末尾ではなく正式なURI_PREFIXとの組み合わせで判定し、別名前空間を混ぜない。
        JsonObject root = new JsonObject();
        JsonArray array = new JsonArray();
        classes.entrySet().stream().filter(entry -> entry.getKey().startsWith(URI_PREFIX + prefix))
                .forEach(entry -> {
                    JsonObject item = new JsonObject();
                    item.addProperty("id", entry.getKey());
                    item.addProperty("label", entry.getValue());
                    array.add(item);
                });
        root.add("classes", array);
        writeJson(output, root);
    }

    /** 上位または中間クラスの正式ID順で、IDとラベルをTSVとして出力します。 */
    private static void writeListTsv(Path output, Map<String, String> classes, String prefix)
            throws IOException {
        StringBuilder contents = new StringBuilder("ID\tラベル\n");
        classes.entrySet().stream()
                .filter(entry -> entry.getKey().startsWith(URI_PREFIX + prefix))
                .sorted(Map.Entry.comparingByKey())
                .forEach(entry -> contents.append(entry.getKey())
                        .append('\t').append(entry.getValue()).append('\n'));
        writeTextAtomically(output, contents.toString());
    }

    private static Map<String, Integer> nextNumbers(Map<String, String> classes) {
        // 既存クラスのID末尾から種別ごとの最大番号を求め、新規IDの開始番号を決める。
        // 欠番は再利用せず、最大値の次から採番する。
        Map<String, Integer> result = new LinkedHashMap<>();
        for (String prefix : List.of("c_", "m_", "t_")) {
            int max = classes.keySet().stream().map(ClassDataUpdate::shortId)
                    .filter(id -> id.startsWith(prefix)).map(id -> id.substring(prefix.length()))
                    .filter(number -> number.matches("\\d+")).mapToInt(Integer::parseInt).max().orElse(-1);
            result.put(prefix, max + 1);
        }
        return result;
    }

    private static Map<String, Integer> nextNumbersFromClasses(List<String[]> rows) {
        Map<String, String> existing = new LinkedHashMap<>();
        for (String[] columns : rows) {
            if (columns.length != 3 || columns[1].trim().isEmpty() || columns[1].trim().startsWith("new-")) continue;
            existing.put(normalizeId(columns[1].trim()), columns[2].trim());
        }
        return nextNumbers(existing);
    }

    private static String prefix(String type) {
        // TSVで許容する英語・日本語の種別名を、ID生成用の接頭辞へ変換する。
        return switch (type) { case "class", "対象", "クラス" -> "c_";
            case "middle", "中間", "中間クラス" -> "m_";
            case "top", "上位", "上位クラス" -> "t_"; default -> null; };
    }

    private static String normalizeId(String value) {
        // <...> 形式、正式なURI、短縮IDの3形式を正式URIへ統一する。
        String id = value.trim();
        id = id.startsWith("<") && id.endsWith(">") ? id.substring(1, id.length() - 1) :
                (id.startsWith("http") ? id : URI_PREFIX + id);
        // 上位・中間クラスは先頭ゼロを除いたIDに統一する。
        return id.replaceFirst("(?<=/class/)([mt])_0+(\\d+)$", "$1_$2");
    }

    private static boolean isVirtualUnclassified(String value, String label) {
        // t_0はデータ上の未分類クラスとして保持する。旧形式で残るm_0だけを除外する。
        String id = normalizeId(value);
        return "未分類".equals(label)
                && id.equals(URI_PREFIX + "m_0");
    }

    private static String resolveId(String value, Map<String, String> temporaryIds) {
        // 入力JSONのnew-形式は、クラス一覧の読み込み時に発行した正式URIへ解決する。
        // 対応表にない値は通常のID正規化へ回し、既存クラスの参照も受け付ける。
        String trimmed = value.trim();
        return temporaryIds.getOrDefault(trimmed, normalizeId(trimmed));
    }

    private static String shortId(String value) {
        int slash = value.lastIndexOf('/');
        return slash < 0 ? value : value.substring(slash + 1);
    }

    private static void writeJson(Path path, JsonObject root) throws IOException {
        writeTextAtomically(path, GSON.toJson(root));
    }

    private static void writeTextAtomically(Path output, String contents) throws IOException {
        Path parent = output.getParent();
        Files.createDirectories(parent);
        Path temporary = Files.createTempFile(parent, output.getFileName() + ".", ".tmp");
        try {
            Files.writeString(temporary, contents, StandardCharsets.UTF_8);
            try {
                Files.move(temporary, output, java.nio.file.StandardCopyOption.ATOMIC_MOVE,
                        java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            } catch (java.nio.file.AtomicMoveNotSupportedException exception) {
                Files.move(temporary, output, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private record InputData(List<String[]> classes, List<String[]> relations) {}
}
