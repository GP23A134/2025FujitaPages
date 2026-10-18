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
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private ClassDataUpdate() {}

    public static void main(String[] args) throws IOException {
        // JSONの既存内容には依存せず、入力JSONを唯一の入力として再生成する。
        // この順序で検証を先に行うため、入力に問題がある場合はJSONを更新せず、
        // 入力JSONもhistoryへ移動しない。
        InputData input = readInput();
        Map<String, String> classes = new LinkedHashMap<>();
        Map<String, String> temporaryIds = new LinkedHashMap<>();
        addInputClasses(classes, temporaryIds, input.classes());
        List<String[]> relations = readRelations(classes, temporaryIds, input.relations());
        normalizeDirectTargetRelations(classes, relations);
        validateHierarchyAssignments(classes, relations);
        validateAcyclic(relations);

        // クラス一覧、関係一覧、対象クラス一覧を同じ入力内容から出力する。
        writeClassData(classes, relations);
        writeList(TARGET_CLASS_DATA, classes, "c_");
        writeListTsv(MIDDLE_TSV_LIST, classes, "m_");
        writeListTsv(TOP_TSV_LIST, classes, "t_");

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
        String timestamp = LocalDateTime.now()
                .format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss-SSS"));
        Files.createDirectories(HISTORY_DIRECTORY);
        Path movedInput = HISTORY_DIRECTORY.resolve("class-update-" + timestamp + ".json");
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

    private static InputData readInput() throws IOException {
        if (!Files.isRegularFile(INPUT_FILE)) {
            throw new IOException("入力JSONが見つかりません: " + INPUT_FILE);
        }
        try (Reader reader = Files.newBufferedReader(INPUT_FILE, StandardCharsets.UTF_8)) {
            JsonElement parsed = JsonParser.parseReader(reader);
            if (!parsed.isJsonObject()) throw new IOException("入力JSONのルートはオブジェクトにしてください。");
            JsonObject root = parsed.getAsJsonObject();
            JsonArray classArray = requireArray(root, "classes");
            JsonArray relationArray = requireArray(root, "relations");
            List<String[]> classes = new ArrayList<>();
            List<String[]> relations = new ArrayList<>();
            for (JsonElement element : classArray) {
                if (!element.isJsonObject()) throw new IOException("classesの要素はオブジェクトにしてください。");
                JsonObject item = element.getAsJsonObject();
                classes.add(new String[] {
                    requiredString(item, "type"), requiredString(item, "id"), requiredString(item, "label")
                });
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

    private static void addInputClasses(Map<String, String> classes, Map<String, String> temporaryIds,
            List<String[]> rows) throws IOException {
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
            if (prefix == null || label.isEmpty()) {
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

    /** 対象クラスから上位クラスへの直接関係は、そのまま保持します。 */
    private static void normalizeDirectTargetRelations(Map<String, String> classes, List<String[]> relations) {
        // 対象クラスは所属先を1つに限定し、複数指定された場合は
        // JSON内で先に現れた親を残す。
        Set<String> assignedTargets = new HashSet<>();
        relations.removeIf(relation -> {
            String child = relation[0];
            if (!child.startsWith(URI_PREFIX + "c_")) return false;
            return !assignedTargets.add(child);
        });
    }

    /**
     * 対象クラスが中間または上位クラスへ、中間クラスが中間または上位クラスへ
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
            appendMissing(message, "中間または上位クラス未所属の対象クラス", missingMiddle);
            appendMissing(message, "上位クラス未所属の中間クラス", missingTop);
            throw new IOException(message.toString());
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
        // 中間・上位クラスの定義と、対象クラスから上位階層への関係をまとめる。
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
        Files.createDirectories(output.getParent());
        Path temporary = output.resolveSibling(output.getFileName() + ".tmp");
        Files.writeString(temporary, contents.toString(), StandardCharsets.UTF_8);
        try {
            Files.move(temporary, output, java.nio.file.StandardCopyOption.ATOMIC_MOVE,
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } catch (java.nio.file.AtomicMoveNotSupportedException e) {
            Files.move(temporary, output, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
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
        return switch (type) { case "class", "対象", "対象クラス" -> "c_";
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
        // 出力先の親フォルダを先に作成し、整形済みUTF-8 JSONを書き込む。
        Files.createDirectories(path.getParent());
        Path temporary = path.resolveSibling(path.getFileName() + ".tmp");
        Files.writeString(temporary, GSON.toJson(root), StandardCharsets.UTF_8);
        try {
            Files.move(temporary, path, java.nio.file.StandardCopyOption.ATOMIC_MOVE,
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } catch (java.nio.file.AtomicMoveNotSupportedException e) {
            Files.move(temporary, path, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private record InputData(List<String[]> classes, List<String[]> relations) {}
}
