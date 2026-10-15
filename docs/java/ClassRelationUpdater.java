import java.io.IOException;
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
import com.google.gson.JsonObject;

/** inputのTSVを使ってクラス一覧とクラス間関係を更新します。 */
public final class ClassRelationUpdater {
    private static final Path INPUT_DIRECTORY = Paths.get("data/input");
    private static final Path PROCESSED_DIRECTORY = INPUT_DIRECTORY.resolve("processed");
    private static final Path CLASS_INPUT = INPUT_DIRECTORY.resolve("class-list.tsv");
    private static final Path RELATION_INPUT = INPUT_DIRECTORY.resolve("class-relation.tsv");
    private static final Path CLASS_DATA = Paths.get("data/integrated-data/class-data.json");
    private static final Path MIDDLE_LIST = Paths.get("data/integrated-data/middle-class-list.json");
    private static final Path TOP_LIST = Paths.get("data/integrated-data/top-class-list.json");
    private static final String URI_PREFIX = "https://kozaki-lab.jp/REFV-KG/class/";
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    private ClassRelationUpdater() {}

    public static void main(String[] args) throws IOException {
        // JSONの既存内容には依存せず、2つのTSVを唯一の入力として再生成する。
        // この順序で検証を先に行うため、入力に問題がある場合はJSONを更新せず、
        // 入力TSVもprocessedへ移動しない。
        Map<String, String> classes = new LinkedHashMap<>();
        Map<String, String> temporaryIds = new LinkedHashMap<>();
        addInputClasses(classes, temporaryIds);
        List<String[]> relations = readRelations(classes, temporaryIds);
        normalizeDirectTargetRelations(classes, relations);
        validateAcyclic(relations);

        // クラス一覧、関係一覧、上位・中間クラス一覧を同じ入力内容から出力する。
        writeClassData(classes, relations);
        writeList(MIDDLE_LIST, classes, "m_");
        writeList(TOP_LIST, classes, "t_");

        // 出力がすべて成功した後で、入力を履歴フォルダへ移動する。
        Path processedDirectory = moveInputFiles();
        System.out.printf("クラス一覧と親子関係を再生成しました。クラス: %d件、関係: %d件%n",
                classes.size(), relations.size());
        System.out.println("入力TSVを移動しました: " + processedDirectory);
    }

    private static Path moveInputFiles() throws IOException {
        // 同じファイル名の入力を上書きしないよう、実行時刻ごとのフォルダを作る。
        // ミリ秒まで含めることで、短時間に連続実行した場合も衝突しにくくする。
        String timestamp = LocalDateTime.now()
                .format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss-SSS"));
        Path processedDirectory = PROCESSED_DIRECTORY.resolve(timestamp);
        Files.createDirectories(processedDirectory);
        Files.move(CLASS_INPUT, processedDirectory.resolve(CLASS_INPUT.getFileName()));
        Files.move(RELATION_INPUT, processedDirectory.resolve(RELATION_INPUT.getFileName()));
        return processedDirectory;
    }

    private static void addInputClasses(Map<String, String> classes, Map<String, String> temporaryIds) throws IOException {
        // class-list.tsvの行を正規化し、クラスIDからラベルへのMapを作る。
        // ID欄が空の行には一時IDを発行し、関係TSVから参照できるよう対応表に登録する。
        List<String> lines = readTsv(CLASS_INPUT, "種類\tID\tラベル");
        // 既存IDの最大値を確認してから、新規行の仮IDを採番する。
        // classesはこのループで構築するため、読み込み前に計算すると常に0から始まってしまう。
        Map<String, Integer> next = nextNumbersFromLines(lines);
        Set<String> inputIds = new HashSet<>();
        Set<String> inputLabels = new HashSet<>();
        for (String line : lines) {
            String[] columns = line.split("\\t", -1);
            if (columns.length != 3) throw new IOException("class-list.tsvの列数が不正です: " + line);
            String type = columns[0].trim().toLowerCase();
            String id = columns[1].trim();
            String label = columns[2].trim();
            String prefix = prefix(type);
            if (prefix == null || label.isEmpty()) throw new IOException("種類またはラベルが不正です: " + line);
            if (id.isEmpty()) {
                // 新規クラスは既存の最大番号の次を採番する。表示用のnew- IDと、
                // 出力する正式URIの両方をtemporaryIdsで解決できるようにする。
                int number = next.compute(prefix, (key, value) -> value + 1) - 1;
                id = URI_PREFIX + prefix + String.format("%05d", number);
                temporaryIds.put("new-" + prefix + number, id);
                temporaryIds.put("new-" + prefix + String.format("%05d", number), id);
            } else {
                id = normalizeId(id);
            }
            // 未分類は画面表示時に生成する仮想グループであり、過去のTSVには
            // classとして書き出された仮想IDが残っている場合がある。
            if (isVirtualUnclassified(id, label)) continue;
            if (!inputIds.add(id)) throw new IOException("class-list.tsvにIDの重複があります: " + id);
            if (!inputLabels.add(type + "\t" + label)) {
                throw new IOException("class-list.tsvに同じ種類・ラベルの重複があります: " + line);
            }
            if (classes.containsKey(id)) throw new IOException("class-list.tsvにIDの重複があります: " + id);
            classes.put(id, label);
        }
    }

    private static List<String[]> readRelations(Map<String, String> classes, Map<String, String> temporaryIds) throws IOException {
        // 関係は「子ID、親ID」の順で読み込み、入力に登場したクラスだけを参照できるよう検証する。
        // 同じ親子関係の重複もここで検出する。
        List<String[]> result = new ArrayList<>();
        Set<String> relationKeys = new HashSet<>();
        for (String line : readRelationTsv()) {
            String[] columns = line.split("\\t", -1);
            if (columns.length != 2) throw new IOException("class-relation.tsvの列数が不正です: " + line);
            if (isVirtualUnclassified(columns[0], "未分類")
                    || isVirtualUnclassified(columns[1], "未分類")) continue;
            String child = resolveId(columns[0], temporaryIds);
            String parent = resolveId(columns[1], temporaryIds);
            if (!classes.containsKey(child) || !classes.containsKey(parent)) {
                throw new IOException("一覧にないクラスIDです: " + line);
            }
            if (!relationKeys.add(child + "\t" + parent)) {
                throw new IOException("class-relation.tsvに親子関係の重複があります: " + line);
            }
            result.add(new String[] { child, parent });
        }
        return result;
    }

    private static List<String> readRelationTsv() throws IOException {
        // 関係TSVは旧形式のヘッダーなしファイルも存在するため、ヘッダーがあれば読み飛ばし、
        // なければ1行目からデータとして扱う。class-list.tsvはreadTsvでヘッダー必須のままにする。
        List<String> lines = Files.readAllLines(RELATION_INPUT, StandardCharsets.UTF_8);
        if (lines.isEmpty()) return List.of();
        String firstLine = lines.get(0).replace("\ufeff", "");
        String expectedHeader = "子クラスID\t親クラスID";
        if (firstLine.trim().equals(expectedHeader)) return lines.subList(1, lines.size()).stream()
                .filter(line -> !line.isBlank()).toList();
        return lines.stream().filter(line -> !line.isBlank()).toList();
    }

    /** 対象クラスから上位クラスへの直接関係は、そのまま保持します。
     * 未分類は画面表示時に上位クラス内の仮想グループとして生成します。 */
    private static void normalizeDirectTargetRelations(Map<String, String> classes, List<String[]> relations) {
        // 対象クラスは所属先を1つに限定し、複数指定された場合は
        // class-relation.tsvで先に現れた親を残す。
        Set<String> assignedTargets = new HashSet<>();
        relations.removeIf(relation -> {
            String child = relation[0];
            if (!child.startsWith(URI_PREFIX + "c_")) return false;
            return !assignedTargets.add(child);
        });
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
        // Web全体で参照するクラス一覧と親子関係を1つのJSONにまとめる。
        // Gsonで生成するため、ラベルにタブや特殊文字が含まれてもJSONとして安全に出力できる。
        JsonObject root = new JsonObject();
        JsonArray classArray = new JsonArray();
        classes.forEach((id, label) -> {
            JsonObject item = new JsonObject();
            item.addProperty("id", id);
            item.addProperty("label", label);
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
        // class-data.jsonと同じクラスMapから、上位または中間クラスだけを抽出した一覧を作る。
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

    private static List<String> readTsv(Path file, String header) throws IOException {
        // UTF-8で読み込み、先頭のBOMを除去してからヘッダーを比較する。
        // 空行は入力ミスとして扱わず、データ行から除外する。
        List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);
        String actualHeader = lines.isEmpty() ? "" : lines.get(0).replace("\ufeff", "");
        String normalizedHeader = String.join("\t", actualHeader.split("\t", -1)).trim();
        normalizedHeader = String.join("\t", java.util.Arrays.stream(normalizedHeader.split("\t", -1))
                .map(value -> value.trim()).toList());
        String expectedHeader = String.join("\t", java.util.Arrays.stream(header.split("\t", -1))
                .map(value -> value.trim()).toList());
        if (lines.isEmpty() || !normalizedHeader.equals(expectedHeader)) {
            throw new IOException("TSVヘッダーが不正です: " + file);
        }
        return lines.subList(1, lines.size()).stream().filter(line -> !line.isBlank()).toList();
    }

    private static Map<String, Integer> nextNumbers(Map<String, String> classes) {
        // 既存クラスのID末尾から種別ごとの最大番号を求め、新規IDの開始番号を決める。
        // 欠番は再利用せず、最大値の次から採番する。
        Map<String, Integer> result = new LinkedHashMap<>();
        for (String prefix : List.of("c_", "m_", "t_")) {
            int max = classes.keySet().stream().map(ClassRelationUpdater::shortId)
                    .filter(id -> id.startsWith(prefix)).map(id -> id.substring(prefix.length()))
                    .filter(number -> number.matches("\\d+")).mapToInt(Integer::parseInt).max().orElse(-1);
            result.put(prefix, max + 1);
        }
        return result;
    }

    private static Map<String, Integer> nextNumbersFromLines(List<String> lines) {
        Map<String, String> existing = new LinkedHashMap<>();
        for (String line : lines) {
            String[] columns = line.split("\\t", -1);
            if (columns.length != 3 || columns[1].trim().isEmpty()) continue;
            existing.put(normalizeId(columns[1]), columns[2].trim());
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
        return id.startsWith("<") && id.endsWith(">") ? id.substring(1, id.length() - 1) :
                (id.startsWith("http") ? id : URI_PREFIX + id);
    }

    private static boolean isVirtualUnclassified(String value, String label) {
        // 未分類はデータ上の実クラスではなく、Web画面で表示時に作る仮想グループ。
        // 過去にTSVへ書き出された予約IDだけを除外し、通常の同名クラスは保持する。
        String id = normalizeId(value);
        return "未分類".equals(label)
                && (id.equals(URI_PREFIX + "t_00000") || id.equals(URI_PREFIX + "m_00000"));
    }

    private static String resolveId(String value, Map<String, String> temporaryIds) {
        // 関係TSVのnew-形式は、クラス一覧の読み込み時に発行した正式URIへ解決する。
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
        Files.writeString(path, GSON.toJson(root), StandardCharsets.UTF_8);
    }
}
